import fs from 'node:fs/promises';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { appUrl } from './env.js';
import {
  addPost,
  clearNetworkToken,
  clearOauthState,
  getMedia,
  mediaPath,
  readNetworkToken,
  readOauthState,
  writeNetworkToken,
  writeOauthState,
} from './store.js';
import { cfg } from './context.js';

const API = 'https://api.x.com/2';
const SCOPES = 'tweet.read tweet.write users.read media.write offline.access';
const CHUNK = 4 * 1024 * 1024;
const MAX_VIDEO = 512 * 1024 * 1024;

export function xRedirectUri() {
  return `${appUrl()}/api/x/callback`;
}

function clientConfig() {
  const clientId = cfg.X_CLIENT_ID;
  const clientSecret = cfg.X_CLIENT_SECRET;
  if (!clientId) throw new Error('Add the X client ID (and secret) in Settings (an organisation admin can do this).');
  return { clientId, clientSecret: clientSecret || '' };
}

function tokenHeaders() {
  const { clientId, clientSecret } = clientConfig();
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
  }
  return headers;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function xError(data, fallback) {
  return data?.detail || data?.errors?.[0]?.message || data?.error_description || data?.title || data?.error || fallback;
}

export async function beginXConnect() {
  const { clientId } = clientConfig();
  const state = randomBytes(24).toString('hex');
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  await writeOauthState({ state, verifier, exp: Date.now() + 15 * 60 * 1000 }, 'x');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: xRedirectUri(),
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return `https://x.com/i/oauth2/authorize?${params}`;
}

export async function finishXConnect(code, state) {
  const saved = await readOauthState('x');
  await clearOauthState('x');
  if (!saved || !safeEqual(saved.state, state) || saved.exp < Date.now()) {
    throw new Error('That X connection expired. Try Connect again.');
  }
  const { clientId } = clientConfig();
  const res = await fetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: tokenHeaders(),
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: xRedirectUri(),
      code_verifier: saved.verifier,
      client_id: clientId,
    }),
  });
  const token = await res.json().catch(() => ({}));
  if (!res.ok || !token.access_token) throw new Error(xError(token, 'X did not return a token.'));
  const account = await fetchAccount(token.access_token);
  await writeNetworkToken('x', {
    access_token: token.access_token,
    refresh_token: token.refresh_token || '',
    expires_at: Date.now() + (token.expires_in ?? 7200) * 1000,
    scope: token.scope || '',
    account,
  });
  return account;
}

async function fetchAccount(accessToken) {
  const res = await fetch(`${API}/users/me?user.fields=profile_image_url,username,name`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.data?.id) throw new Error(xError(data, 'X did not return the account.'));
  const user = data.data;
  const picture = typeof user.profile_image_url === 'string' && user.profile_image_url.startsWith('https:')
    ? user.profile_image_url.replace('_normal.', '_200x200.')
    : '';
  return {
    id: user.id,
    username: user.username || '',
    title: user.username ? `@${user.username}` : user.name || 'X account',
    name: user.name || '',
    picture,
  };
}

export async function xStatus() {
  const token = await readNetworkToken('x');
  if (!token?.access_token && !token?.refresh_token) return { connected: false, account: null };
  try {
    await accessToken();
    const latest = await readNetworkToken('x');
    return { connected: true, account: latest?.account || token.account || null };
  } catch {
    return { connected: Boolean(token.account), account: token.account || null };
  }
}

export async function disconnectX() {
  const token = await readNetworkToken('x');
  if (token?.refresh_token || token?.access_token) {
    const { clientId } = (() => {
      try {
        return clientConfig();
      } catch {
        return { clientId: '' };
      }
    })();
    if (clientId) {
      await fetch(`${API}/oauth2/revoke`, {
        method: 'POST',
        headers: tokenHeaders(),
        body: new URLSearchParams({
          token: token.refresh_token || token.access_token,
          token_type_hint: token.refresh_token ? 'refresh_token' : 'access_token',
          client_id: clientId,
        }),
      }).catch(() => undefined);
    }
  }
  await clearNetworkToken('x');
}

async function accessToken() {
  const token = await readNetworkToken('x');
  if (!token?.access_token && !token?.refresh_token) {
    const err = new Error('Connect X on the Connectors page first.');
    err.status = 400;
    throw err;
  }
  if (token.access_token && token.expires_at > Date.now() + 30_000) return token.access_token;
  if (!token.refresh_token) {
    const err = new Error('X login expired. Connect X again.');
    err.status = 400;
    throw err;
  }
  const { clientId } = clientConfig();
  const res = await fetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: tokenHeaders(),
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token,
      client_id: clientId,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const err = new Error(`${xError(data, 'X login expired.')} Connect X again.`);
    err.status = 400;
    throw err;
  }
  token.access_token = data.access_token;
  token.expires_at = Date.now() + (data.expires_in ?? 7200) * 1000;
  if (data.refresh_token) token.refresh_token = data.refresh_token;
  await writeNetworkToken('x', token);
  return token.access_token;
}

