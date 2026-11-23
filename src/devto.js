import { randomBytes } from 'node:crypto';
import { addPost, clearNetworkToken, readNetworkToken, writeNetworkToken } from './store.js';
import { cfg } from './context.js';

// DEV (dev.to) through the Forem API v1 with a personal API key (no OAuth). dev.to answers 403 to requests
// without a User-Agent, so every call sends one.

const API = 'https://dev.to/api';
const ACCEPT = 'application/vnd.forem.api-v1+json';
const USER_AGENT = 'Socialbrewery';
/** Forem's AI disclosure tiers (`ai_disclosure_level`). Articles the agent writes default to some_ai. */
export const DEVTO_AI_LEVELS = ['no_ai', 'some_ai', 'fully_autonomous'];

function apiKey() {
  const value = String(cfg.DEVTO_API_KEY || '').trim();
  if (!value) {
    const err = new Error('Add your DEV API key in Settings (an organisation admin can do this).');
    err.status = 400;
    throw err;
  }
  return value;
}

export async function devtoApi(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    redirect: 'manual',
    headers: {
      'api-key': apiKey(),
      Accept: ACCEPT,
      'User-Agent': USER_AGENT,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (res.ok) return data;
  let message = (data && (data.error || data.message)) || `DEV did not accept the request (${res.status}).`;
  if (res.status === 401) message = 'DEV rejected the API key. Create a new one under dev.to → Settings → Extensions, paste it in Settings, and reconnect.';
  else if (res.status === 404) message = 'DEV could not find that article or organisation. Check the id, and that the API key belongs to its author.';
  else if (res.status === 429) message = 'DEV is rate limiting this account (it allows only a few new articles a minute). Wait a minute and try again.';
  else if (res.status === 403) message = 'DEV refused the request. The API key may not have access to that article or organisation.';
  const err = new Error(message);
  err.status = res.status === 429 ? 429 : res.status >= 500 ? 502 : 400;
  throw err;
}

const httpsImage = (value) => (typeof value === 'string' && value.startsWith('https:') ? value : '');

export async function connectDevto() {
  const me = await devtoApi('/users/me');
  if (!me?.id) throw new Error('DEV did not return your account.');
  let organization = null;
  const wanted = String(cfg.DEVTO_ORGANIZATION || '').trim().replace(/^@/, '').replace(/^https?:\/\/dev\.to\//i, '').replace(/\/$/, '');
  if (wanted) {
    const org = await devtoApi(`/organizations/${encodeURIComponent(wanted)}`);
    if (!org?.id) throw new Error(`DEV has no organisation "${wanted}". Use the name in its dev.to URL.`);
    organization = { id: org.id, username: org.username || wanted, name: org.name || wanted, url: `https://dev.to/${org.username || wanted}` };
  }
  const account = {
    id: String(me.id),
    username: me.username || '',
    title: organization?.name || me.name || `@${me.username}`,
    name: me.name || '',
    picture: httpsImage(me.profile_image),
    url: me.username ? `https://dev.to/${me.username}` : 'https://dev.to',
    organization,
  };
  await writeNetworkToken('devto', { account, connectedAt: new Date().toISOString() });
  return account;
}

export async function devtoStatus() {
  const stored = await readNetworkToken('devto');
  const connected = Boolean(cfg.DEVTO_API_KEY && stored?.account?.id);
  return { connected, account: stored?.account || null };
}

export async function disconnectDevto() {
  await clearNetworkToken('devto');
}

async function account() {
  const stored = await readNetworkToken('devto');
  if (!cfg.DEVTO_API_KEY || !stored?.account?.id) {
    const err = new Error('Connect DEV on the Connectors page first.');
    err.status = 400;
    throw err;
  }
  return stored.account;
}

/** DEV tags: lowercase letters and digits only, at most 4. */
export function devtoTags(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(',');
  const tags = [];
  for (const raw of list) {
    const tag = String(raw || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 30);
    if (!tag || tags.includes(tag)) continue;
    tags.push(tag);
    if (tags.length === 4) break;
  }
  return tags;
}

function aiLevel(value) {
  const level = String(value || '').trim().toLowerCase();
  return DEVTO_AI_LEVELS.includes(level) ? level : '';
}

function articleBody({ title, content, tags, description, coverImageUrl, canonicalUrl, series, aiDisclosure }, { partial = false } = {}) {
  const article = {};
  const cleanTitle = String(title || '').trim();
  const markdown = String(content || '').trim();
  if (!partial || cleanTitle) {
    if (!cleanTitle) throw new Error('DEV needs a title.');
    article.title = cleanTitle.slice(0, 128);
  }
  if (!partial || markdown) {
    if (!markdown) throw new Error('DEV needs the article body in Markdown.');
    article.body_markdown = markdown;
  }
  if (tags != null && String(tags).trim()) article.tags = devtoTags(tags);
  if (String(description || '').trim()) article.description = String(description).trim().slice(0, 170);
  if (/^https:\/\//.test(String(coverImageUrl || ''))) article.main_image = coverImageUrl;
  if (/^https:\/\//.test(String(canonicalUrl || ''))) article.canonical_url = canonicalUrl;
  if (String(series || '').trim()) article.series = String(series).trim().slice(0, 128);
  const level = aiLevel(aiDisclosure);
  if (level) article.ai_disclosure_level = level;
  return article;
}

export async function publishDevto({ title, content, tags, description, coverImageUrl, canonicalUrl, series, aiDisclosure, draft, source }) {
  const acct = await account();
  const article = {
    ...articleBody({ title, content, tags, description, coverImageUrl, canonicalUrl, series, aiDisclosure }),
    published: !draft,
  };
  if (acct.organization?.id) article.organization_id = acct.organization.id;
  const created = await devtoApi('/articles', { method: 'POST', body: { article } });
  const devtoId = created?.id ? String(created.id) : '';
  const post = {
    id: randomBytes(8).toString('hex'),
    network: 'devto',
    title: article.title,
    description: article.body_markdown,
    tags: article.tags || [],
    devtoId,
    privacyStatus: draft ? 'draft' : '',
    // A draft's URL only works for its author, so link to its editor.
    url: draft ? (created?.url ? `${created.url}/edit` : 'https://dev.to/dashboard') : created?.url || '',
    createdAt: new Date().toISOString(),
    source: source || 'manual',
  };
  await addPost(post);
  return post;
}

export async function updateDevto({ post, title, content, tags, description, coverImageUrl, canonicalUrl, series, aiDisclosure, published }) {
  await account();
  const id = String(post || '').trim();
  if (!/^\d+$/.test(id)) throw new Error('Give the DEV article id (a number, from list_devto_articles).');
  const article = articleBody({ title, content, tags, description, coverImageUrl, canonicalUrl, series, aiDisclosure }, { partial: true });
  if (typeof published === 'boolean') article.published = published;
  if (!Object.keys(article).length) throw new Error('Say what to change on the DEV article.');
  const updated = await devtoApi(`/articles/${id}`, { method: 'PUT', body: { article } });
  return { devtoId: String(updated?.id || id), title: updated?.title || article.title || '', url: updated?.url || '', published: updated?.published ?? null };
}

export async function listDevtoPosts(limit = 20) {
  await account();
  const perPage = Math.min(50, Math.max(1, Number(limit) || 20));
  const items = await devtoApi(`/articles/me/all?per_page=${perPage}`);
  return (Array.isArray(items) ? items : []).map((item) => ({
    id: String(item.id),
    title: item.title || '',
    url: item.url || '',
    brief: item.description || '',
    published: Boolean(item.published),
    publishedAt: item.published_at || '',
    views: Number.isFinite(item.page_views_count) ? item.page_views_count : null,
    reactions: Number.isFinite(item.public_reactions_count) ? item.public_reactions_count : null,
    comments: Number.isFinite(item.comments_count) ? item.comments_count : null,
    readTime: item.reading_time_minutes || null,
    cover: httpsImage(item.cover_image),
    tags: Array.isArray(item.tag_list) ? item.tag_list : String(item.tag_list || '').split(',').map((t) => t.trim()).filter(Boolean),
  }));
}
