import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { dataDir } from './paths.js';
import { isOrgId, orgDataDir, runWithOrg } from './context.js';
import { legacyOrgSettings, orgDefaults, stripLegacyOrgSettings } from './env.js';
import { decryptJson, encryptJson, isEncrypted, randomToken, sha256 } from './secure.js';
import { NETWORKS, enqueue, readJson, systemDir, writeJson, writeNetworkToken } from './store.js';
import { onWorkers } from './storage.js';

const usersFile = path.join(systemDir, 'users.json');
const orgsFile = path.join(systemDir, 'orgs.json');
const membersFile = path.join(systemDir, 'members.json');
const invitesFile = path.join(systemDir, 'invites.json');
const sessionsFile = path.join(systemDir, 'sessions.json');
const authStatesFile = path.join(systemDir, 'auth-states.json');

export const ROLES = ['owner', 'admin', 'member'];
const RANK = { member: 1, admin: 2, owner: 3 };
const SESSION_DAYS = 30;
const INVITE_DAYS = 14;

export function roleAtLeast(role, needed) {
  return (RANK[role] || 0) >= RANK[needed];
}

function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
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

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
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

export async function createOrg({ name, ownerId, config = {} }) {
  const org = { id: newId(), name: String(name || '').trim().slice(0, 80) || 'My organisation', createdAt: new Date().toISOString(), createdBy: ownerId, connectorHash: '' };
  await update(orgsFile, (orgs) => [...orgs, org]);
  await update(membersFile, (members) => [...members, { orgId: org.id, userId: ownerId, role: 'owner', joinedAt: org.createdAt }]);
  await saveOrgConfig(org.id, { ...config, CONNECTOR_TOKEN: config.CONNECTOR_TOKEN || randomToken(24) });
  return org;
}

export async function renameOrg(orgId, name) {
  const clean = String(name || '').trim().slice(0, 80);
  if (!clean) throw fail('Give the organisation a name.');
  await update(orgsFile, (orgs) => orgs.map((org) => (org.id === orgId ? { ...org, name: clean } : org)));
  return getOrg(orgId);
}

// ---------- users ----------

export async function getUser(userId) {
  return (await list(usersFile)).find((user) => user.id === userId) || null;
}

// identity: { provider, subject, email, emails: [verified emails], name, picture }
export async function upsertUser(identity) {
  const emails = [...new Set([identity.email, ...(identity.emails || [])].map(normalizeEmail).filter(Boolean))];
  let result;
  await update(usersFile, (users) => {
    const now = new Date().toISOString();
    let user =
      users.find((u) => u.identities?.some((i) => i.provider === identity.provider && i.subject === identity.subject)) ||
      users.find((u) => (u.emails || []).some((e) => emails.includes(e)));
    if (!user) {
      user = { id: newId(), email: emails[0] || '', emails: [], name: '', picture: '', identities: [], createdAt: now };
      users.push(user);
    }
    if (!user.identities.some((i) => i.provider === identity.provider && i.subject === identity.subject)) {
      user.identities.push({ provider: identity.provider, subject: identity.subject });
    }
    user.emails = [...new Set([...(user.emails || []), ...emails])];
    user.email = user.email || emails[0] || '';
    user.name = identity.name || user.name || user.email;
    user.picture = identity.picture || user.picture || '';
    user.lastLoginAt = now;
    result = { ...user };
    return users;
  });
  return result;
}

export function publicUser(user) {
  return user ? { id: user.id, email: user.email, name: user.name, picture: user.picture } : null;
}

// ---------- memberships ----------

export async function membershipsFor(userId) {
  const [members, orgs] = await Promise.all([list(membersFile), list(orgsFile)]);
  return members
    .filter((m) => m.userId === userId)
    .map((m) => ({ ...m, org: orgs.find((o) => o.id === m.orgId) }))
    .filter((m) => m.org)
    .map((m) => ({ id: m.org.id, name: m.org.name, role: m.role }));
}

export async function membership(orgId, userId) {
  return (await list(membersFile)).find((m) => m.orgId === orgId && m.userId === userId) || null;
}

export async function listMembers(orgId) {
  const [members, users] = await Promise.all([list(membersFile), list(usersFile)]);
  return members
    .filter((m) => m.orgId === orgId)
    .map((m) => ({ ...publicUser(users.find((u) => u.id === m.userId)), role: m.role, joinedAt: m.joinedAt }))
    .filter((m) => m.id);
}

async function ownerCount(orgId, members) {
  return members.filter((m) => m.orgId === orgId && m.role === 'owner').length;
}

export async function setMemberRole({ orgId, actorRole, userId, role }) {
  if (!ROLES.includes(role)) throw fail('Role must be owner, admin, or member.');
  await update(membersFile, async (members) => {
    const target = members.find((m) => m.orgId === orgId && m.userId === userId);
    if (!target) throw fail('That person is not in this organisation.', 404);
    if ((target.role === 'owner' || role === 'owner') && actorRole !== 'owner') throw fail('Only an owner can change owners.', 403);
    if (target.role === 'owner' && role !== 'owner' && (await ownerCount(orgId, members)) <= 1) {
      throw fail('An organisation needs at least one owner.');
    }
    target.role = role;
    return members;
  });
}

