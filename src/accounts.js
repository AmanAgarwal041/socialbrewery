import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { dataDir } from './paths.js';
import { isOrgId, orgDataDir, runWithOrg } from './context.js';
import { legacyOrgSettings, orgDefaults, stripLegacyOrgSettings } from './env.js';
import { clerkOrganization, clerkUser, verifiedEmails } from './clerk.js';
import { decryptJson, encryptJson, isEncrypted, randomToken, sha256 } from './secure.js';
import { NETWORKS, enqueue, readJson, systemDir, writeJson, writeNetworkToken } from './store.js';
import { onWorkers } from './storage.js';

// People, memberships, roles, and invites live in Clerk. Socialbrewery keeps one record per organisation
// here, keyed by its own id (data paths and encryption are bound to it), with the Clerk organisation it
// belongs to in clerkId.
const orgsFile = path.join(systemDir, 'orgs.json');
// From before Clerk: read only, to hand an owner's existing organisation to their Clerk organisation.
const legacyUsersFile = path.join(systemDir, 'users.json');
const legacyMembersFile = path.join(systemDir, 'members.json');

export const ROLES = ['owner', 'admin', 'member'];
const RANK = { member: 1, admin: 2, owner: 3 };

export function roleAtLeast(role, needed) {
  return (RANK[role] || 0) >= RANK[needed];
}

function newId() {
  return randomBytes(12).toString('hex');
}

async function list(file) {
  const value = await readJson(file, []);
  return Array.isArray(value) ? value : [];
}

function update(file, mutator) {
  return enqueue(async () => {
    const next = await mutator(await list(file));
    await writeJson(file, next);
    return next;
  });
}

// ---------- organisation settings (encrypted) ----------

function configFile(orgId) {
  return path.join(orgDataDir(orgId), 'config.json');
}

export async function loadOrgConfig(orgId) {
  const stored = await readJson(configFile(orgId), null);
  const values = isEncrypted(stored) ? decryptJson(stored, `${orgId}:config`) : {};
  return Object.freeze({ ...orgDefaults(), ...values });
}

export async function saveOrgConfig(orgId, values) {
  const config = Object.freeze({ ...orgDefaults(), ...values });
  const box = encryptJson(config, `${orgId}:config`);
  await enqueue(() => writeJson(configFile(orgId), box));
  await update(orgsFile, (orgs) =>
    orgs.map((org) => (org.id === orgId ? { ...org, connectorHash: config.CONNECTOR_TOKEN ? sha256(config.CONNECTOR_TOKEN) : '' } : org)),
  );
  return config;
}

export async function rotateConnectorToken(orgId) {
  const config = await loadOrgConfig(orgId);
  return saveOrgConfig(orgId, { ...config, CONNECTOR_TOKEN: randomToken(24) });
}

// ---------- organisations ----------

export async function getOrg(orgId) {
  if (!isOrgId(orgId)) return null;
  return (await list(orgsFile)).find((org) => org.id === orgId) || null;
}

export async function findOrgByConnectorToken(token) {
  if (!token) return null;
  const hash = sha256(token);
  return (await list(orgsFile)).find((org) => org.connectorHash && org.connectorHash === hash) || null;
}

export async function createOrg({ name, clerkId = '', createdBy = '', config = {} }) {
  const org = {
    id: newId(),
    clerkId,
    name: String(name || '').trim().slice(0, 80) || 'My organisation',
    createdAt: new Date().toISOString(),
    createdBy,
    connectorHash: '',
  };
  await update(orgsFile, (orgs) => [...orgs, org]);
  await saveOrgConfig(org.id, { ...config, CONNECTOR_TOKEN: config.CONNECTOR_TOKEN || randomToken(24) });
  return org;
}

async function linkOrg(orgId, fields) {
  let linked = null;
  await update(orgsFile, (orgs) =>
    orgs.map((org) => {
      if (org.id !== orgId) return org;
      linked = { ...org, ...fields };
      return linked;
    }),
  );
  return linked;
}

