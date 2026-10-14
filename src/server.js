import http from 'node:http';
import fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { appUrl, loadEnv, normalizeOrgSettings, normalizeSystem, orgSettingsView, secureCookies } from './env.js';
import {
  ROLES,
  acceptInvites,
  createInvite,
  createOrg,
  deleteSession,
  findOrgByConnectorToken,
  getOrg,
  getSession,
  getUser,
  inviteByToken,
  listInvites,
  listMembers,
  loadOrgConfig,
  membership,
  membershipsFor,
  publicUser,
  removeMember,
  renameOrg,
  revokeInvite,
  roleAtLeast,
  rotateConnectorToken,
  saveOrgConfig,
  setMemberRole,
  setSessionOrg,
} from './accounts.js';
import { authProviders, beginSignIn, finishSignIn } from './auth.js';
import { cfg, currentContext, isOrgId, runWithOrg } from './context.js';
import { verifySignature } from './secure.js';
import { runAgent } from './agent.js';
import { publicDir } from './paths.js';
import { blobSize, blobStream, maxVideoBytes } from './storage.js';
import { clearHistory, createMedia, ensureData, enqueue, getMedia, listAnalyses, listPosts, loadHistory, mediaPath } from './store.js';
import { analyzeVideo } from './analysis.js';
import { connectorDetails, connectorTokenFrom, handleRpc } from './mcp.js';
import {
  beginConnect,
  disconnectYoutube,
  finishConnect,
  listChannelVideos,
  publishShort,
  redirectUri,
  updateVideo,
  youtubeStatus,
} from './youtube.js';
import {
  beginLinkedinConnect,
  commentLinkedin,
  disconnectLinkedin,
  finishLinkedinConnect,
  linkedinRedirectUri,
  linkedinStatus,
  publishLinkedin,
} from './linkedin.js';
import {
  beginInstagramConnect,
  disconnectInstagram,
  finishInstagramConnect,
  instagramRedirectUri,
  instagramStatus,
  publishInstagramReel,
} from './instagram.js';
import {
  instagramVerifyToken,
  instagramWebhookUrl,
  listInstagramEvents,
  recordInstagramEvents,
  subscribeInstagramWebhooks,
  validSignature,
  verifyChallenge,
} from './instagram-webhooks.js';
import { beginXConnect, deleteX, disconnectX, finishXConnect, publishX, replyX, xRedirectUri, xStatus } from './x.js';
import {
  connectHashnode,
  disconnectHashnode,
  hashnodeStatus,
  listHashnodePosts,
  publishHashnode,
  updateHashnode,
} from './hashnode.js';
import {
  SLACK_MANIFEST,
  connectSlack,
  disconnectSlack,
  listSlackChannels,
  postSlack,
  replySlack,
  slackStats,
  slackStatus,
} from './slack.js';
import {
  beginRedditConnect,
  commentReddit,
  disconnectReddit,
  finishRedditConnect,
  listRedditSubreddits,
  redditRedirectUri,
  redditStats,
  redditStatus,
  submitReddit,
  subredditDetails,
  trackRedditPost,
} from './reddit.js';

// Created on first use: Workers forbid random values while a module loads.
let bootValue = '';
const bootId = () => (bootValue ||= randomUUID());
const EXT_MIME = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.json': 'application/json; charset=utf-8',
};


function sendJson(res, status, data, done) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(body, done);
}

function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        settled = true;
        reject(fail('That upload is too large.', 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!settled) resolve(Buffer.concat(chunks));
    });
    req.on('error', (err) => {
      if (!settled) reject(err);
    });
  });
}

async function readJsonBody(req) {
  const raw = await readBody(req, 1_000_000);
  try {
    return JSON.parse(raw.toString('utf8') || '{}');
  } catch {
    throw fail('That request was not valid JSON.');
  }
}

