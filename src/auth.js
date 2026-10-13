import { createHash, randomBytes } from 'node:crypto';
import { appUrl } from './env.js';
import {
  acceptInvites,
  createOrg,
  createSession,
  isFirstOrg,
  membershipsFor,
  migrateLegacyInto,
  saveAuthState,
  takeAuthState,
  upsertUser,
} from './accounts.js';

// Sign-in apps belong to whoever runs the server, so their keys come from .env, not from an organisation.
const PROVIDERS = {
  google: {
    name: 'Google',
    idKey: 'GOOGLE_AUTH_CLIENT_ID',
    secretKey: 'GOOGLE_AUTH_CLIENT_SECRET',
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    pkce: true,
  },
  github: {
    name: 'GitHub',
    idKey: 'GITHUB_AUTH_CLIENT_ID',
    secretKey: 'GITHUB_AUTH_CLIENT_SECRET',
    authorize: 'https://github.com/login/oauth/authorize',
    token: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
    pkce: false,
  },
};

function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function provider(id) {
  const p = PROVIDERS[id];
  if (!p) throw fail('Unknown sign-in provider.', 404);
  return p;
}

export function authRedirectUri(id) {
  return `${appUrl()}/auth/${id}/callback`;
}

export function authProviders() {
  return Object.fromEntries(
    Object.entries(PROVIDERS).map(([id, p]) => [
      id,
      { enabled: Boolean(process.env[p.idKey] && process.env[p.secretKey]), redirectUri: authRedirectUri(id) },
    ]),
  );
}

export async function beginSignIn(id, { invite = '' } = {}) {
  const p = provider(id);
  const clientId = process.env[p.idKey];
  if (!clientId || !process.env[p.secretKey]) throw fail(`${p.name} sign-in is not set up on this server yet.`);
  const verifier = p.pkce ? randomBytes(32).toString('base64url') : '';
  const state = await saveAuthState({ provider: id, verifier, invite: String(invite || '').slice(0, 200) });
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: authRedirectUri(id),
    response_type: 'code',
    scope: p.scope,
    state,
  });
  if (p.pkce) {
    params.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'));
    params.set('code_challenge_method', 'S256');
    params.set('prompt', 'select_account');
  } else {
    params.set('allow_signup', 'true');
  }
  return `${p.authorize}?${params}`;
}

async function exchangeCode(id, code, verifier) {
  const p = provider(id);
  const body = new URLSearchParams({
    client_id: process.env[p.idKey] || '',
    client_secret: process.env[p.secretKey] || '',
    code,
    redirect_uri: authRedirectUri(id),
    grant_type: 'authorization_code',
  });
  if (verifier) body.set('code_verifier', verifier);
  const res = await fetch(p.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw fail(`${p.name} sign-in failed: ${data.error_description || data.error || res.status}.`);
  return data.access_token;
}

async function googleIdentity(accessToken) {
  const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } });
  const me = await res.json().catch(() => ({}));
  if (!res.ok || !me.sub) throw fail('Google did not return your profile.');
  if (!me.email || me.email_verified !== true) throw fail('Your Google email is not verified.');
  return { provider: 'google', subject: String(me.sub), email: me.email, emails: [me.email], name: me.name || '', picture: me.picture || '' };
}

async function githubIdentity(accessToken) {
  const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json', 'User-Agent': 'socialbrewery' };
  const [userRes, emailsRes] = await Promise.all([
    fetch('https://api.github.com/user', { headers }),
    fetch('https://api.github.com/user/emails', { headers }),
  ]);
  const me = await userRes.json().catch(() => ({}));
  const emails = await emailsRes.json().catch(() => []);
  if (!userRes.ok || !me.id) throw fail('GitHub did not return your profile.');
  const verified = (Array.isArray(emails) ? emails : []).filter((e) => e.verified && e.email);
  const primary = verified.find((e) => e.primary) || verified[0];
  if (!primary) throw fail('Add and verify an email on your GitHub account, then sign in again.');
  return {
    provider: 'github',
    subject: String(me.id),
    email: primary.email,
    emails: verified.map((e) => e.email),
    name: me.name || me.login || '',
    picture: me.avatar_url || '',
  };
}

// Returns { session, user, orgId, notice } for a finished sign-in.
export async function finishSignIn(id, code, state) {
  provider(id);
  const saved = await takeAuthState(state);
  if (!saved || saved.provider !== id) throw fail('That sign-in link expired. Try again.');
  const accessToken = await exchangeCode(id, code, saved.verifier);
  const identity = id === 'google' ? await googleIdentity(accessToken) : await githubIdentity(accessToken);
  const user = await upsertUser(identity);
  const { accepted, tokenError } = await acceptInvites(user, saved.invite);
  let orgs = await membershipsFor(user.id);
  let notice = tokenError;
  if (!orgs.length) {
    const first = await isFirstOrg();
    const org = await createOrg({ name: `${(user.name || user.email).split(' ')[0]}'s organisation`, ownerId: user.id });
    if (first) {
      await migrateLegacyInto(org);
      notice = notice || 'Your existing keys and connected accounts moved into this organisation.';
    }
    orgs = await membershipsFor(user.id);
  }
  const orgId = accepted.at(-1) || orgs[0]?.id || '';
  const session = await createSession(user.id, orgId);
  return { session, user, orgId, notice };
}