async function xSend(method, path, token, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = xError(data, `X request failed (${res.status}).`);
    const err = new Error(
      res.status === 403 && /scope|permission|forbidden/i.test(reason)
        ? `${reason} Reconnect X so it grants posting and media permissions, and check the app has Read and write access.`
        : res.status === 402 || /credits|payment|usage cap|client-not-enrolled/i.test(reason)
          ? `${reason} Your X developer account may be out of API credits or not on a plan that allows posting.`
          : reason,
    );
    err.status = res.status >= 500 ? 502 : 400;
    throw err;
  }
  return data;
}

export async function uploadXVideo({ token, filePath, bytes, mime }) {
  if (bytes > MAX_VIDEO) throw new Error('X videos must be 512 MB or smaller.');
  const init = await xSend('POST', '/media/upload/initialize', token, {
    media_type: mime || 'video/mp4',
    media_category: 'tweet_video',
    total_bytes: bytes,
  });
  const mediaId = init.data?.id;
  if (!mediaId) throw new Error('X did not start the video upload.');

  const handle = await fs.open(filePath, 'r');
  try {
    let segment = 0;
    for (let offset = 0; offset < bytes; offset += CHUNK) {
      const length = Math.min(CHUNK, bytes - offset);
      const chunk = Buffer.alloc(length);
      await handle.read(chunk, 0, length, offset);
      const form = new FormData();
      form.append('segment_index', String(segment));
      form.append('media', new Blob([chunk], { type: 'application/octet-stream' }), 'chunk');
      const res = await fetch(`${API}/media/upload/${mediaId}/append`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(xError(data, 'X rejected part of the video upload.'));
      }
      segment += 1;
    }
  } finally {
    await handle.close();
  }

  const done = await xSend('POST', `/media/upload/${mediaId}/finalize`, token);
  let info = done.data?.processing_info;
  const started = Date.now();
  while (info && info.state !== 'succeeded') {
    if (info.state === 'failed') throw new Error(info.error?.message || 'X could not process the video.');
    if (Date.now() - started > 5 * 60 * 1000) throw new Error('X is still processing the video. Try again in a minute.');
    await new Promise((resolve) => setTimeout(resolve, Math.min(10, Math.max(1, info.check_after_secs || 2)) * 1000));
    const status = await xSend('GET', `/media/upload?command=STATUS&media_id=${mediaId}`, token);
    info = status.data?.processing_info;
  }
  return mediaId;
}

export function xPostId(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/\/status(?:es)?\/(\d{5,25})/) || raw.match(/^(\d{5,25})$/);
  if (!match) throw new Error('Give the X post id or its link.');
  return match[1];
}

export async function publishX({ mediaId, text, title, replyTo, source }) {
  const body = String(text || title || '').trim();
  if (!body && !mediaId) throw new Error('X needs post text or a video.');
  const token = await accessToken();
  const payload = { text: body };
  if (replyTo) payload.reply = { in_reply_to_tweet_id: xPostId(replyTo) };
  if (mediaId) {
    const media = await getMedia(mediaId);
    if (!media) throw new Error('That video is not in the library.');
    const filePath = mediaPath(media);
    const bytes = (await fs.stat(filePath)).size;
    const xMediaId = await uploadXVideo({ token, filePath, bytes, mime: media.mime });
    payload.media = { media_ids: [xMediaId] };
  }
  const data = await xSend('POST', '/tweets', token, payload);
  const id = data.data?.id || '';
  const stored = await readNetworkToken('x');
  const handle = stored?.account?.username || 'i';
  const post = {
    id: randomBytes(8).toString('hex'),
    network: 'x',
    mediaId: mediaId || '',
    title: String(title || body).slice(0, 200),
    description: body,
    xId: id,
    replyTo: replyTo ? xPostId(replyTo) : '',
    url: id ? `https://x.com/${handle}/status/${id}` : '',
    createdAt: new Date().toISOString(),
    source: source || 'manual',
  };
  if (!replyTo) await addPost(post);
  return post;
}

export async function replyX({ post, text }) {
  const body = String(text || '').trim();
  if (!body) throw new Error('X needs reply text.');
  const reply = await publishX({ text: body, replyTo: post, source: 'reply' });
  return { xId: reply.xId, replyTo: reply.replyTo, url: reply.url };
}

export async function deleteX(post) {
  const token = await accessToken();
  const id = xPostId(post);
  await xSend('DELETE', `/tweets/${id}`, token);
  return { deleted: true, xId: id };
}
