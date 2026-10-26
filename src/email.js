import path from 'node:path';
import { createHmac, randomBytes } from 'node:crypto';
import { appUrl } from './env.js';
import { cfg, currentContext, orgDataDir } from './context.js';
import { readJson, updateJson } from './store.js';
import { safeEqual, sha256, sign, verifySignature } from './secure.js';
import { connectSmtp, validateSmtp } from './smtp.js';
import { blobSize, onWorkers, readBlobRange, removeEntry, writeBlob } from './storage.js';

// Leads and email campaigns, sent with the organisation's own Resend account or SMTP server.
//
// Safeguards are built in, not optional: every email carries a one-click unsubscribe link (and the
// List-Unsubscribe headers), the organisation's postal address, and is never sent to an address on
// the suppression list (unsubscribed, bounced, or complained), even if it is imported again.
// Importing a CSV requires confirming the contacts agreed to hear from you.

const RESEND = 'https://api.resend.com';
const MAX_LEADS = 4000;
const BATCH = 100;
// Per send request: Workers allow few outbound requests per invocation, so a campaign goes out in
// chunks and the dashboard calls send again until nothing remains.
const MAX_PER_CALL = 1000;
// SMTP sends one message per round trips on a single connection, so on Workers a request sends fewer
// (2 batches = 2 TCP connections, well under the 6 open-connection limit, and the request finishes
// before proxies give up on it). The dashboard keeps calling send, so big campaigns still finish.
const SMTP_MAX_PER_CALL_WORKERS = 200;
const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/;

function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const files = {
  leads: () => path.join(orgDataDir(), 'email-leads.json'),
  suppressed: () => path.join(orgDataDir(), 'email-suppressed.json'),
  campaigns: () => path.join(orgDataDir(), 'email-campaigns.json'),
  log: (id) => path.join(orgDataDir(), `email-log-${id}.json`),
  opens: (id) => path.join(orgDataDir(), `email-opens-${id}.json`),
  // Banner bytes live outside the campaigns JSON so D1 documents stay small; same writeBlob
  // path used for media (files locally, R2 or D1 pieces on Workers).
  banner: (campaignId) => path.join(orgDataDir(), 'email-banners', campaignId),
};

// Uploaded campaign banners: kept small enough for email clients and D1 piece storage.
export const BANNER_MAX_BYTES = 750_000;
export const BANNER_MIMES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

// 1×1 transparent GIF for open tracking (always returned, even for bad signatures).
export const TRACKING_PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const TEST_LEAD_ID = '0'.repeat(16);

const newId = () => randomBytes(8).toString('hex');
const now = () => new Date().toISOString();
export const isEmailId = (id) => /^[a-f0-9]{16}$/.test(String(id || ''));

export function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return EMAIL_RE.test(email) && email.length <= 254 ? email : '';
}

function cleanTags(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(/[;,|]/);
  return [...new Set(list.map((t) => String(t).trim().toLowerCase().slice(0, 40)).filter(Boolean))].slice(0, 20);
}

const text = (value, max) => String(value ?? '').trim().slice(0, max);

// Built-in merge fields. CSV columns outside the mapped core headers land in lead.meta under the
// same snake_case keys ({{subject}}, {{body}}, {{company_size}}, …). Core always wins over meta.
const CORE_MERGE = ['first_name', 'last_name', 'name', 'company', 'email'];
const MAX_META_KEYS = 40;
const MAX_META_VALUE = 5000;