function filenameFrom(req) {
  const raw = String(req.headers['x-filename'] || 'short.mp4');
  let name = raw;
  try {
    name = decodeURIComponent(raw);
  } catch {
    name = raw;
  }
  name = path.basename(name).replace(/[\r\n"]/g, '').slice(0, 180);
  return name || 'short.mp4';
}

function videoKind(name, header) {
  const ext = path.extname(name).toLowerCase();
  const mime = EXT_MIME[ext];
  const type = String(header || '').split(';')[0].trim().toLowerCase();
  const typeOk = !type || type === 'application/octet-stream' || type.startsWith('video/');
  if (!mime || !typeOk) return null;
  return { mime };
}

function redirect(res, location) {
  res.writeHead(302, {
    Location: location,
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
  });
  res.end();
}

function notice(message) {
  return `/?notice=${encodeURIComponent(message)}`;
}

async function health() {
  const [youtube, linkedin, instagram, x, hashnode, slack, reddit] = await Promise.all([
    youtubeStatus(),
    linkedinStatus(),
    instagramStatus(),
    xStatus(),
    hashnodeStatus(),
    slackStatus(),
    redditStatus(),
  ]);
  return {
    ok: true,
    bootId: bootId(),
    xai: Boolean(cfg.XAI_API_KEY),
    youtubeApp: Boolean(cfg.YOUTUBE_CLIENT_ID && cfg.YOUTUBE_CLIENT_SECRET),
    youtubeConnected: youtube.connected,
    linkedinApp: Boolean(cfg.LINKEDIN_CLIENT_ID && cfg.LINKEDIN_CLIENT_SECRET),
    linkedinConnected: linkedin.connected,
    instagramApp: Boolean(cfg.INSTAGRAM_APP_ID && cfg.INSTAGRAM_APP_SECRET),
    instagramConnected: instagram.connected,
    xApp: Boolean(cfg.X_CLIENT_ID),
    xConnected: x.connected,
    hashnodeApp: Boolean(cfg.HASHNODE_TOKEN),
    hashnodeConnected: hashnode.connected,
    slackApp: Boolean(cfg.SLACK_BOT_TOKEN),
    slackConnected: slack.connected,
    redditApp: Boolean(cfg.REDDIT_CLIENT_ID && cfg.REDDIT_CLIENT_SECRET),
    redditConnected: reddit.connected,
    redirectUri: redirectUri(),
    url: appUrl(),
    maxUploadMb: Math.floor(maxVideoBytes() / 1024 / 1024),
  };
}

const SESSION_COOKIE = 'sb_session';

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

function sessionCookie(token, maxAge) {
  const parts = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (secureCookies()) parts.push('Secure');
  return parts.join('; ');
}

// Browsers send Origin on state-changing requests; anything from another site is refused.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (origin) return origin === new URL(appUrl()).origin || origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`;
  return req.headers['sec-fetch-site'] === 'same-origin';
}

function requireRole(ctx, needed) {
  if (!roleAtLeast(ctx.role, needed)) throw fail(`Only an organisation ${needed} can do that.`, 403);
}

async function sessionInfo(req) {
  const token = cookies(req)[SESSION_COOKIE] || '';
  const session = await getSession(token);
  if (!session) return { token: '', session: null, user: null };
  const user = await getUser(session.userId);
  if (!user) return { token: '', session: null, user: null };
  return { token, session, user };
}

async function orgContextFor(user, orgId) {
  if (!isOrgId(orgId)) return null;
  const [org, member] = await Promise.all([getOrg(orgId), membership(orgId, user.id)]);
  if (!org || !member) return null;
  return { org: { id: org.id, name: org.name }, config: await loadOrgConfig(org.id), user: publicUser(user), role: member.role };
}

const busyOrgs = new Set();

// Meta calls this without a session: GET verifies the endpoint, POST delivers signed events.
async function serveInstagramWebhook(req, res, url, orgId) {
  const org = await getOrg(orgId);
  if (!org) throw fail('Not found.', 404);
  const ctx = { org: { id: org.id, name: org.name }, config: await loadOrgConfig(org.id), user: null, role: 'member' };
  await runWithOrg(ctx, async () => {
    if (req.method === 'GET') {
      const challenge = verifyChallenge(url.searchParams);
      if (!challenge) throw fail('Verify token does not match.', 403);
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(challenge);
      return;
    }
    if (req.method !== 'POST') throw fail('Method not allowed.', 405);
    const raw = await readBody(req, 1_000_000);
    if (!validSignature(raw, req.headers['x-hub-signature-256'])) throw fail('Bad signature.', 401);
    let payload;
    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch {
      throw fail('That request was not valid JSON.');
    }
    await recordInstagramEvents(payload);
    sendJson(res, 200, { ok: true });
  });
}

function staticFile(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const file = path.resolve(publicDir, `.${path.posix.normalize(decoded)}`);
  if (!file.startsWith(publicDir + path.sep)) return null;
  if (!TYPES[path.extname(file).toLowerCase()]) return null;
  return file;
}

async function serveStatic(res, file) {
  const body = await fs.readFile(file);
  const hashed = file.includes(`${path.sep}assets${path.sep}`);
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(body);
}

async function serveMedia(req, res, id) {
  const record = await getMedia(id);
  if (!record) throw fail('That video is not in the library.', 404);
  const file = mediaPath(record);
  const size = await blobSize(file);
  if (size == null) throw fail('That video file is missing from storage.', 404);
  const mime = record.mime || 'video/mp4';
  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!match) throw fail('Ask for a byte range like bytes=0-.');
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : size - 1;
    if (start > end || end >= size) throw fail('That range is outside the video.');
    res.writeHead(206, {
      'Content-Type': mime,
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    });
    const stream = await blobStream(file, { start, end });
    res.on('close', () => stream.destroy());
    stream.pipe(res);
    return;
  }
  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': size,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  });
  const stream = await blobStream(file);
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