export async function removeMember({ orgId, actorRole, userId }) {
  await update(membersFile, async (members) => {
    const target = members.find((m) => m.orgId === orgId && m.userId === userId);
    if (!target) throw fail('That person is not in this organisation.', 404);
    if (target.role === 'owner' && actorRole !== 'owner') throw fail('Only an owner can remove an owner.', 403);
    if (target.role === 'owner' && (await ownerCount(orgId, members)) <= 1) throw fail('An organisation needs at least one owner.');
    return members.filter((m) => m !== target);
  });
  await update(sessionsFile, (sessions) => sessions.map((s) => (s.userId === userId && s.orgId === orgId ? { ...s, orgId: '' } : s)));
}

// ---------- invites ----------

export async function listInvites(orgId) {
  const now = Date.now();
  return (await list(invitesFile))
    .filter((i) => i.orgId === orgId && Date.parse(i.expiresAt) > now)
    .map(({ tokenHash, ...invite }) => invite);
}

export async function createInvite({ orgId, email, role, invitedBy, actorRole }) {
  const clean = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw fail('Enter a valid email address.');
  if (!['admin', 'member'].includes(role) && !(role === 'owner' && actorRole === 'owner')) throw fail('Pick admin or member.');
  const members = await listMembers(orgId);
  if (members.some((m) => normalizeEmail(m.email) === clean)) throw fail('That person is already a member.');
  const token = randomToken(24);
  const invite = {
    id: newId(),
    orgId,
    email: clean,
    role,
    tokenHash: sha256(token),
    invitedBy,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + INVITE_DAYS * 86400000).toISOString(),
  };
  await update(invitesFile, (invites) => [...invites.filter((i) => !(i.orgId === orgId && i.email === clean)), invite]);
  const { tokenHash, ...shown } = invite;
  return { invite: shown, token };
}

export async function revokeInvite(orgId, inviteId) {
  await update(invitesFile, (invites) => invites.filter((i) => !(i.orgId === orgId && i.id === inviteId)));
}

export async function inviteByToken(token) {
  if (!token) return null;
  const hash = sha256(token);
  const invite = (await list(invitesFile)).find((i) => i.tokenHash === hash && Date.parse(i.expiresAt) > Date.now());
  if (!invite) return null;
  const org = await getOrg(invite.orgId);
  return org ? { id: invite.id, orgId: org.id, orgName: org.name, email: invite.email, role: invite.role } : null;
}

async function join(orgId, userId, role) {
  await update(membersFile, (members) => {
    if (members.some((m) => m.orgId === orgId && m.userId === userId)) return members;
    return [...members, { orgId, userId, role, joinedAt: new Date().toISOString() }];
  });
}

// Joins every pending invite sent to one of the user's verified emails; with a token, that invite must match too.
export async function acceptInvites(user, token) {
  const emails = new Set((user.emails || []).map(normalizeEmail));
  const hash = token ? sha256(token) : '';
  const now = Date.now();
  const matched = [];
  let tokenError = '';
  await update(invitesFile, (invites) => {
    const keep = [];
    for (const invite of invites) {
      const live = Date.parse(invite.expiresAt) > now;
      if (live && emails.has(invite.email)) {
        matched.push(invite);
        continue;
      }
      if (live && hash && invite.tokenHash === hash) {
        tokenError = `This invite was sent to ${invite.email}. Sign in with an account that uses that email.`;
      }
      if (live) keep.push(invite);
    }
    return keep;
  });
  for (const invite of matched) await join(invite.orgId, user.id, invite.role);
  return { accepted: matched.map((i) => i.orgId), tokenError };
}

// ---------- sessions ----------

export async function createSession(userId, orgId) {
  const token = randomToken(32);
  const now = Date.now();
  await update(sessionsFile, (sessions) => [
    ...sessions.filter((s) => Date.parse(s.expiresAt) > now),
    { hash: sha256(token), userId, orgId: orgId || '', createdAt: new Date(now).toISOString(), expiresAt: new Date(now + SESSION_DAYS * 86400000).toISOString() },
  ]);
  return { token, maxAge: SESSION_DAYS * 86400 };
}

export async function getSession(token) {
  if (!token) return null;
  const hash = sha256(token);
  const session = (await list(sessionsFile)).find((s) => s.hash === hash);
  if (!session || Date.parse(session.expiresAt) <= Date.now()) return null;
  return session;
}

export async function setSessionOrg(token, orgId) {
  const hash = sha256(token);
  await update(sessionsFile, (sessions) => sessions.map((s) => (s.hash === hash ? { ...s, orgId } : s)));
}

export async function deleteSession(token) {
  if (!token) return;
  const hash = sha256(token);
  await update(sessionsFile, (sessions) => sessions.filter((s) => s.hash !== hash));
}

// ---------- sign-in state ----------

export async function saveAuthState(record) {
  const token = randomToken(24);
  const now = Date.now();
  await update(authStatesFile, (states) => [
    ...states.filter((s) => s.exp > now),
    { ...record, hash: sha256(token), exp: now + 10 * 60 * 1000 },
  ]);
  return token;
}

export async function takeAuthState(token) {
  const hash = sha256(token || '');
  let found = null;
  await update(authStatesFile, (states) => {
    found = states.find((s) => s.hash === hash && s.exp > Date.now()) || null;
    return states.filter((s) => s.hash !== hash && s.exp > Date.now());
  });
  return found;
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