/** Turn a CSV header into a merge-field key: "Company Size" / "company-size" → company_size. */
export function metaKey(header) {
  return String(header || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

function cleanMeta(value, base = {}) {
  const src = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const out = { ...base };
  for (const [raw, v] of Object.entries(src)) {
    const key = metaKey(raw);
    if (!key || CORE_MERGE.includes(key)) continue;
    // Keep blank values: the key is still a known merge field (resolves to "" / |fallback).
    out[key] = text(v, MAX_META_VALUE);
  }
  const keys = Object.keys(out);
  if (keys.length <= MAX_META_KEYS) return out;
  return Object.fromEntries(keys.slice(0, MAX_META_KEYS).map((k) => [k, out[k]]));
}

// ---------- settings ----------

export function emailProvider() {
  return String(cfg.EMAIL_PROVIDER || 'resend').toLowerCase() === 'smtp' ? 'smtp' : 'resend';
}

function smtpOptions() {
  return {
    host: String(cfg.SMTP_HOST || '').trim(),
    port: Number(cfg.SMTP_PORT) || (cfg.SMTP_SECURITY === 'tls' ? 465 : 587),
    security: String(cfg.SMTP_SECURITY || 'starttls').toLowerCase(),
    username: cfg.SMTP_USERNAME || '',
    password: cfg.SMTP_PASSWORD || '',
    fromName: cfg.SMTP_FROM_NAME || '',
    fromEmail: cfg.SMTP_FROM_EMAIL || '',
    replyTo: cfg.EMAIL_REPLY_TO || '',
  };
}

export function emailStatus() {
  const provider = emailProvider();
  const missing = [];
  if (provider === 'smtp') {
    if (!cfg.SMTP_HOST) missing.push('SMTP host');
    if (!cfg.SMTP_FROM_EMAIL) missing.push('SMTP from email');
  } else {
    if (!cfg.RESEND_API_KEY) missing.push('Resend API key');
    if (!cfg.EMAIL_FROM) missing.push('From address');
  }
  if (!cfg.EMAIL_POSTAL_ADDRESS) missing.push('Postal address');
  let publicLinks = true;
  try {
    const url = new URL(appUrl());
    publicLinks = url.protocol === 'https:' && !['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  } catch {
    publicLinks = false;
  }
  const from = provider === 'smtp' ? (cfg.SMTP_FROM_EMAIL ? (cfg.SMTP_FROM_NAME ? `${cfg.SMTP_FROM_NAME} <${cfg.SMTP_FROM_EMAIL}>` : cfg.SMTP_FROM_EMAIL) : '') : cfg.EMAIL_FROM || '';
  return { ready: missing.length === 0, missing, publicLinks, from, provider };
}

// ---------- suppression ----------

async function suppressed() {
  const list = await readJson(files.suppressed(), []);
  return new Map((Array.isArray(list) ? list : []).map((s) => [s.email, s]));
}

async function suppress(email, reason) {
  await updateJson(files.suppressed(), [], (list) => {
    const items = Array.isArray(list) ? list : [];
    if (items.some((s) => s.email === email)) return items;
    return [...items, { email, reason, at: now() }];
  });
  await updateJson(files.leads(), [], (leads) =>
    (Array.isArray(leads) ? leads : []).map((l) => (l.email === email ? { ...l, status: reason === 'unsubscribed' || reason === 'complained' ? 'unsubscribed' : 'bounced', updatedAt: now() } : l)),
  );
}

// ---------- leads ----------

export async function listLeads() {
  const leads = await readJson(files.leads(), []);
  return Array.isArray(leads) ? leads : [];
}

function leadFrom(fields, base = {}) {
  const first = text(fields.firstName ?? base.firstName, 80);
  const last = text(fields.lastName ?? base.lastName, 80);
  const meta =
    fields.meta !== undefined ? cleanMeta(fields.meta, base.meta || {}) : base.meta && typeof base.meta === 'object' ? base.meta : {};
  return {
    ...base,
    firstName: first,
    lastName: last,
    company: text(fields.company ?? base.company, 120),
    tags: fields.tags !== undefined ? cleanTags(fields.tags) : base.tags || [],
    meta,
  };
}

export async function addLead(fields) {
  const email = normalizeEmail(fields.email);
  if (!email) throw fail('Enter a valid email address.');
  const blocked = (await suppressed()).get(email);
  let created;
  await updateJson(files.leads(), [], (leads) => {
    const list = Array.isArray(leads) ? leads : [];
    if (list.some((l) => l.email === email)) throw fail('That email is already a lead.', 409);
    if (list.length >= MAX_LEADS) throw fail(`An organisation can keep up to ${MAX_LEADS} leads.`);
    created = {
      id: newId(),
      email,
      ...leadFrom(fields),
      status: blocked ? (blocked.reason === 'bounced' ? 'bounced' : 'unsubscribed') : 'subscribed',
      source: 'manual',
      createdAt: now(),
      updatedAt: now(),
      lastEmailedAt: '',
    };
    return [created, ...list];
  });
  return created;
}

export async function updateLead(id, fields) {
  let updated;
  await updateJson(files.leads(), [], (leads) =>
    (Array.isArray(leads) ? leads : []).map((l) => {
      if (l.id !== id) return l;
      updated = { ...leadFrom(fields, l), updatedAt: now() };
      return updated;
    }),
  );
  if (!updated) throw fail('That lead is gone.', 404);
  if (fields.status === 'unsubscribed' && updated.status === 'subscribed') {
    await suppress(updated.email, 'unsubscribed');
    updated.status = 'unsubscribed';
  }
  return updated;
}

// Deleting a lead keeps its suppression, so an unsubscribed person can't be mailed after a re-import.
export async function deleteLeads(ids) {
  const remove = new Set(ids);
  await updateJson(files.leads(), [], (leads) => (Array.isArray(leads) ? leads : []).filter((l) => !remove.has(l.id)));
}

// RFC 4180 CSV: quoted fields, doubled quotes, newlines inside quotes, CRLF, a BOM, and comma,
// semicolon, or tab as the delimiter (whichever the header row uses most).
export function parseCsv(input) {
  const source = String(input || '').replace(/^﻿/, '');
  const firstLine = source.split(/\r?\n/, 1)[0] || '';
  const delimiter = [',', ';', '\t'].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && source[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  return rows;
}

const HEADERS = {
  email: /^(e ?mail( address)?|mail)$/,
  firstName: /^(first ?name|first|given ?name|fname)$/,
  lastName: /^(last ?name|last|surname|family ?name|lname)$/,
  name: /^(name|full ?name|contact|contact name)$/,
  company: /^(company|organisation|organization|org|business|account)$/,
  tags: /^(tags?|labels?|segments?|lists?)$/,
};

export function mapColumns(header) {
  const map = {};
  header.forEach((raw, index) => {
    const key = String(raw).trim().toLowerCase().replace(/[_-]+/g, ' ');
    for (const [field, re] of Object.entries(HEADERS)) if (map[field] === undefined && re.test(key)) map[field] = index;
  });
  return map;
}

/** Extra CSV headers → merge keys. Skips columns already mapped as core lead fields. */
export function mapMetaColumns(header, columns = mapColumns(header)) {
  const used = new Set(Object.values(columns));
  const meta = {};
  header.forEach((raw, index) => {
    if (used.has(index)) return;
    const key = metaKey(raw);
    if (!key || CORE_MERGE.includes(key) || meta[key] !== undefined) return;
    meta[key] = index;
  });
  return meta;
}

function rowMeta(row, metaColumns) {
  const meta = {};
  for (const [key, index] of Object.entries(metaColumns)) {
    meta[key] = text(row[index], MAX_META_VALUE);
  }
  return meta;
}

export async function importLeads({ csv, consent, tags }) {
  if (consent !== true) throw fail('Confirm that everyone on this list agreed to receive email from you.');
  const rows = parseCsv(csv);
  if (rows.length < 2) throw fail('The CSV needs a header row and at least one contact.');
  const columns = mapColumns(rows[0]);
  if (columns.email === undefined) throw fail('Couldn’t find an email column. Name one of the columns "email".');
  const metaColumns = mapMetaColumns(rows[0], columns);
  const extraTags = cleanTags(tags);
  const blocked = await suppressed();
  const result = { added: 0, updated: 0, skipped: [], total: rows.length - 1 };

  await updateJson(files.leads(), [], (leads) => {
    const list = Array.isArray(leads) ? leads : [];
    const byEmail = new Map(list.map((l) => [l.email, l]));
    rows.slice(1).forEach((row, i) => {
      const line = i + 2;
      const email = normalizeEmail(row[columns.email]);
      if (!email) return void (result.skipped.length < 50 && result.skipped.push({ line, reason: 'No valid email address' }));
      const cell = (key) => (columns[key] === undefined ? '' : row[columns[key]] || '');
      let firstName = cell('firstName');
      let lastName = cell('lastName');
      if (!firstName && !lastName && cell('name')) {
        const parts = cell('name').trim().split(/\s+/);
        firstName = parts[0] || '';
        lastName = parts.slice(1).join(' ');
      }
      const rowExtra = rowMeta(row, metaColumns);
      const fields = { firstName, lastName, company: cell('company'), tags: [...cleanTags(cell('tags')), ...extraTags], meta: rowExtra };
      const existing = byEmail.get(email);
      if (existing) {
        // Fill in what was missing; never change someone's subscription status from a CSV.
        // Meta keys present in this CSV replace prior values (including blank).
        Object.assign(existing, {
          firstName: existing.firstName || text(fields.firstName, 80),
          lastName: existing.lastName || text(fields.lastName, 80),
          company: existing.company || text(fields.company, 120),
          tags: cleanTags([...(existing.tags || []), ...fields.tags]),
          meta: { ...(existing.meta && typeof existing.meta === 'object' ? existing.meta : {}), ...rowExtra },
          updatedAt: now(),
        });
        result.updated++;
        return;
      }
      if (byEmail.size >= MAX_LEADS) return void (result.skipped.length < 50 && result.skipped.push({ line, reason: `Over the ${MAX_LEADS} lead limit` }));
      const block = blocked.get(email);
      const lead = {
        id: newId(),
        email,
        ...leadFrom(fields),
        status: block ? (block.reason === 'bounced' ? 'bounced' : 'unsubscribed') : 'subscribed',
        source: 'csv',
        createdAt: now(),
        updatedAt: now(),
        lastEmailedAt: '',
      };
      byEmail.set(email, lead);
      list.unshift(lead);
      result.added++;
    });
    return list;
  });
  return result;
}

// ---------- campaigns ----------

async function readCampaignList() {
  const campaigns = await readJson(files.campaigns(), []);
  return Array.isArray(campaigns) ? campaigns : [];
}

/**
 * Campaign list for the dashboard. Includes live `remaining` so unfinished cards can show a
 * leftover cue without opening each campaign. Drafts use the current audience size.
 */
export async function listCampaigns() {
  const [list, leads] = await Promise.all([readCampaignList(), listLeads()]);
  const out = [];
  for (const c of list) {
    const audience = audienceOf(c, leads);
    if (c.status === 'draft') {
      out.push({ ...c, remaining: audience.length });
      continue;
    }
    const log = await readJson(files.log(c.id), {});
    const remaining = audience.filter((l) => !log[l.email]).length;
    out.push({ ...c, remaining });
  }
  return out;
}

export async function getCampaign(id) {
  return (await readCampaignList()).find((c) => c.id === id) || null;
}

function cleanHttpUrl(value, max = 2000) {
  const raw = String(value ?? '').trim().slice(0, max);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.toString();
  } catch {
    return '';
  }
}

/** Banner URL/link templates may include {{merge}} fields; validate http(s) only after merge. */
function bannerTemplate(value, max = 2000) {
  return String(value ?? '').trim().slice(0, max);
}

function campaignFields(fields, base = {}) {
  const bannerEnabled =
    fields.bannerEnabled !== undefined ? Boolean(fields.bannerEnabled) : base.bannerEnabled === true;
  return {
    ...base,
    name: text(fields.name ?? base.name, 120) || 'Untitled campaign',
    subject: text(fields.subject ?? base.subject, 200),
    body: String(fields.body ?? base.body ?? '').slice(0, 20000),
    audienceTags: fields.audienceTags !== undefined ? cleanTags(fields.audienceTags) : base.audienceTags || [],
    bannerEnabled,
    bannerImageUrl:
      fields.bannerImageUrl !== undefined ? bannerTemplate(fields.bannerImageUrl) : bannerTemplate(base.bannerImageUrl || ''),
    bannerLinkUrl:
      fields.bannerLinkUrl !== undefined ? bannerTemplate(fields.bannerLinkUrl) : bannerTemplate(base.bannerLinkUrl || ''),
    bannerAssetId: isEmailId(base.bannerAssetId) ? base.bannerAssetId : '',
    bannerMime: BANNER_MIMES[base.bannerMime] ? base.bannerMime : '',
  };
}

function emptyStats(extra = {}) {
  return { sent: 0, failed: 0, opens: 0, openCount: 0, ...extra };
}

export async function saveCampaign(id, fields) {
  let saved;
  await updateJson(files.campaigns(), [], (campaigns) => {
    const list = Array.isArray(campaigns) ? campaigns : [];
    if (!id) {
      saved = {
        id: newId(),
        ...campaignFields(fields),
        status: 'draft',
        createdAt: now(),
        updatedAt: now(),
        sentAt: '',
        stats: emptyStats(),
      };
      return [saved, ...list].slice(0, 200);
    }
    return list.map((c) => {
      if (c.id !== id) return c;
      if (c.status !== 'draft') throw fail('This campaign has started sending, so it can’t be edited. Duplicate it instead.', 409);
      saved = { ...campaignFields(fields, c), updatedAt: now() };
      return saved;
    });
  });
  if (!saved) throw fail('That campaign is gone.', 404);
  return saved;
}

export async function deleteCampaign(id) {
  await updateJson(files.campaigns(), [], (campaigns) => (Array.isArray(campaigns) ? campaigns : []).filter((c) => c.id !== id));
  await removeEntry(files.banner(id)).catch(() => null);
}

function bannerPayload(orgId, campaignId, assetId) {
  return `email-banner:${orgId}:${campaignId}:${assetId}`;
}

export function bannerPublicUrl(orgId, campaignId, assetId) {
  return `${appUrl()}/public/email-banner/${orgId}/${campaignId}/${assetId}?sig=${sign(bannerPayload(orgId, campaignId, assetId))}`;
}

export function verifyBanner(orgId, campaignId, assetId, sig) {
  return isEmailId(campaignId) && isEmailId(assetId) && verifySignature(bannerPayload(orgId, campaignId, assetId), sig);
}

export async function uploadCampaignBanner(id, buffer, mimeType) {
  const campaign = await getCampaign(id);
  if (!campaign) throw fail('That campaign is gone.', 404);
  if (campaign.status !== 'draft') throw fail('This campaign has started sending, so it can’t be edited. Duplicate it instead.', 409);
  const mime = String(mimeType || '').toLowerCase().split(';')[0].trim();
  if (!BANNER_MIMES[mime]) throw fail('Use a PNG, JPEG, WebP, or GIF image for the banner.');
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw fail('That image file is empty.');
  if (buffer.length > BANNER_MAX_BYTES) {
    throw fail(`Banner images must be ${Math.floor(BANNER_MAX_BYTES / 1024)} KB or smaller.`, 413);
  }
  const assetId = newId();
  await writeBlob(files.banner(id), buffer, { mime });
  let saved;
  await updateJson(files.campaigns(), [], (list) =>
    list.map((c) => {
      if (c.id !== id) return c;
      saved = { ...c, bannerAssetId: assetId, bannerMime: mime === 'image/jpg' ? 'image/jpeg' : mime, updatedAt: now() };
      return saved;
    }),
  );
  if (!saved) throw fail('That campaign is gone.', 404);
  return saved;
}

export async function clearCampaignBanner(id) {
  const campaign = await getCampaign(id);
  if (!campaign) throw fail('That campaign is gone.', 404);
  if (campaign.status !== 'draft') throw fail('This campaign has started sending, so it can’t be edited. Duplicate it instead.', 409);
  await removeEntry(files.banner(id)).catch(() => null);
  let saved;
  await updateJson(files.campaigns(), [], (list) =>
    list.map((c) => {
      if (c.id !== id) return c;
      saved = { ...c, bannerAssetId: '', bannerMime: '', updatedAt: now() };
      return saved;
    }),
  );
  if (!saved) throw fail('That campaign is gone.', 404);
  return saved;
}

/** Returns { mime, buffer } for an uploaded banner, or null. */
export async function readCampaignBanner(id) {
  const campaign = await getCampaign(id);
  if (!campaign?.bannerAssetId || !campaign.bannerMime) return null;
  const size = await blobSize(files.banner(id));
  if (size == null || size <= 0) return null;
  const buffer = await readBlobRange(files.banner(id), 0, size - 1);
  return { mime: campaign.bannerMime, buffer, assetId: campaign.bannerAssetId, bytes: size };
}

function audienceOf(campaign, leads) {
  const tags = campaign.audienceTags || [];
  return leads.filter((l) => l.status === 'subscribed' && (!tags.length || (l.tags || []).some((t) => tags.includes(t))));
}

function openStatsFromMap(opens) {
  const openEntries = opens && typeof opens === 'object' ? Object.values(opens) : [];
  return {
    opens: openEntries.length,
    openCount: openEntries.reduce((n, e) => n + (Number(e?.n) || 0), 0),
  };
}

/** Build delivery + engagement numbers from already-loaded campaign, log, and open maps. */
function buildCampaignAnalytics(campaign, leads, log, opens) {
  const audience = audienceOf(campaign, leads);
  const logMap = log && typeof log === 'object' ? log : {};
  const logEntries = Object.values(logMap);
  // Prefer the send log when it has rows; otherwise use stored campaign.stats (drafts / legacy).
  const sentCount = logEntries.length
    ? logEntries.filter((r) => r?.s === 'sent').length
    : Number(campaign.stats?.sent) || 0;
  const failedCount = logEntries.length
    ? logEntries.filter((r) => r?.s === 'failed').length
    : Number(campaign.stats?.failed) || 0;
  const remaining = audience.filter((l) => !logMap[l.email]).length;
  const openStats = openStatsFromMap(opens);
  const openRate = sentCount > 0 ? Math.round((openStats.opens / sentCount) * 1000) / 10 : null;
  const openRows = Object.values(opens && typeof opens === 'object' ? opens : {})
    .map((entry) => ({
      email: String(entry?.email || ''),
      firstOpenedAt: String(entry?.first || ''),
      lastOpenedAt: String(entry?.last || ''),
      openCount: Number(entry?.n) || 0,
    }))
    .filter((row) => row.email)
    .sort((a, b) => String(b.firstOpenedAt).localeCompare(String(a.firstOpenedAt)))
    .slice(0, 500);
  return {
    campaignId: campaign.id,
    status: campaign.status,
    audience: audience.length,
    sent: sentCount,
    failed: failedCount,
    remaining,
    uniqueOpens: openStats.opens,
    openEvents: openStats.openCount,
    openRate,
    opens: openRows,
  };
}

/** Per-campaign delivery + engagement summary from the send log and open pixel store. */
export async function campaignAnalytics(id) {
  const campaign = await getCampaign(id);
  if (!campaign) throw fail('That campaign is gone.', 404);
  const [leads, log, opens] = await Promise.all([listLeads(), readJson(files.log(id), {}), readJson(files.opens(id), {})]);
  return buildCampaignAnalytics(campaign, leads, log, opens);
}

export async function campaignDetails(id) {
  const campaign = await getCampaign(id);
  if (!campaign) throw fail('That campaign is gone.', 404);
  const [leads, log, opens] = await Promise.all([listLeads(), readJson(files.log(id), {}), readJson(files.opens(id), {})]);
  const audience = audienceOf(campaign, leads);
  const remaining = audience.filter((l) => !log[l.email]).length;
  const failures = Object.entries(log)
    .filter(([, v]) => v.s === 'failed')
    .slice(0, 50)
    .map(([email, v]) => ({ email, error: v.e || '' }));
  const openStats = openStatsFromMap(opens);
  // Keep campaign.stats in sync for the list view without rewriting on every details fetch.
  const stats = {
    ...emptyStats(campaign.stats || {}),
    ...openStats,
    sent: campaign.stats?.sent || 0,
    failed: campaign.stats?.failed || 0,
  };
  const analytics = buildCampaignAnalytics(campaign, leads, log, opens);
  return {
    campaign: { ...campaign, stats, remaining, pauseReason: campaign.pauseReason || '' },
    audience: audience.length,
    remaining,
    unfinished: remaining > 0 && campaign.status !== 'draft',
    pauseReason: campaign.pauseReason || '',
    failures,
    analytics,
  };
}

// ---------- rendering ----------

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function mergeValues(lead) {
  const first = lead?.firstName || '';
  const values = {
    first_name: first,
    last_name: lead?.lastName || '',
    name: [lead?.firstName, lead?.lastName].filter(Boolean).join(' '),
    company: lead?.company || '',
    email: lead?.email || '',
  };
  // CSV / manual metadata: core fields win if a meta key collides.
  const meta = lead?.meta && typeof lead.meta === 'object' ? lead.meta : {};
  for (const [key, value] of Object.entries(meta)) {
    const k = metaKey(key);
    if (!k || CORE_MERGE.includes(k) || values[k] !== undefined) continue;
    values[k] = String(value ?? '');
  }
  return values;
}

// {{first_name}} or {{first_name|there}} (fallback when the known field is empty).
// Unknown tags (no core field and no lead.meta key) stay as written so typos and unused
// {{subject}} placeholders are visible in previews instead of silently blanking the subject.
export function merge(template, lead) {
  const values = mergeValues(lead);
  return String(template || '').replace(/\{\{\s*([a-z_]+)\s*(?:\|([^}]*))?\}\}/gi, (match, key, fallback) => {
    const k = key.toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(values, k)) return match;
    return values[k] || (fallback ?? '').trim();
  });
}

const IMG_STYLE = 'display:block;max-width:100%;height:auto;border:0;outline:none;text-decoration:none';

/** Safe http(s) URL for an <img src> after merge + HTML escaping (entities allowed). */
function safeImageSrc(raw) {
  const value = String(raw || '')
    .trim()
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
  if (!/^https?:\/\//i.test(value)) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return escapeHtml(url.toString());
  } catch {
    return '';
  }
}

/** Replace markdown images, allowing nested parentheses in the URL (e.g. rejected javascript:alert(1)). */
function replaceMarkdownImages(html) {
  let out = '';
  let i = 0;
  while (i < html.length) {
    if (html.startsWith('![', i)) {
      const altEnd = html.indexOf(']', i + 2);
      if (altEnd !== -1 && html[altEnd + 1] === '(') {
        let depth = 1;
        let j = altEnd + 2;
        while (j < html.length && depth > 0) {
          if (html[j] === '(') depth++;
          else if (html[j] === ')') depth--;
          j++;
        }
        if (depth === 0) {
          const alt = html.slice(i + 2, altEnd);
          const url = html.slice(altEnd + 2, j - 1);
          const src = safeImageSrc(url);
          if (src) out += `<img src="${src}" alt="${alt}" width="600" style="${IMG_STYLE};margin:0 0 16px" />`;
          i = j;
          continue;
        }
      }
    }
    out += html[i];
    i++;
  }
  return out;
}

const LINK_REL = 'noopener noreferrer';

/** Peel trailing sentence punctuation off a bare URL so "https://x.com." keeps the period outside the href. */
function splitBareUrl(raw) {
  let url = raw;
  let trail = '';
  while (url.length > 8 && /[.,;:!?]$/.test(url)) {
    trail = url.slice(-1) + trail;
    url = url.slice(0, -1);
  }
  // Drop a closing paren that was only balancing an opener outside the URL (e.g. "(https://x.com)").
  if (url.endsWith(')') && (url.match(/\(/g) || []).length < (url.match(/\)/g) || []).length) {
    trail = ')' + trail;
    url = url.slice(0, -1);
  }
  return { url, trail };
}

function anchorHtml(href, label) {
  return `<a href="${href}" rel="${LINK_REL}">${label}</a>`;
}

// A small, safe Markdown subset: paragraphs, line breaks, images, **bold**, _italic_, [links](https://…) and bare links.
// Images support merge-bound URLs/alts after merge() runs: ![{{product}}]({{hero_image|https://fallback}}).
// Bare http(s) URLs become anchors after markdown links/images so we never double-link or link image srcs as text.
export function bodyHtml(body) {
  return body
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) => {
      let html = escapeHtml(paragraph);
      // Images before links so ![alt](url) is not treated as a markdown link.
      html = replaceMarkdownImages(html);
      html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => anchorHtml(url, label));
      // Bare URLs: only after whitespace/`(`/start, so href="…" inside <a>/<img> is skipped.
      html = html.replace(/(^|[\s(])(https?:\/\/[^\s<]+)/g, (_, pre, raw) => {
        const { url, trail } = splitBareUrl(raw);
        if (!/^https?:\/\/[^\s<]+$/i.test(url)) return `${pre}${raw}`;
        return `${pre}${anchorHtml(url, url)}${trail}`;
      });
      html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|\W)_([^_]+)_(?=\W|$)/g, '$1<em>$2</em>');
      const trimmed = html.replace(/^(?:<br>\s*)+|(?:<br>\s*)+$/g, '').trim();
      if (!trimmed) return '';
      // A paragraph that is only an image: skip the wrapping <p> margins doubling up.
      if (/^<img\b[^>]*>$/i.test(trimmed)) return trimmed;
      return `<p style="margin:0 0 16px">${html.replace(/\n/g, '<br>')}</p>`;
    })
    .filter(Boolean)
    .join('\n');
}

