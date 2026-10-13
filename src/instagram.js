import { randomBytes, timingSafeEqual } from 'node:crypto';
import { appUrl } from './env.js';
import {
  addPost,
  clearNetworkToken,
  clearOauthState,
  getMedia,
  readNetworkToken,
  readOauthState,
  writeNetworkToken,
  writeOauthState,
} from './store.js';
import { cfg, currentOrgId, publicOrigin } from './context.js';
import { sign } from './secure.js';

// Comments and messages are only needed for webhook notifications; they are in the Instagram Login use case by default.
const SCOPES = [
  'instagram_business_basic',
  'instagram_business_content_publish',
  'instagram_business_manage_comments',
  'instagram_business_manage_messages',
].join(',');

export function instagramRedirectUri() {
  return `${appUrl()}/api/instagram/callback`;
}

function clientConfig() {
  const clientId = cfg.INSTAGRAM_APP_ID;
  const clientSecret = cfg.INSTAGRAM_APP_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Add the Instagram app ID and secret in Settings (an organisation admin can do this).');
  }
  return { clientId, clientSecret };
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Instagram downloads the video itself, without a session, so the link is signed and expires.
export function publicMediaUrl(mediaId) {
  const origin = publicOrigin();
  if (!origin) {
    throw new Error('Instagram needs a public https URL to fetch the video. Set the public URL in Settings to your tunnel origin, then try again.');
  }
  const orgId = currentOrgId();
  const exp = Math.floor(Date.now() / 1000) + 2 * 3600;
  const sig = sign(`media:${orgId}:${mediaId}:${exp}`);
  return `${origin}/public/media/${orgId}/${mediaId}?exp=${exp}&sig=${sig}`;
}

export async function beginInstagramConnect() {
  const { clientId } = clientConfig();
  const state = randomBytes(24).toString('hex');
  await writeOauthState({ state, exp: Date.now() + 15 * 60 * 1000 }, 'instagram');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: instagramRedirectUri(),
    response_type: 'code',
    scope: SCOPES,
    state,
  });
  return `https://www.instagram.com/oauth/authorize?${params}`;
}

export async function finishInstagramConnect(code, state) {
  const saved = await readOauthState('instagram');
  await clearOauthState('instagram');
  if (!saved || !safeEqual(saved.state, state) || saved.exp < Date.now()) {
    throw new Error('That Instagram connection expired. Try Connect again.');
  }
  const rawCode = String(code || '').replace(/#_+$/, '');
  const { clientId, clientSecret } = clientConfig();
  const shortRes = await fetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      redirect_uri: instagramRedirectUri(),
      code: rawCode,
    }),
  });
  const short = await shortRes.json().catch(() => ({}));
  if (!shortRes.ok) {
    throw new Error(short.error_message || short.error?.message || 'Instagram did not return a token.');
  }
  const shortToken = short.access_token || short.data?.[0]?.access_token;
  const userId = String(short.user_id || short.data?.[0]?.user_id || '');
  if (!shortToken) throw new Error('Instagram did not return an access token.');

  const longUrl = new URL('https://graph.instagram.com/access_token');
  longUrl.searchParams.set('grant_type', 'ig_exchange_token');
  longUrl.searchParams.set('client_secret', clientSecret);
  longUrl.searchParams.set('access_token', shortToken);
  const longRes = await fetch(longUrl);
  const long = await longRes.json().catch(() => ({}));
  if (!longRes.ok) {
    throw new Error(long.error?.message || 'Instagram did not return a long-lived token.');
  }
  const accessToken = long.access_token || shortToken;
  const expiresIn = Number(long.expires_in || 60 * 24 * 3600);
  const account = await fetchAccount(accessToken, userId);
  const stored = {
    access_token: accessToken,
    expires_at: Date.now() + expiresIn * 1000,
    account,
  };
  await writeNetworkToken('instagram', stored);
  return account;
}

async function fetchAccount(accessToken, fallbackId = '') {
  const url = new URL('https://graph.instagram.com/v21.0/me');
  url.searchParams.set('fields', 'user_id,username,name,profile_picture_url,account_type');
  url.searchParams.set('access_token', accessToken);
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || 'Instagram did not return the account.');
  const id = String(data.user_id || data.id || fallbackId || '');
  if (!id) throw new Error('Instagram did not return an account id.');
  return {
    id,
    title: data.username ? `@${data.username}` : (data.name || 'Instagram account'),
    username: data.username || '',
    picture: typeof data.profile_picture_url === 'string' && data.profile_picture_url.startsWith('https:')
      ? data.profile_picture_url
      : '',
  };
}