// The Workers entry moves video bytes between the browser and R2 itself, because streaming them
// through node:http would spend the free plan's CPU budget. These apply the same checks as route().
export function mediaUploadInfo(req) {
  const name = filenameFrom(req);
  const kind = videoKind(name, req.headers['content-type']);
  if (!kind) throw fail('Use an mp4, mov, or webm file.');
  return { name, mime: kind.mime };
}

export async function signedInContext(req, known) {
  const unsafe = req.method !== 'GET' && req.method !== 'HEAD';
  if (unsafe && !sameOrigin(req)) throw fail('Cross-site request refused.', 403);
  const { session, user } = known || (await sessionInfo(req));
  if (!user) throw fail('Sign in to continue.', 401);
  let orgId = session.orgId;
  if (!isOrgId(orgId)) orgId = (await membershipsFor(user.id))[0]?.id || '';
  const ctx = await orgContextFor(user, orgId);
  if (!ctx) throw fail('Choose an organisation first.', 409);
  return ctx;
}

export async function publicMediaContext(orgId, mediaId, searchParams) {
  const exp = Number(searchParams.get('exp'));
  if (!exp || exp < Date.now() / 1000 || !verifySignature(`media:${orgId}:${mediaId}:${exp}`, searchParams.get('sig'))) {
    throw fail('That media link expired.', 403);
  }
  const org = await getOrg(orgId);
  if (!org) throw fail('Not found.', 404);
  return { org: { id: org.id, name: org.name }, config: await loadOrgConfig(org.id), user: null, role: 'member' };
}

async function serveMcp(req, res, url) {
  const org = await findOrgByConnectorToken(connectorTokenFrom(req, url));
  if (!org) {
    sendJson(res, 401, {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32001, message: 'Connector token required.' },
    });
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32000, message: 'POST JSON-RPC messages to this URL.' },
    });
    return;
  }
  const body = await readJsonBody(req);
  const messages = Array.isArray(body) ? body : [body];
  const responses = [];
  const ctx = { org: { id: org.id, name: org.name }, config: await loadOrgConfig(org.id), user: null, role: 'member' };
  await runWithOrg(ctx, async () => {
    for (const message of messages) {
      const response = await handleRpc(message);
      if (response) responses.push(response);
    }
  });
  if (!responses.length) {
    res.writeHead(202, { 'Cache-Control': 'no-store' });
    res.end();
    return;
  }
  sendJson(res, 200, Array.isArray(body) ? responses : responses[0]);
}