// The oldest organisation from before Clerk that this person owned and that no Clerk organisation has
// claimed yet, matched by verified email.
async function unclaimedLegacyOrg(emails) {
  if (!emails.length) return null;
  const [users, members, orgs] = await Promise.all([list(legacyUsersFile), list(legacyMembersFile), list(orgsFile)]);
  const userIds = new Set(users.filter((u) => (u.emails || [u.email]).some((e) => emails.includes(String(e || '').toLowerCase()))).map((u) => u.id));
  if (!userIds.size) return null;
  const owned = new Set(members.filter((m) => m.role === 'owner' && userIds.has(m.userId)).map((m) => m.orgId));
  return orgs.find((org) => !org.clerkId && owned.has(org.id)) || null;
}

async function clerkDetails(clerkOrgId, clerkUserId) {
  const [org, user] = await Promise.all([
    clerkOrganization(clerkOrgId).catch((err) => {
      console.error(`Could not read Clerk organisation ${clerkOrgId}: ${err.message}`);
      return null;
    }),
    clerkUser(clerkUserId).catch((err) => {
      console.error(`Could not read Clerk user ${clerkUserId}: ${err.message}`);
      return null;
    }),
  ]);
  return { name: org?.name || '', emails: verifiedEmails(user) };
}

const linking = new Map();

// The Socialbrewery organisation behind a Clerk organisation, created on first use. The first Clerk
// organisation one of its admins opens takes over that admin's organisation from before Clerk, so keys,
// connected accounts, and posts carry over; on a fresh server the very first one also takes the
// single-user files from before organisations existed.
export async function orgForClerk({ clerkOrgId, clerkUserId, role }) {
  const known = (await list(orgsFile)).find((org) => org.clerkId === clerkOrgId);
  if (known) return known;
  if (!linking.has(clerkOrgId)) {
    const work = (async () => {
      const { name, emails } = await clerkDetails(clerkOrgId, clerkUserId);
      const again = (await list(orgsFile)).find((org) => org.clerkId === clerkOrgId);
      if (again) return again;
      const legacy = roleAtLeast(role, 'admin') ? await unclaimedLegacyOrg(emails) : null;
      if (legacy) return linkOrg(legacy.id, { clerkId: clerkOrgId, name: name || legacy.name });
      const first = await isFirstOrg();
      const org = await createOrg({ name: name || 'Organisation', clerkId: clerkOrgId, createdBy: clerkUserId });
      if (first) await migrateLegacyInto(org);
      return org;
    })().finally(() => linking.delete(clerkOrgId));
    linking.set(clerkOrgId, work);
  }
  return linking.get(clerkOrgId);
}

// ---------- moving the single-user setup into the first organisation ----------

const LEGACY_FILES = ['posts.json', 'history.json', 'media.json', 'analyses.json'];
const LEGACY_TOKENS = { youtube: 'youtube.json' };
for (const network of NETWORKS) if (network !== 'youtube') LEGACY_TOKENS[network] = `${network}.json`;

async function exists(file) {
  return fs.stat(file).then(() => true, () => false);
}

export async function isFirstOrg() {
  return (await list(orgsFile)).length === 0;
}

export async function migrateLegacyInto(org) {
  if (onWorkers()) return;
  const target = orgDataDir(org.id);
  await fs.mkdir(target, { recursive: true, mode: 0o700 });
  const settings = await legacyOrgSettings();
  if (Object.keys(settings).length) {
    const current = await loadOrgConfig(org.id);
    await saveOrgConfig(org.id, { ...current, ...settings, CONNECTOR_TOKEN: settings.CONNECTOR_TOKEN || current.CONNECTOR_TOKEN });
    await stripLegacyOrgSettings();
  }
  for (const name of LEGACY_FILES) {
    const from = path.join(dataDir, name);
    if (await exists(from)) await fs.rename(from, path.join(target, name));
  }
  const mediaFrom = path.join(dataDir, 'media');
  if (await exists(mediaFrom)) await fs.rename(mediaFrom, path.join(target, 'media'));
  await runWithOrg({ org, config: await loadOrgConfig(org.id) }, async () => {
    for (const [network, name] of Object.entries(LEGACY_TOKENS)) {
      const from = path.join(dataDir, name);
      const token = await readJson(from, null);
      if (token && typeof token === 'object') await writeNetworkToken(network, token);
      await fs.rm(from, { force: true });
    }
  });
  for (const name of await fs.readdir(dataDir).catch(() => [])) {
    if (/^oauth-.*\.json$/.test(name) || name === 'oauth-state.json') await fs.rm(path.join(dataDir, name), { force: true });
  }
}