export async function instagramStatus() {
  const token = await readNetworkToken('instagram');
  if (!token?.access_token) return { connected: false, account: null };
  try {
    await accessToken();
    const latest = await readNetworkToken('instagram');
    return { connected: true, account: latest?.account || token.account || null };
  } catch {
    return { connected: Boolean(token.account), account: token.account || null };
  }
}

export async function disconnectInstagram() {
  await clearNetworkToken('instagram');
}

async function accessToken() {
  const token = await readNetworkToken('instagram');
  if (!token?.access_token) {
    const err = new Error('Connect Instagram on the Connectors page first.');
    err.status = 400;
    throw err;
  }
  const remaining = token.expires_at - Date.now();
  if (remaining > 7 * 24 * 3600 * 1000) return token.access_token;
  if (remaining <= 0) {
    const err = new Error('Instagram login expired. Connect Instagram again.');
    err.status = 400;
    throw err;
  }
  const url = new URL('https://graph.instagram.com/refresh_access_token');
  url.searchParams.set('grant_type', 'ig_refresh_token');
  url.searchParams.set('access_token', token.access_token);
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error?.message || 'Instagram login expired. Connect Instagram again.');
    err.status = 400;
    throw err;
  }
  token.access_token = data.access_token || token.access_token;
  token.expires_at = Date.now() + Number(data.expires_in || 60 * 24 * 3600) * 1000;
  await writeNetworkToken('instagram', token);
  return token.access_token;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function publishInstagramReel({ mediaId, caption, title, source }) {
  if (!mediaId) throw new Error('Instagram needs a video mediaId.');
  const media = await getMedia(mediaId);
  if (!media) throw new Error('That video is not in the library.');
  const token = await accessToken();
  const stored = await readNetworkToken('instagram');
  const igUserId = stored?.account?.id;
  if (!igUserId) throw new Error('Connect Instagram again so Socialbrewery can read the account.');

  const videoUrl = publicMediaUrl(mediaId);
  const text = String(caption || title || '').trim().slice(0, 2200);
  const createUrl = new URL(`https://graph.instagram.com/v21.0/${igUserId}/media`);
  createUrl.searchParams.set('media_type', 'REELS');
  createUrl.searchParams.set('video_url', videoUrl);
  createUrl.searchParams.set('caption', text);
  createUrl.searchParams.set('access_token', token);
  const createRes = await fetch(createUrl, { method: 'POST' });
  const created = await createRes.json().catch(() => ({}));
  if (!createRes.ok) {
    throw new Error(created.error?.message || 'Instagram did not create a media container.');
  }
  const creationId = created.id;
  if (!creationId) throw new Error('Instagram did not return a container id.');

  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    const statusUrl = new URL(`https://graph.instagram.com/v21.0/${creationId}`);
    statusUrl.searchParams.set('fields', 'status_code,status');
    statusUrl.searchParams.set('access_token', token);
    const statusRes = await fetch(statusUrl);
    const status = await statusRes.json().catch(() => ({}));
    if (!statusRes.ok) throw new Error(status.error?.message || 'Instagram status check failed.');
    if (status.status_code === 'FINISHED') break;
    if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') {
      throw new Error(status.status || 'Instagram could not process that Reel.');
    }
    await delay(3000);
  }

  const publishUrl = new URL(`https://graph.instagram.com/v21.0/${igUserId}/media_publish`);
  publishUrl.searchParams.set('creation_id', creationId);
  publishUrl.searchParams.set('access_token', token);
  const publishRes = await fetch(publishUrl, { method: 'POST' });
  const published = await publishRes.json().catch(() => ({}));
  if (!publishRes.ok) {
    throw new Error(published.error?.message || 'Instagram did not publish the Reel.');
  }
  const mediaPublishId = published.id || '';
  const username = stored.account?.username || '';
  const post = {
    id: randomBytes(8).toString('hex'),
    network: 'instagram',
    mediaId,
    title: String(title || text || 'Reel').slice(0, 200),
    description: text,
    instagramId: mediaPublishId,
    url: username ? `https://www.instagram.com/${username}/` : '',
    createdAt: new Date().toISOString(),
    source: source || 'manual',
  };
  await addPost(post);
  return post;
}