async function route(req, res) {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const { pathname } = url;

  const isApp = !/^\/(api|auth|public|webhooks)\//.test(pathname) && pathname !== '/mcp';
  if (req.method === 'GET' && isApp) {
    const file = pathname === '/' ? null : staticFile(pathname);
    const exists = file ? await fs.stat(file).then((s) => s.isFile(), () => false) : false;
    if (exists) {
      await serveStatic(res, file);
      return;
    }
    if (!path.extname(pathname)) {
      await serveStatic(res, path.join(publicDir, 'index.html'));
      return;
    }
  }

  if (pathname === '/mcp') {
    await serveMcp(req, res, url);
    return;
  }

  const publicMedia = pathname.match(/^\/public\/media\/([a-f0-9]{24})\/([0-9a-f-]{36})$/i);
  if (req.method === 'GET' && publicMedia) {
    const [, orgId, mediaId] = publicMedia;
    const ctx = await publicMediaContext(orgId, mediaId, url.searchParams);
    await runWithOrg(ctx, () => serveMedia(req, res, mediaId));
    return;
  }

  const igWebhook = pathname.match(/^\/webhooks\/instagram\/([a-f0-9]{24})$/);
  if (igWebhook) {
    await serveInstagramWebhook(req, res, url, igWebhook[1]);
    return;
  }

  const unsafe = req.method !== 'GET' && req.method !== 'HEAD';
  if (unsafe && (pathname.startsWith('/api/') || pathname.startsWith('/auth/')) && !sameOrigin(req)) {
    throw fail('Cross-site request refused.', 403);
  }

  const signIn = pathname.match(/^\/auth\/(google|github)$/);
  if (req.method === 'GET' && signIn) {
    try {
      redirect(res, await beginSignIn(signIn[1], { invite: url.searchParams.get('invite') || '' }));
    } catch (err) {
      redirect(res, `/login?error=${encodeURIComponent(err.message)}`);
    }
    return;
  }

  const signInCallback = pathname.match(/^\/auth\/(google|github)\/callback$/);
  if (req.method === 'GET' && signInCallback) {
    const error = url.searchParams.get('error');
    if (error) {
      redirect(res, `/login?error=${encodeURIComponent(error === 'access_denied' ? 'Sign-in was cancelled.' : `Sign-in failed: ${error}`)}`);
      return;
    }
    try {
      const result = await finishSignIn(signInCallback[1], url.searchParams.get('code') || '', url.searchParams.get('state') || '');
      res.setHeader('Set-Cookie', sessionCookie(result.session.token, result.session.maxAge));
      redirect(res, result.notice ? notice(result.notice) : '/');
    } catch (err) {
      console.error(`Sign-in failed: ${err.message}`);
      redirect(res, `/login?error=${encodeURIComponent(err.message)}`);
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/auth/logout') {
    await deleteSession(cookies(req)[SESSION_COOKIE]);
    res.setHeader('Set-Cookie', sessionCookie('', 0));
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/invites/lookup') {
    const invite = await inviteByToken(url.searchParams.get('token') || '');
    if (!invite) throw fail('This invite is invalid or has expired.', 404);
    sendJson(res, 200, { invite: { orgName: invite.orgName, email: invite.email, role: invite.role } });
    return;
  }

  const { token: sessionToken, session, user } = await sessionInfo(req);

  if (req.method === 'GET' && pathname === '/api/session') {
    if (!user) {
      sendJson(res, 200, { authenticated: false, providers: authProviders() });
      return;
    }
    const orgs = await membershipsFor(user.id);
    const active = orgs.find((o) => o.id === session.orgId) || orgs[0] || null;
    if (active && active.id !== session.orgId) await setSessionOrg(sessionToken, active.id);
    sendJson(res, 200, { authenticated: true, user: publicUser(user), org: active, orgs, roles: ROLES, providers: authProviders() });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/health' && !user) {
    sendJson(res, 200, { ok: true, bootId: bootId(), authenticated: false });
    return;
  }

  if (!pathname.startsWith('/api/')) {
    sendJson(res, 404, { error: 'Not found.' });
    return;
  }
  if (!user) throw fail('Sign in to continue.', 401);

  if (req.method === 'POST' && pathname === '/api/session/org') {
    const body = await readJsonBody(req);
    if (!(await membership(String(body.orgId || ''), user.id))) throw fail('You are not in that organisation.', 403);
    await setSessionOrg(sessionToken, body.orgId);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/orgs') {
    const body = await readJsonBody(req);
    const org = await createOrg({ name: body.name, ownerId: user.id });
    await setSessionOrg(sessionToken, org.id);
    sendJson(res, 201, { org: { id: org.id, name: org.name, role: 'owner' } });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/invites/accept') {
    const body = await readJsonBody(req);
    const { accepted, tokenError } = await acceptInvites(user, String(body.token || ''));
    if (tokenError && !accepted.length) throw fail(tokenError, 403);
    if (!accepted.length) throw fail('This invite is invalid or has expired.', 404);
    await setSessionOrg(sessionToken, accepted.at(-1));
    sendJson(res, 200, { ok: true, orgId: accepted.at(-1) });
    return;
  }

  const ctx = await signedInContext(req, { session, user });
  await runWithOrg(ctx, () => orgRoute(req, res, url, ctx));
}

const ADMIN_ROUTES = [
  /^\/api\/(youtube|linkedin|instagram|x|hashnode|slack|reddit)\/(connect|callback|disconnect)$/,
  /^\/api\/settings$/,
  /^\/api\/instagram\/webhooks\/subscribe$/,
  /^\/api\/org\/(invites|members|connector)/,
];

async function orgRoute(req, res, url, ctx) {
  const { pathname } = url;
  if ((req.method !== 'GET' || /\/(connect|callback)$/.test(pathname)) && ADMIN_ROUTES.some((re) => re.test(pathname))) {
    if (!roleAtLeast(ctx.role, 'admin')) {
      if (req.method === 'GET') {
        redirect(res, notice('Only an organisation owner or admin can connect or disconnect accounts.'));
        return;
      }
      requireRole(ctx, 'admin');
    }
  }

  if (req.method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, await health());
    return;
  }

  if (req.method === 'GET' && pathname === '/api/settings') {
    requireRole(ctx, 'admin');
    sendJson(res, 200, { managed: orgSettingsView(ctx.config), redirectUri: redirectUri() });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/settings') {
    const body = await readJsonBody(req);
    const { values, errors } = normalizeOrgSettings(body.values || {}, ctx.config, body.clear);
    if (errors.length) throw fail(errors[0]);
    const config = await saveOrgConfig(ctx.org.id, { ...values, CONNECTOR_TOKEN: ctx.config.CONNECTOR_TOKEN });
    sendJson(res, 200, { ok: true, managed: orgSettingsView(config) });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/org') {
    const canManage = roleAtLeast(ctx.role, 'admin');
    sendJson(res, 200, {
      org: ctx.org,
      role: ctx.role,
      members: await listMembers(ctx.org.id),
      invites: canManage ? await listInvites(ctx.org.id) : [],
    });
    return;
  }

  if (req.method === 'PATCH' && pathname === '/api/org') {
    requireRole(ctx, 'admin');
    const body = await readJsonBody(req);
    sendJson(res, 200, { org: await renameOrg(ctx.org.id, body.name) });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/org/invites') {
    const body = await readJsonBody(req);
    const { invite, token } = await createInvite({
      orgId: ctx.org.id,
      email: body.email,
      role: String(body.role || 'member'),
      invitedBy: ctx.user.id,
      actorRole: ctx.role,
    });
    sendJson(res, 201, { invite, link: `${appUrl()}/invite/${token}` });
    return;
  }

  const inviteMatch = pathname.match(/^\/api\/org\/invites\/([a-f0-9]{24})$/);
  if (req.method === 'DELETE' && inviteMatch) {
    await revokeInvite(ctx.org.id, inviteMatch[1]);
    sendJson(res, 200, { ok: true });
    return;
  }

  const memberMatch = pathname.match(/^\/api\/org\/members\/([a-f0-9]{24})$/);
  if (req.method === 'PATCH' && memberMatch) {
    const body = await readJsonBody(req);
    await setMemberRole({ orgId: ctx.org.id, actorRole: ctx.role, userId: memberMatch[1], role: String(body.role || '') });
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'DELETE' && memberMatch) {
    await removeMember({ orgId: ctx.org.id, actorRole: ctx.role, userId: memberMatch[1] });
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/org/connector/rotate') {
    const config = await rotateConnectorToken(ctx.org.id);
    await runWithOrg({ ...ctx, config }, async () => sendJson(res, 200, { grok: connectorDetails() }));
    return;
  }

  if (req.method === 'GET' && pathname === '/api/connectors') {
    const [youtube, linkedin, instagram, x, hashnode, slack, reddit] = await Promise.all([
      youtubeStatus(),
      linkedinStatus(),
      instagramStatus(),
      xStatus(),
      hashnodeStatus(),
      slackStatus(),
      redditStatus(),
    ]);
    const grok = roleAtLeast(currentContext().role, 'admin') ? connectorDetails() : { ...connectorDetails(), mcpUrl: '' };
    sendJson(res, 200, {
      youtube: {
        ...youtube,
        analytics: true,
        appReady: Boolean(cfg.YOUTUBE_CLIENT_ID && cfg.YOUTUBE_CLIENT_SECRET),
        redirectUri: redirectUri(),
      },
      linkedin: {
        ...linkedin,
        appReady: Boolean(cfg.LINKEDIN_CLIENT_ID && cfg.LINKEDIN_CLIENT_SECRET),
        redirectUri: linkedinRedirectUri(),
      },
      instagram: {
        ...instagram,
        appReady: Boolean(cfg.INSTAGRAM_APP_ID && cfg.INSTAGRAM_APP_SECRET),
        redirectUri: instagramRedirectUri(),
        needsPublicUrl: !cfg.MCP_PUBLIC_URL,
        webhook: roleAtLeast(ctx.role, 'admin')
          ? { url: instagramWebhookUrl(), verifyToken: instagramVerifyToken() }
          : null,
      },
      x: {
        ...x,
        appReady: Boolean(cfg.X_CLIENT_ID),
        redirectUri: xRedirectUri(),
      },
      hashnode: {
        ...hashnode,
        analytics: true,
        appReady: Boolean(cfg.HASHNODE_TOKEN),
        redirectUri: '',
      },
      slack: {
        ...slack,
        analytics: true,
        appReady: Boolean(cfg.SLACK_BOT_TOKEN),
        redirectUri: '',
        defaultChannel: cfg.SLACK_DEFAULT_CHANNEL || '',
        manifest: JSON.stringify(SLACK_MANIFEST, null, 2),
      },
      reddit: {
        ...reddit,
        analytics: true,
        appReady: Boolean(cfg.REDDIT_CLIENT_ID && cfg.REDDIT_CLIENT_SECRET),
        redirectUri: redditRedirectUri(),
      },
      grok,
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/youtube/videos') {
    const videos = await listChannelVideos(15);
    const analyses = await listAnalyses();
    const latest = new Map();
    for (const item of analyses) {
      if (item.videoId && !latest.has(item.videoId)) latest.set(item.videoId, item.analysis);
    }
    sendJson(res, 200, {
      videos: videos.map((video) => ({ ...video, analysis: latest.get(video.id) || '' })),
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/youtube/analyze') {
    const body = await readJsonBody(req);
    sendJson(res, 200, { review: await analyzeVideo(body.videoId, { provider: body.provider }) });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/youtube/update') {
    const body = await readJsonBody(req);
    sendJson(res, 200, {
      video: await updateVideo({
        videoId: body.videoId,
        title: body.title,
        description: body.description,
        tags: body.tags,
        privacyStatus: body.privacyStatus,
      }),
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/youtube/status') {
    const status = await youtubeStatus();
    sendJson(res, 200, { ...status, redirectUri: redirectUri(), appReady: Boolean(cfg.YOUTUBE_CLIENT_ID && cfg.YOUTUBE_CLIENT_SECRET) });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/youtube/connect') {
    try {
      redirect(res, await beginConnect());
    } catch (err) {
      redirect(res, notice(err.message));
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/youtube/callback') {
    const error = url.searchParams.get('error');
    if (error) {
      redirect(res, notice(error === 'access_denied' ? 'YouTube connection was cancelled.' : 'YouTube did not connect.'));
      return;
    }
    try {
      const channel = await finishConnect(url.searchParams.get('code') || '', url.searchParams.get('state') || '');
      redirect(res, notice(`Connected ${channel?.title || 'your YouTube channel'}.`));
    } catch (err) {
      console.error(`YouTube callback failed: ${err.message}`);
      redirect(res, notice(err.message));
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/youtube/disconnect') {
    await disconnectYoutube();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/linkedin/status') {
    const status = await linkedinStatus();
    sendJson(res, 200, {
      ...status,
      redirectUri: linkedinRedirectUri(),
      appReady: Boolean(cfg.LINKEDIN_CLIENT_ID && cfg.LINKEDIN_CLIENT_SECRET),
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/linkedin/connect') {
    try {
      redirect(res, await beginLinkedinConnect());
    } catch (err) {
      redirect(res, notice(err.message));
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/linkedin/callback') {
    const error = url.searchParams.get('error');
    if (error) {
      const detail = url.searchParams.get('error_description') || error;
      let message = `LinkedIn did not connect: ${detail}`;
      if (error === 'access_denied') message = 'LinkedIn connection was cancelled.';
      else if (error === 'unauthorized_scope_error') {
        message = 'LinkedIn app is missing products. In the LinkedIn developer portal, add "Sign In with LinkedIn using OpenID Connect" and "Share on LinkedIn" to this app, then connect again.';
      }
      console.error(`LinkedIn callback error: ${error}`);
      redirect(res, notice(message));
      return;
    }
    try {
      const profile = await finishLinkedinConnect(url.searchParams.get('code') || '', url.searchParams.get('state') || '');
      redirect(res, notice(`Connected ${profile?.title || 'LinkedIn'}.`));
    } catch (err) {
      console.error(`LinkedIn callback failed: ${err.message}`);
      redirect(res, notice(err.message));
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/linkedin/comment') {
    const body = await readJsonBody(req);
    sendJson(res, 201, { comment: await commentLinkedin({ post: body.post, text: body.text }) });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/linkedin/disconnect') {
    await disconnectLinkedin();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/instagram/status') {
    const status = await instagramStatus();
    sendJson(res, 200, {
      ...status,
      redirectUri: instagramRedirectUri(),
      appReady: Boolean(cfg.INSTAGRAM_APP_ID && cfg.INSTAGRAM_APP_SECRET),
      needsPublicUrl: !cfg.MCP_PUBLIC_URL,
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/instagram/connect') {
    try {
      redirect(res, await beginInstagramConnect());
    } catch (err) {
      redirect(res, notice(err.message));
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/instagram/callback') {
    const error = url.searchParams.get('error') || url.searchParams.get('error_reason');
    if (error) {
      redirect(res, notice(error === 'access_denied' || error === 'user_denied' ? 'Instagram connection was cancelled.' : 'Instagram did not connect.'));
      return;
    }
    try {
      const account = await finishInstagramConnect(url.searchParams.get('code') || '', url.searchParams.get('state') || '');
      redirect(res, notice(`Connected ${account?.title || 'Instagram'}.`));
    } catch (err) {
      console.error(`Instagram callback failed: ${err.message}`);
      redirect(res, notice(err.message));
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/instagram/events') {
    sendJson(res, 200, { events: await listInstagramEvents() });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/instagram/webhooks/subscribe') {
    const body = await readJsonBody(req);
    const fields = await subscribeInstagramWebhooks(Array.isArray(body.fields) ? body.fields : undefined);
    sendJson(res, 200, { ok: true, fields });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/instagram/disconnect') {
    await disconnectInstagram();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/x/status') {
    const status = await xStatus();
    sendJson(res, 200, { ...status, redirectUri: xRedirectUri(), appReady: Boolean(cfg.X_CLIENT_ID) });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/x/connect') {
    try {
      redirect(res, await beginXConnect());
    } catch (err) {
      redirect(res, notice(err.message));
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/x/callback') {
    const error = url.searchParams.get('error');
    if (error) {
      const detail = url.searchParams.get('error_description') || error;
      console.error(`X callback error: ${error}`);
      redirect(res, notice(error === 'access_denied' ? 'X connection was cancelled.' : `X did not connect: ${detail}`));
      return;
    }
    try {
      const account = await finishXConnect(url.searchParams.get('code') || '', url.searchParams.get('state') || '');
      redirect(res, notice(`Connected ${account?.title || 'X'}.`));
    } catch (err) {
      console.error(`X callback failed: ${err.message}`);
      redirect(res, notice(err.message));
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/x/reply') {
    const body = await readJsonBody(req);
    sendJson(res, 201, { reply: await replyX({ post: body.post, text: body.text }) });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/x/delete') {
    const body = await readJsonBody(req);
    sendJson(res, 200, await deleteX(body.post));
    return;
  }

  if (req.method === 'GET' && pathname === '/api/hashnode/status') {
    sendJson(res, 200, { ...(await hashnodeStatus()), appReady: Boolean(cfg.HASHNODE_TOKEN) });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/hashnode/connect') {
    try {
      const account = await connectHashnode();
      redirect(res, notice(`Connected ${account.publication.title || account.title || 'Hashnode'}.`));
    } catch (err) {
      console.error(`Hashnode connect failed: ${err.message}`);
      redirect(res, notice(err.message));
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/hashnode/posts') {
    sendJson(res, 200, { posts: await listHashnodePosts(Number(url.searchParams.get('limit')) || 20) });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/hashnode/update') {
    const body = await readJsonBody(req);
    sendJson(res, 200, { post: await updateHashnode(body) });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/slack/status') {
    sendJson(res, 200, { ...(await slackStatus()), appReady: Boolean(cfg.SLACK_BOT_TOKEN) });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/slack/connect') {
    try {
      const account = await connectSlack();
      redirect(res, notice(`Connected ${account.title || 'Slack'}.`));
    } catch (err) {
      console.error(`Slack connect failed: ${err.message}`);
      redirect(res, notice(err.message));
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/slack/channels') {
    sendJson(res, 200, { channels: await listSlackChannels({ fresh: url.searchParams.get('fresh') === '1' }) });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/slack/stats') {
    sendJson(res, 200, { posts: await slackStats(20) });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/slack/reply') {
    const body = await readJsonBody(req);
    sendJson(res, 201, { reply: await replySlack({ post: body.post, text: body.text }) });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/slack/disconnect') {
    await disconnectSlack();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/reddit/status') {
    const status = await redditStatus();
    sendJson(res, 200, {
      ...status,
      redirectUri: redditRedirectUri(),
      appReady: Boolean(cfg.REDDIT_CLIENT_ID && cfg.REDDIT_CLIENT_SECRET),
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/reddit/connect') {
    try {
      redirect(res, await beginRedditConnect());
    } catch (err) {
      redirect(res, notice(err.message));
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/reddit/callback') {
    const error = url.searchParams.get('error');
    if (error) {
      console.error(`Reddit callback error: ${error}`);
      redirect(res, notice(error === 'access_denied' ? 'Reddit connection was cancelled.' : `Reddit did not connect: ${error}`));
      return;
    }
    try {
      const account = await finishRedditConnect(url.searchParams.get('code') || '', url.searchParams.get('state') || '');
      redirect(res, notice(`Connected ${account?.title || 'Reddit'}.`));
    } catch (err) {
      console.error(`Reddit callback failed: ${err.message}`);
      redirect(res, notice(err.message));
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/reddit/subreddits') {
    sendJson(res, 200, { subreddits: await listRedditSubreddits() });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/reddit/subreddit') {
    sendJson(res, 200, { subreddit: await subredditDetails(url.searchParams.get('name') || '') });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/reddit/stats') {
    sendJson(res, 200, { posts: await redditStats(25) });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/reddit/comment') {
    const body = await readJsonBody(req);
    sendJson(res, 201, { comment: await commentReddit({ post: body.post, text: body.text }) });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/reddit/track') {
    const body = await readJsonBody(req);
    sendJson(res, 201, { post: await trackRedditPost({ link: body.link, title: body.title, text: body.text }) });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/reddit/disconnect') {
    await disconnectReddit();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/hashnode/disconnect') {
    await disconnectHashnode();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/x/disconnect') {
    await disconnectX();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/media') {
    const name = filenameFrom(req);
    const kind = videoKind(name, req.headers['content-type']);
    if (!kind) throw fail('Use an mp4, mov, or webm file.');
    const buffer = await readBody(req, maxVideoBytes());
    if (!buffer.length) throw fail('That video file is empty.');
    const media = await createMedia({ buffer, name, mime: kind.mime, source: 'upload' });
    sendJson(res, 201, { media });
    return;
  }

  const mediaMatch = pathname.match(/^\/api\/media\/([0-9a-f-]{36})$/i);
  if (req.method === 'GET' && mediaMatch) {
    await serveMedia(req, res, mediaMatch[1]);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/posts') {
    sendJson(res, 200, { posts: await listPosts() });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/posts') {
    const body = await readJsonBody(req);
    const network = String(body.network || 'youtube').toLowerCase();
    let post;
    if (network === 'linkedin') {
      post = await publishLinkedin({
        mediaId: body.mediaId,
        commentary: body.description || body.title,
        title: body.title,
        source: 'manual',
      });
    } else if (network === 'instagram') {
      post = await publishInstagramReel({
        mediaId: body.mediaId,
        caption: body.description || body.title,
        title: body.title,
        source: 'manual',
      });
    } else if (network === 'slack') {
      post = await postSlack({
        channel: body.channel,
        text: body.description || body.title,
        title: body.title,
        mediaId: body.mediaId || '',
        source: 'manual',
      });
    } else if (network === 'hashnode') {
      post = await publishHashnode({
        title: body.title,
        subtitle: body.subtitle,
        content: body.description,
        tags: body.tags,
        coverImageUrl: body.coverImageUrl,
        canonicalUrl: body.canonicalUrl,
        draft: Boolean(body.draft),
        source: 'manual',
      });
    } else if (network === 'reddit') {
      post = await submitReddit({
        subreddit: body.subreddit,
        title: body.title,
        text: body.description,
        url: body.url,
        flairId: body.flairId,
        flairText: body.flairText,
        nsfw: Boolean(body.nsfw),
        spoiler: Boolean(body.spoiler),
        source: 'manual',
      });
    } else if (network === 'x') {
      post = await publishX({
        mediaId: body.mediaId || '',
        text: body.description || body.title,
        title: body.title,
        source: 'manual',
      });
    } else {
      post = await publishShort({
        mediaId: body.mediaId,
        title: body.title,
        description: body.description,
        tags: body.tags,
        privacyStatus: body.privacyStatus,
        madeForKids: Boolean(body.madeForKids),
        source: 'manual',
      });
    }
    sendJson(res, 201, { post });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/agent/history') {
    sendJson(res, 200, await loadHistory());
    return;
  }

  if (req.method === 'DELETE' && pathname === '/api/agent/history') {
    await clearHistory();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/agent/message') {
    if (busyOrgs.has(ctx.org.id)) throw fail('Grok is already working on a request for this organisation.', 409);
    const body = await readJsonBody(req);
    const text = String(body.text || '').trim();
    if (text.length > 8000) throw fail('That message is too long.');
    const mediaId = body.mediaId ? String(body.mediaId) : '';
    if (!text && !mediaId) throw fail('Write a message or attach a video.');
    busyOrgs.add(ctx.org.id);
    const controller = new AbortController();
    req.on('aborted', () => controller.abort());
    let started = false;
    let heartbeat = null;
    const send = (event, data) => {
      if (!started || res.writableEnded || controller.signal.aborted) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    try {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      started = true;
      // Proxies such as Cloudflare drop a response that stays silent for about 100 seconds; clip generation takes longer.
      heartbeat = setInterval(() => {
        if (!res.writableEnded) res.write(': keepalive\n\n');
      }, 20000);
      await runAgent({
        text,
        mediaId,
        privacyStatus: body.privacyStatus,
        madeForKids: Boolean(body.madeForKids),
        send,
        signal: controller.signal,
      });
      send('done', { ok: true });
    } catch (err) {
      if (!started) throw err;
      send('error', { error: err.message || 'Grok could not finish that.' });
    } finally {
      clearInterval(heartbeat);
      busyOrgs.delete(ctx.org.id);
      if (started && !res.writableEnded) res.end();
    }
    return;
  }

  sendJson(res, 404, { error: 'Not found.' });
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const tryListen = (attempt) => {
      const onError = (err) => {
        server.off('listening', onListening);
        if (err.code === 'EADDRINUSE' && attempt < 25) {
          setTimeout(() => tryListen(attempt + 1), 100);
          return;
        }
        reject(err);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    };
    tryListen(0);
  });
}

export async function handleRequest(req, res) {
  try {
    await route(req, res);
  } catch (err) {
    if (res.headersSent) {
      console.error(err);
      return;
    }
    const status = err.status || 500;
    if (status === 500) console.error(err);
    sendJson(res, status, { error: err.message || 'Something went wrong.' });
  }
}

async function main() {
  const values = await loadEnv();
  await ensureData();
  const { host, port, errors, warnings } = normalizeSystem(values);
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  for (const warning of warnings) console.warn(warning);
  const providers = authProviders();
  if (!Object.values(providers).some((p) => p.enabled)) {
    console.warn('No sign-in provider is set up. Set GOOGLE_AUTH_CLIENT_ID/SECRET or GITHUB_AUTH_CLIENT_ID/SECRET in .env or the environment, then restart.');
  }
  const server = http.createServer(handleRequest);
  await listen(server, host, port);
  console.log(`Socialbrewery ready at ${appUrl()}`);

  // Finish queued file writes before exiting.
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    server.close();
    server.closeAllConnections?.();
    const timer = setTimeout(() => process.exit(0), 10000);
    enqueue(async () => {}).finally(() => {
      clearTimeout(timer);
      process.exit(0);
    });
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

function runDirectly() {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (runDirectly()) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
