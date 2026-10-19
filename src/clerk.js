import { appUrl } from './env.js';

// Sign-in runs on Clerk. The browser holds a short-lived Clerk session token (a JWT, about 60 seconds)
// and sends it as a Bearer header or the __session cookie; this file verifies it with Web Crypto, so the
// same code runs on Node and Workers without dependencies. Users, organisations, members, roles, and
// invites all live in Clerk. Keys come from .env: CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY.

const API = 'https://api.clerk.com/v1';
const SKEW_SECONDS = 5;
const JWKS_TTL_MS = 60 * 60 * 1000;

let jwksCache = { at: 0, keys: new Map() };
let pemKey = null;

function fail(message, status = 401) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function env(key) {
  return String(process.env[key] || '').trim();
}

export function clerkPublishableKey() {
  return env('CLERK_PUBLISHABLE_KEY');
}

export function clerkConfigured() {
  return Boolean(frontendApi() && (env('CLERK_SECRET_KEY') || env('CLERK_JWT_KEY')));
}

// pk_test_<base64("<frontend api host>$")>. The token issuer is that host.
export function frontendApi(publishableKey = clerkPublishableKey()) {
  const match = /^pk_(test|live)_(.+)$/.exec(publishableKey);
  if (!match) return '';
  try {
    const host = Buffer.from(match[2], 'base64').toString('utf8');
    return host.endsWith('$') ? host.slice(0, -1) : '';
  } catch {
    return '';
  }
}

function b64urlBytes(text) {
  return new Uint8Array(Buffer.from(text, 'base64url'));
}

function b64urlJson(text) {
  try {
    return JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

async function clerkFetch(pathname) {
  const secret = env('CLERK_SECRET_KEY');
  if (!secret) throw fail('CLERK_SECRET_KEY is not set on this server.', 500);
  const res = await fetch(`${API}${pathname}`, { headers: { Authorization: `Bearer ${secret}`, Accept: 'application/json' } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw fail(`Clerk returned ${res.status} for ${pathname.split('?')[0]}.`, 502);
  return data;
}

async function importJwk(jwk) {
  return crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
}

// CLERK_JWT_KEY (the PEM public key from the Clerk dashboard) verifies without any network call.
async function keyFromPem() {
  if (pemKey) return pemKey;
  const body = env('CLERK_JWT_KEY').replace(/\\n/g, '\n').replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '').replace(/\s+/g, '');
  pemKey = await crypto.subtle.importKey('spki', Buffer.from(body, 'base64'), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  return pemKey;
}

async function keyFor(kid) {
  if (env('CLERK_JWT_KEY')) return keyFromPem();
  const fresh = Date.now() - jwksCache.at < JWKS_TTL_MS;
  if (fresh && jwksCache.keys.has(kid)) return jwksCache.keys.get(kid);
  // An unknown kid after a key rotation refetches, but at most once a minute.
  if (!fresh || Date.now() - jwksCache.at > 60 * 1000) {
    const data = await clerkFetch('/jwks');
    const keys = new Map();
    for (const jwk of data.keys || []) if (jwk.kty === 'RSA' && jwk.kid) keys.set(jwk.kid, await importJwk(jwk));
    jwksCache = { at: Date.now(), keys };
  }
  const key = jwksCache.keys.get(kid);
  if (!key) throw fail('Your session was signed with an unknown key. Sign in again.');
  return key;
}

function authorizedParties(requestOrigins) {
  const extra = env('CLERK_AUTHORIZED_PARTIES').split(',').map((v) => v.trim().replace(/\/$/, '')).filter(Boolean);
  return new Set([new URL(appUrl()).origin, ...requestOrigins, ...extra]);
}

// Clerk's v2 tokens carry the active organisation as o.{id, rol}; v1 tokens use org_id and org_role ("org:admin").
function orgClaims(payload) {
  if (payload.v === 2) return { orgId: payload.o?.id || '', orgRole: payload.o?.rol || '' };
  return { orgId: payload.org_id || '', orgRole: String(payload.org_role || '').replace(/^org:/, '') };
}

// Clerk's built-in roles are admin and member. A custom "owner" role is honoured if the instance has one;
// any other custom role counts as member.
export function appRole(clerkRole) {
  return clerkRole === 'owner' || clerkRole === 'admin' ? clerkRole : 'member';
}

// Returns { userId, sessionId, orgId, role } for a valid token, or throws a 401.
export async function verifySessionToken(token, { requestOrigins = [] } = {}) {
  if (!token) throw fail('Sign in to continue.');
  if (!clerkConfigured()) throw fail('Sign-in is not set up on this server yet.', 503);
  const parts = String(token).split('.');
  if (parts.length !== 3) throw fail('Sign in to continue.');
  const header = b64urlJson(parts[0]);
  const payload = b64urlJson(parts[1]);
  if (!header || !payload || header.alg !== 'RS256') throw fail('Sign in to continue.');

  const key = await keyFor(header.kid);
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]), signed))) throw fail('Sign in to continue.');

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp + SKEW_SECONDS < now) throw fail('Your session expired. Sign in again.');
  if (typeof payload.nbf === 'number' && payload.nbf - SKEW_SECONDS > now) throw fail('Sign in to continue.');
  if (payload.iss !== `https://${frontendApi()}`) throw fail('That session belongs to a different Clerk application.');
  if (payload.azp && !authorizedParties(requestOrigins).has(payload.azp)) throw fail('That session was issued for a different site.');
  // A pending session still has a task to finish in Clerk (for example choosing an organisation).
  if (payload.sts === 'pending') throw fail('Finish signing in first.');
  if (!payload.sub) throw fail('Sign in to continue.');

  const { orgId, orgRole } = orgClaims(payload);
  return { userId: String(payload.sub), sessionId: String(payload.sid || ''), orgId, role: orgId ? appRole(orgRole) : null };
}

export async function clerkOrganization(orgId) {
  return clerkFetch(`/organizations/${encodeURIComponent(orgId)}`);
}

export async function clerkUser(userId) {
  return clerkFetch(`/users/${encodeURIComponent(userId)}`);
}

export function verifiedEmails(user) {
  return (user?.email_addresses || [])
    .filter((e) => e.verification?.status === 'verified' && e.email_address)
    .map((e) => String(e.email_address).trim().toLowerCase());
}

// For tests.
export function resetClerkKeys() {
  jwksCache = { at: 0, keys: new Map() };
  pemKey = null;
}