function bannerSrc(campaign, lead) {
  // External / merge URL wins when it resolves; otherwise use the uploaded asset's public URL.
  const fromUrl = safeImageSrc(merge(campaign.bannerImageUrl || '', lead));
  if (fromUrl) return fromUrl;
  const ctx = currentContext();
  if (campaign.bannerAssetId && isEmailId(campaign.bannerAssetId) && ctx?.org?.id) {
    return escapeHtml(bannerPublicUrl(ctx.org.id, campaign.id, campaign.bannerAssetId));
  }
  return '';
}

function bannerHtml(campaign, lead) {
  if (!campaign?.bannerEnabled) return '';
  const src = bannerSrc(campaign, lead);
  if (!src) return '';
  const href = cleanHttpUrl(merge(campaign.bannerLinkUrl || '', lead));
  const alt = escapeHtml(text(campaign.name, 80) || 'Email banner');
  const img = `<img src="${src}" alt="${alt}" width="600" style="${IMG_STYLE};width:100%;max-width:600px" />`;
  const inner = href
    ? `<a href="${escapeHtml(href)}" style="text-decoration:none;border:0">${img}</a>`
    : img;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 20px;border-collapse:collapse"><tr><td style="padding:0">${inner}</td></tr></table>`;
}

function unsubscribeUrl(orgId, leadId) {
  return `${appUrl()}/public/unsubscribe/${orgId}/${leadId}?sig=${sign(`unsub:${orgId}:${leadId}`)}`;
}

export function verifyUnsubscribe(orgId, leadId, sig) {
  return verifySignature(`unsub:${orgId}:${leadId}`, sig);
}

function openPayload(orgId, campaignId, leadId) {
  return `open:${orgId}:${campaignId}:${leadId}`;
}

export function openTrackingUrl(orgId, campaignId, leadId) {
  return `${appUrl()}/public/open/${orgId}/${campaignId}/${leadId}?sig=${sign(openPayload(orgId, campaignId, leadId))}`;
}

export function verifyOpen(orgId, campaignId, leadId, sig) {
  return isEmailId(campaignId) && isEmailId(leadId) && verifySignature(openPayload(orgId, campaignId, leadId), sig);
}

function trackingPixelHtml(orgId, campaignId, leadId) {
  if (!campaignId || !leadId) return '';
  const src = openTrackingUrl(orgId, campaignId, leadId);
  return `<img src="${src}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;outline:none" />`;
}

export function renderEmail(campaign, lead) {
  const ctx = currentContext();
  const orgName = ctx?.org?.name || 'us';
  const unsubscribe = unsubscribeUrl(ctx.org.id, lead.id);
  const postal = cfg.EMAIL_POSTAL_ADDRESS || '';
  const body = merge(campaign.body, lead);
  const footerText = `\n\n--\n${postal}\nYou’re receiving this because you’re on ${orgName}’s list. Unsubscribe: ${unsubscribe}`;
  const pixel = trackingPixelHtml(ctx.org.id, campaign.id, lead.id);
  const html = `<!doctype html><html><body style="margin:0;padding:24px;font:16px/1.55 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1a1a2e">
<div style="max-width:600px;margin:0 auto">
${bannerHtml(campaign, lead)}
${bodyHtml(body)}
<hr style="border:0;border-top:1px solid #e5e5ef;margin:28px 0 12px">
<p style="margin:0;font-size:12px;color:#77778a">${escapeHtml(postal)}<br>You’re receiving this because you’re on ${escapeHtml(orgName)}’s list. <a href="${unsubscribe}" style="color:#77778a">Unsubscribe</a></p>
${pixel}
</div></body></html>`;
  return {
    subject: merge(campaign.subject, lead),
    html,
    text: body + footerText,
    headers: { 'List-Unsubscribe': `<${unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  };
}

// ---------- sending ----------

async function resend(pathname, body, idempotencyKey) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${RESEND}${pathname}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'User-Agent': 'socialbrewery',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 429 || res.status >= 500) {
      const wait = Math.min(10, Number(res.headers.get('retry-after')) || 2 ** attempt);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (!res.ok) throw fail(data.message || data.error?.message || `Resend returned ${res.status}.`, res.status === 401 || res.status === 403 ? 400 : 502);
    return data;
  }
  throw fail('Resend is rate limiting or unavailable. Try again in a minute.', 503);
}

// ---------- transports ----------
// Both providers take the same rendered messages, so merge fields, unsubscribe links and headers,
// suppression, chunking, and the send log are identical whichever one an organisation picks.

let smtpConnector = connectSmtp;
/** For tests: replace the SMTP connection factory. */
export function setSmtpConnector(fn) {
  smtpConnector = fn || connectSmtp;
}

function smtpMessage(msg) {
  return { to: msg.to[0], subject: msg.subject, html: msg.html, text: msg.text, headers: msg.headers, replyTo: msg.reply_to };
}

async function openSmtp() {
  const options = smtpOptions();
  const problems = validateSmtp(options);
  if (problems.length) throw fail(problems[0]);
  try {
    return await smtpConnector(options);
  } catch (err) {
    throw fail(err.message, err.permanent ? 400 : 502);
  }
}

/** Sends one message through the chosen provider. */
async function deliverOne(msg) {
  if (emailProvider() === 'resend') return resend('/emails', msg);
  const session = await openSmtp();
  try {
    return await session.send(smtpMessage(msg));
  } catch (err) {
    throw fail(err.message, err.permanent ? 400 : 502);
  } finally {
    await session.close();
  }
}

/** Sends a batch; returns one result per message: { id } or { error }. Throws when nothing can go. */
async function deliverBatch(messages, idempotencyKey) {
  if (emailProvider() === 'resend') {
    const data = await resend('/emails/batch', messages, idempotencyKey);
    return messages.map((_, j) => ({ id: data.data?.[j]?.id || '' }));
  }
  const session = await openSmtp();
  const out = [];
  try {
    for (const msg of messages) {
      try {
        out.push({ id: (await session.send(smtpMessage(msg))).id || '' });
      } catch (err) {
        // A lost connection fails the rest of the batch; a refused address only fails that one.
        if (!err.code) {
          while (out.length < messages.length) out.push({ error: err.message });
          break;
        }
        out.push({ error: err.message });
      }
    }
  } finally {
    await session.close();
  }
  return out;
}

/** Connects (and for SMTP, signs in) without sending, for Settings → Email → Verify connection. */
export async function verifyEmailConnection() {
  const provider = emailProvider();
  if (provider === 'smtp') {
    const session = await openSmtp();
    await session.close();
    return { ok: true, provider, message: `Connected to ${cfg.SMTP_HOST} and signed in.` };
  }
  if (!cfg.RESEND_API_KEY) throw fail('Add your Resend API key first.');
  const res = await fetch(`${RESEND}/domains`, { headers: { Authorization: `Bearer ${cfg.RESEND_API_KEY}`, 'User-Agent': 'socialbrewery' } });
  if (res.status === 401 || res.status === 403) {
    // Sending-only keys can't list domains but are still valid.
    const data = await res.json().catch(() => ({}));
    if (/restricted/i.test(data.message || data.name || '')) return { ok: true, provider, message: 'Resend accepted the key (sending only).' };
    throw fail('Resend rejected the API key.');
  }
  if (!res.ok) throw fail(`Resend returned ${res.status}.`, 502);
  return { ok: true, provider, message: 'Resend accepted the API key.' };
}

/** Sends a plain test email to check the settings, without needing a campaign. */
export async function sendSettingsTest(to) {
  const status = emailStatus();
  if (!status.ready) throw fail(`Add your ${status.missing.join(', ')} first.`);
  const email = normalizeEmail(to);
  if (!email) throw fail('Enter the address to send the test to.');
  const text = `This is a test from Socialbrewery. Your ${status.provider === 'smtp' ? 'SMTP server' : 'Resend account'} is set up to send to your leads.\n\n${cfg.EMAIL_POSTAL_ADDRESS}`;
  const data = await deliverOne({
    from: cfg.EMAIL_FROM,
    to: [email],
    subject: 'Socialbrewery test email',
    text,
    html: `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`,
    ...(cfg.EMAIL_REPLY_TO ? { reply_to: cfg.EMAIL_REPLY_TO } : {}),
  });
  return { id: data.id || '', to: email, provider: status.provider };
}

function message(campaign, lead) {
  const email = renderEmail(campaign, lead);
  return {
    from: cfg.EMAIL_FROM,
    to: [lead.email],
    subject: email.subject,
    html: email.html,
    text: email.text,
    headers: email.headers,
    ...(cfg.EMAIL_REPLY_TO ? { reply_to: cfg.EMAIL_REPLY_TO } : {}),
    tags: [{ name: 'campaign', value: campaign.id }],
  };
}

const EMPTY_SUBJECT_HINT =
  'Subject is empty after merge fields. Use plain text, a fallback like {{first_name|Hi}}, or a CSV column such as {{subject}}. Built-in fields: first_name, last_name, name, company, email; any other CSV column works as {{column_name}}.';

function assertReady(campaign) {
  const status = emailStatus();
  if (!status.ready) throw fail(`Add your ${status.missing.join(', ')} in Settings → Email before sending.`);
  if (!campaign.subject.trim()) throw fail('Give the campaign a subject.');
  if (!campaign.body.trim()) throw fail('Write the email first.');
  // Blank sample: known empty fields become "" (or their fallback). Unknown tags stay as written.
  // A subject that is only {{first_name}} with no fallback would hang some SMTP servers on DATA.
  if (!merge(campaign.subject, {}).trim()) throw fail(EMPTY_SUBJECT_HINT);
}

export async function sendTest(id, to) {
  const campaign = await getCampaign(id);
  if (!campaign) throw fail('That campaign is gone.', 404);
  assertReady(campaign);
  const email = normalizeEmail(to);
  if (!email) throw fail('Enter the address to send the test to.');
  // A real lead fills the merge fields, but the unsubscribe link points nowhere, so clicking it in a
  // test can't unsubscribe that person.
  const lead = (await listLeads()).find((l) => l.status === 'subscribed') || { firstName: 'Alex', lastName: 'Sample', company: 'Example Co' };
  const sample = { ...lead, id: '0'.repeat(16), email };
  const payload = { ...message(campaign, sample), subject: `[Test] ${merge(campaign.subject, sample)}` };
  const data = await deliverOne(payload);
  return { id: data.id || '', to: email };
}

/** Config problems that should pause the campaign (same failure on every batch until fixed). */
function isConfigSendError(err) {
  return err?.status === 400 && /api key|domain|from|verify|smtp|password|cloudflare/i.test(String(err.message || ''));
}

/**
 * Provider credit / quota / rate / daily limits — leave unattempted recipients as leftovers so the
 * user can resume later (e.g. next day). Do not write permanent `failed` log rows for these.
 */
export function isProviderLimitError(err) {
  const status = Number(err?.status) || 0;
  if (status === 429 || status === 402 || status === 503) return true;
  const msg = String(err?.message || '');
  if (/rate.?limit|too many requests|quota|credits?|daily.?limit|insufficient|payment required|billing|concurrency|try again later/i.test(msg)) {
    return true;
  }
  // SMTP soft deferrals / temp unavailability that often mean greylisting or daily caps.
  if (/\b(421|450|451|452)\b/.test(msg)) return true;
  return false;
}

async function finalizeCampaignSend(id, { results, audience, pauseReason }) {
  const merged = await updateJson(files.log(id), {}, (current) => ({ ...(current || {}), ...results }));
  const sentEmails = new Set(Object.entries(results).filter(([, r]) => r.s === 'sent').map(([e]) => e));
  if (sentEmails.size) {
    await updateJson(files.leads(), [], (list) => list.map((l) => (sentEmails.has(l.email) ? { ...l, lastEmailedAt: now() } : l)));
  }
  // Leftovers = still eligible and never successfully logged (failed rows stay out of remaining).
  const remaining = audience.filter((l) => !merged[l.email]).length;
  const all = Object.values(merged);
  const openMap = await readJson(files.opens(id), {});
  const openEntries = openMap && typeof openMap === 'object' ? Object.values(openMap) : [];
  const stats = emptyStats({
    sent: all.filter((r) => r.s === 'sent').length,
    failed: all.filter((r) => r.s === 'failed').length,
    opens: openEntries.length,
    openCount: openEntries.reduce((n, e) => n + (Number(e?.n) || 0), 0),
  });
  const failedNow = Object.values(results).filter((r) => r.s === 'failed').length;
  let status;
  if (pauseReason) status = 'paused';
  else status = remaining <= 0 ? 'sent' : 'sending';
  await updateJson(files.campaigns(), [], (list) =>
    list.map((c) =>
      c.id === id
        ? {
            ...c,
            status,
            stats,
            remaining,
            pauseReason: pauseReason || '',
            ...(status === 'sent' ? { sentAt: now() } : {}),
          }
        : c,
    ),
  );
  return {
    status,
    sentNow: sentEmails.size,
    failedNow,
    remaining,
    stats,
    pauseReason: pauseReason || '',
  };
}

// Sends the next chunk of a campaign and returns progress; call again until remaining is 0. Each
// address is tried once per send; permanent failures are kept in the log and can be retried with
// retryFailed. Provider credit/quota/rate limits leave leftovers unlogged so Resume can continue
// later. Each batch has an idempotency key from its recipients, so a doubled request can't send twice.
export async function sendCampaignChunk(id) {
  const campaign = await getCampaign(id);
  if (!campaign) throw fail('That campaign is gone.', 404);
  assertReady(campaign);
  const [leads, block, log] = await Promise.all([listLeads(), suppressed(), readJson(files.log(id), {})]);
  const audience = audienceOf(campaign, leads).filter((l) => !block.has(l.email));
  if (!audience.length) throw fail('No subscribed leads match this campaign’s audience.');
  const pending = audience.filter((l) => !log[l.email]);
  const perCall = emailProvider() === 'smtp' && onWorkers() ? SMTP_MAX_PER_CALL_WORKERS : MAX_PER_CALL;
  const chunk = pending.slice(0, perCall);

  await updateJson(files.campaigns(), [], (list) =>
    list.map((c) =>
      c.id === id && c.status !== 'sending'
        ? { ...c, status: 'sending', pauseReason: '', startedAt: c.startedAt || now() }
        : c.id === id
          ? { ...c, pauseReason: '' }
          : c,
    ),
  );
  const results = {};
  let stopReason = '';
  let stopError = null;
  for (let i = 0; i < chunk.length; i += BATCH) {
    const batch = chunk.slice(i, i + BATCH);
    // Skip addresses whose merged subject is blank (e.g. {{subject}} with no CSV value) so SMTP
    // never sees an empty Subject header.
    const deliverable = [];
    for (const lead of batch) {
      const msg = message(campaign, lead);
      if (!String(msg.subject || '').trim()) {
        results[lead.email] = { s: 'failed', e: 'Subject is empty after merge fields for this lead.', at: now() };
      } else {
        deliverable.push({ lead, msg });
      }
    }
    if (!deliverable.length) continue;
    const key = `sb-${id}-${sha256(deliverable.map(({ lead }) => lead.email).join(',')).slice(0, 32)}`;
    try {
      const sent = await deliverBatch(
        deliverable.map(({ msg }) => msg),
        key,
      );
      deliverable.forEach(({ lead }, j) => {
        const r = sent[j] || { error: 'Not sent.' };
        results[lead.email] = r.error ? { s: 'failed', e: r.error, at: now() } : { s: 'sent', id: r.id || '', at: now() };
      });
    } catch (err) {
      // Bad key / unverified domain: pause after saving any earlier successes; do not strand them.
      if (isConfigSendError(err)) {
        stopReason = 'config';
        stopError = err;
        break;
      }
      // Credits, daily quotas, rate limits: leave this batch (and the rest of the chunk) as leftovers.
      if (isProviderLimitError(err)) {
        stopReason = 'provider_limit';
        stopError = err;
        break;
      }
      deliverable.forEach(({ lead }) => (results[lead.email] = { s: 'failed', e: err.message, at: now() }));
    }
    if (stopReason) break;
    if (i + BATCH < chunk.length) await new Promise((r) => setTimeout(r, 150));
  }

  const progress = await finalizeCampaignSend(id, { results, audience, pauseReason: stopReason });
  if (stopReason === 'provider_limit') {
    const n = progress.remaining;
    throw fail(
      `Sending paused because of provider credits, rate limits, or daily email quotas. ${n} recipient${n === 1 ? '' : 's'} still waiting — resume when your quota resets (for example, tomorrow).`,
      stopError?.status || 503,
    );
  }
  if (stopReason === 'config') throw stopError;
  return progress;
}

/** Clears failed addresses from the log so the next send tries them again. */
export async function retryFailed(id) {
  let cleared = 0;
  await updateJson(files.log(id), {}, (log) => {
    const next = {};
    for (const [email, entry] of Object.entries(log || {})) {
      if (entry.s === 'failed') cleared++;
      else next[email] = entry;
    }
    return next;
  });
  if (cleared) await updateJson(files.campaigns(), [], (list) => list.map((c) => (c.id === id ? { ...c, status: 'sending' } : c)));
  return { cleared };
}

// ---------- open tracking ----------

/** Records an open for a real campaign lead. Test-pixel lead ids and unknown leads are ignored. */
export async function recordOpen(campaignId, leadId) {
  if (!isEmailId(campaignId) || !isEmailId(leadId) || leadId === TEST_LEAD_ID) return false;
  const campaign = await getCampaign(campaignId);
  if (!campaign) return false;
  const lead = (await listLeads()).find((l) => l.id === leadId);
  if (!lead) return false;
  let created = false;
  const opens = await updateJson(files.opens(campaignId), {}, (current) => {
    const map = current && typeof current === 'object' ? { ...current } : {};
    const prev = map[leadId];
    if (!prev) {
      created = true;
      map[leadId] = { n: 1, first: now(), last: now(), email: lead.email };
    } else {
      map[leadId] = { ...prev, n: (Number(prev.n) || 0) + 1, last: now(), email: prev.email || lead.email };
    }
    return map;
  });
  const entries = Object.values(opens || {});
  const openStats = {
    opens: entries.length,
    openCount: entries.reduce((n, e) => n + (Number(e?.n) || 0), 0),
  };
  await updateJson(files.campaigns(), [], (list) =>
    list.map((c) =>
      c.id === campaignId
        ? { ...c, stats: emptyStats({ ...(c.stats || {}), ...openStats }) }
        : c,
    ),
  );
  return created || true;
}

// ---------- unsubscribe and Resend webhooks ----------

export async function unsubscribeLead(leadId) {
  const lead = (await listLeads()).find((l) => l.id === leadId);
  if (!lead) return false;
  await suppress(lead.email, 'unsubscribed');
  return true;
}

export function unsubscribePage({ orgName, done, action }) {
  const title = done ? 'You’re unsubscribed' : `Unsubscribe from ${orgName}?`;
  const body = done
    ? `<p>You won’t get more emails from ${escapeHtml(orgName)}.</p>`
    : `<p>You’ll stop getting emails from ${escapeHtml(orgName)}.</p><form method="post" action="${escapeHtml(action)}"><button type="submit">Unsubscribe</button></form>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f6fb;color:#1a1a2e;font:16px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif}main{max-width:420px;margin:24px;padding:28px;background:#fff;border:1px solid #e5e5ef;border-radius:16px}h1{font-size:22px;margin:0 0 8px}button{margin-top:8px;padding:10px 18px;border:0;border-radius:10px;background:#1a1a2e;color:#fff;font:inherit;cursor:pointer}</style>
</head><body><main><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`;
}

// Svix signing: base64 HMAC-SHA256 of "id.timestamp.body" with the base64 key after "whsec_".
export function verifyResendWebhook(headers, raw, secret) {
  const id = headers['svix-id'];
  const timestamp = headers['svix-timestamp'];
  const signatures = String(headers['svix-signature'] || '').split(' ');
  if (!id || !timestamp || !secret) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 5 * 60) return false;
  const key = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${raw}`).digest('base64');
  return signatures.some((s) => safeEqual(s.split(',')[1] || '', expected));
}

export async function applyResendEvent(event) {
  const type = event?.type;
  const recipients = (Array.isArray(event?.data?.to) ? event.data.to : [event?.data?.to]).map(normalizeEmail).filter(Boolean);
  let reason = '';
  if (type === 'email.complained') reason = 'complained';
  else if (type === 'email.suppressed') reason = 'bounced';
  else if (type === 'email.bounced' && String(event.data?.bounce?.type || '').toLowerCase() !== 'transient') reason = 'bounced';
  if (!reason) return 0;
  for (const email of recipients) await suppress(email, reason);
  return recipients.length;
}

// ---------- drafting with Grok or Claude ----------

export const DRAFT_SYSTEM = `You write marketing and outreach emails for a small team.
Return only JSON: {"subject": "...", "body": "..."}.
- The subject is specific and under 70 characters, no clickbait, no ALL CAPS, no emoji unless asked.
- The body is plain text with blank lines between short paragraphs, under 180 words, written like a person, with one clear call to action.
- Personalise with merge fields where it reads naturally: {{first_name|there}}, {{company}}. Use only these fields.
- Don't add a signature placeholder, an unsubscribe line, or a postal address; those are added automatically.
- Never invent facts, numbers, customers, or offers the brief doesn't give you.`;

export function parseDraft(content) {
  const raw = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  try {
    const data = JSON.parse(raw.slice(start, end + 1));
    return { subject: text(data.subject, 200), body: String(data.body || '').slice(0, 20000) };
  } catch {
    throw fail('The assistant didn’t return a usable draft. Try again.', 502);
  }
}
