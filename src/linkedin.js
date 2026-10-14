import fs from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
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
import { blobSize, onWorkers, readBlobRange } from './storage.js';
import { fetchPublic } from './performance.js';

// LinkedIn sunsets each monthly version about a year after release; bump this when it nears retirement.
const LINKEDIN_VERSION = '202609';
const SCOPES = 'openid profile w_member_social';

export function linkedinRedirectUri() {
  return `${appUrl()}/api/linkedin/callback`;
}

function clientConfig() {
  const clientId = cfg.LINKEDIN_CLIENT_ID;
  const clientSecret = cfg.LINKEDIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Add the LinkedIn client ID and secret in Settings (an organisation admin can do this).');
  }
  return { clientId, clientSecret };
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function restHeaders(token, json = false) {
  return {
    Authorization: `Bearer ${token}`,
    'Linkedin-Version': LINKEDIN_VERSION,
    'X-Restli-Protocol-Version': '2.0.0',
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

export async function beginLinkedinConnect() {
  const { clientId } = clientConfig();
  const state = randomBytes(24).toString('hex');
  await writeOauthState({ state, exp: Date.now() + 15 * 60 * 1000 }, 'linkedin');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: linkedinRedirectUri(),
    state,
    scope: SCOPES,
  });
  return `https://www.linkedin.com/oauth/v2/authorization?${params}`;
}

export async function finishLinkedinConnect(code, state) {
  const saved = await readOauthState('linkedin');
  await clearOauthState('linkedin');
  if (!saved || !safeEqual(saved.state, state) || saved.exp < Date.now()) {
    throw new Error('That LinkedIn connection expired. Try Connect again.');
  }
  const { clientId, clientSecret } = clientConfig();
  const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: linkedinRedirectUri(),
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  const token = await tokenRes.json();
  if (!tokenRes.ok) {
    throw new Error(token.error_description || token.error || 'LinkedIn did not return a token.');
  }
  if (!token.access_token) throw new Error('LinkedIn did not return an access token.');
  const profile = await fetchProfile(token.access_token);
  const stored = {
    access_token: token.access_token,
    refresh_token: token.refresh_token || '',
    expires_at: Date.now() + (token.expires_in ?? 3600) * 1000,
    refresh_expires_at: token.refresh_token_expires_in
      ? Date.now() + token.refresh_token_expires_in * 1000
      : 0,
    profile,
  };
  await writeNetworkToken('linkedin', stored);
  return profile;
}

async function fetchProfile(accessToken) {
  const res = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.message || 'LinkedIn did not return the profile.');
  if (!data.sub) throw new Error('LinkedIn did not return a member id.');
  return {
    id: data.sub,
    urn: `urn:li:person:${data.sub}`,
    title: data.name || [data.given_name, data.family_name].filter(Boolean).join(' ') || 'LinkedIn member',
    picture: typeof data.picture === 'string' && data.picture.startsWith('https:') ? data.picture : '',
  };
}

export async function linkedinStatus() {
  const token = await readNetworkToken('linkedin');
  if (!token?.access_token && !token?.refresh_token) return { connected: false, profile: null };
  try {
    await accessToken();
    const latest = await readNetworkToken('linkedin');
    return { connected: true, profile: latest?.profile || token.profile || null };
  } catch {
    return { connected: Boolean(token.profile), profile: token.profile || null };
  }
}

export async function disconnectLinkedin() {
  await clearNetworkToken('linkedin');
}

async function accessToken() {
  const token = await readNetworkToken('linkedin');
  if (!token?.access_token && !token?.refresh_token) {
    const err = new Error('Connect LinkedIn on the Connectors page first.');
    err.status = 400;
    throw err;
  }
  if (token.access_token && token.expires_at > Date.now() + 30_000) return token.access_token;
  if (!token.refresh_token) {
    const err = new Error('LinkedIn login expired. Connect LinkedIn again.');
    err.status = 400;
    throw err;
  }
  const { clientId, clientSecret } = clientConfig();
  const res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error_description || 'LinkedIn login expired. Connect LinkedIn again.');
    err.status = 400;
    throw err;
  }
  token.access_token = data.access_token;
  token.expires_at = Date.now() + (data.expires_in ?? 3600) * 1000;
  if (data.refresh_token) token.refresh_token = data.refresh_token;
  await writeNetworkToken('linkedin', token);
  return token.access_token;
}

export async function publishLinkedin({ mediaId, videoPath, commentary, title, linkUrl, linkTitle, linkDescription, linkThumbnailUrl, source }) {
  const text = String(commentary || title || '').trim();
  if (!text) throw new Error('LinkedIn needs post text.');
  if (text.length > 3000) throw new Error('LinkedIn posts are limited to 3000 characters.');
  const link = linkPreviewUrl(linkUrl);
  let thumbnailError = '';
  const token = await accessToken();
  const stored = await readNetworkToken('linkedin');
  const author = stored?.profile?.urn;
  if (!author) throw new Error('Connect LinkedIn again so Socialbrewery can read your profile.');

  const body = {
    author,
    commentary: toLittleText(text),
    visibility: 'PUBLIC',
    distribution: {
      feedDistribution: 'MAIN_FEED',
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  };

  let filePath = '';
  let bytes = 0;
  if (mediaId) {
    const media = await getMedia(mediaId);
    if (!media) throw new Error('That video is not in the library.');
    filePath = mediaPath(media);
    bytes = (await blobSize(filePath)) || 0;
    if (!bytes) throw new Error('That video file is missing from storage.');
  } else if (videoPath) {
    if (onWorkers()) throw new Error('Attach the video to the library first; local file paths only work when running on your own machine.');
    filePath = String(videoPath).trim();
    if (!filePath) throw new Error('That video path is empty.');
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat?.isFile() || stat.size <= 0) throw new Error('That video path is not a readable file.');
    bytes = stat.size;
  }
  if (filePath) {
    const read = mediaId ? (start, end) => readBlobRange(filePath, start, end) : (start, end) => readLocalRange(filePath, start, end);
    const videoUrn = await uploadVideo({ token, owner: author, read, bytes });
    body.content = {
      media: {
        title: String(title || text).slice(0, 200),
        id: videoUrn,
      },
    };
  } else if (link) {
    const article = { source: link, title: String(linkTitle || title || link).slice(0, 400) };
    if (String(linkDescription || '').trim()) article.description = String(linkDescription).trim().slice(0, 4086);
    const thumbUrl = String(linkThumbnailUrl || '').trim() || youtubeThumbnail(link);
    if (thumbUrl) {
      try {
        article.thumbnail = await uploadImageFromUrl({ token, owner: author, url: thumbUrl });
      } catch (err) {
        thumbnailError = `The link card was posted without a thumbnail: ${err.message}`;
      }
    }
    body.content = { article };
  }

  const res = await fetch('https://api.linkedin.com/rest/posts', {
    method: 'POST',
    headers: restHeaders(token, true),
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let data = {};
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = {};
    }
  }
  if (!res.ok) {
    throw new Error(data.message || data.error_description || raw.slice(0, 300) || 'LinkedIn post failed.');
  }
  const postUrn = res.headers.get('x-restli-id') || data.id || '';
  const post = {
    id: randomBytes(8).toString('hex'),
    network: 'linkedin',
    mediaId: mediaId || '',
    title: String(title || text).slice(0, 200),
    description: text,
    linkedinId: postUrn,
    url: postUrn ? `https://www.linkedin.com/feed/update/${encodeURIComponent(postUrn)}` : '',
    createdAt: new Date().toISOString(),
    source: source || 'manual',
  };
  if (link && !filePath) post.link = link;
  await addPost(post);
  return thumbnailError ? { ...post, thumbnailError } : post;
}

function linkPreviewUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('The link to share is not a valid URL.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('The link to share must start with http or https.');
  if (url.username || url.password) throw new Error('The link to share cannot include a password.');
  return url.toString();
}

function youtubeThumbnail(url) {
  const m = String(url).match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/);
  return m ? `https://i.ytimg.com/vi/${m[1]}/maxresdefault.jpg` : '';
}

const MAX_THUMBNAIL = 8 * 1024 * 1024;

async function uploadImageFromUrl({ token, owner, url }) {
  let { res: img } = await fetchPublic(url, 'Thumbnail URL');
  if (!img.ok && /maxresdefault/.test(url)) ({ res: img } = await fetchPublic(url.replace('maxresdefault', 'hqdefault'), 'Thumbnail URL'));
  if (!img.ok) throw new Error(`could not download it (${img.status}).`);
  const type = String(img.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!type.startsWith('image/')) throw new Error('that URL is not an image.');
  if (Number(img.headers.get('content-length') || 0) > MAX_THUMBNAIL) throw new Error('the image is larger than 8 MB.');
  const buffer = Buffer.from(await img.arrayBuffer());
  if (buffer.length > MAX_THUMBNAIL) throw new Error('the image is larger than 8 MB.');
  const init = await fetch('https://api.linkedin.com/rest/images?action=initializeUpload', {
    method: 'POST',
    headers: restHeaders(token, true),
    body: JSON.stringify({ initializeUploadRequest: { owner } }),
  });
  const data = await init.json().catch(() => ({}));
  if (!init.ok || !data.value?.uploadUrl) throw new Error(data.message || `Image upload init failed (${init.status}).`);
  const put = await fetch(data.value.uploadUrl, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': type },
    body: buffer,
  });
  if (!put.ok) throw new Error(`Image upload failed (${put.status}).`);
  return data.value.image;
}

// Posts API commentary uses LinkedIn's "little text" format; unescaped reserved characters truncate the post.
const LITTLE_RESERVED = new Set(['\\', '|', '{', '}', '@', '[', ']', '(', ')', '<', '>', '#', '*', '_', '~']);

function escapeLittleText(value) {
  return [...String(value)].map((c) => (LITTLE_RESERVED.has(c) ? `\\${c}` : c)).join('');
}

export function toLittleText(value) {
  const text = String(value);
  const hashtag = /(^|[^\p{L}\p{N}_&/])#([\p{L}\p{N}_]*\p{L}[\p{L}\p{N}_]*)/gu;
  let out = '';
  let last = 0;
  for (const match of text.matchAll(hashtag)) {
    const start = match.index + match[1].length;
    out += escapeLittleText(text.slice(last, start));
    out += `{hashtag|\\#|${escapeLittleText(match[2])}}`;
    last = start + 1 + match[2].length;
  }
  return out + escapeLittleText(text.slice(last));
}

export function linkedinPostUrn(value) {
  const raw = String(value || '').trim();
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  const match = decoded.match(/urn:li:(share|ugcPost|activity):\d+/);
  if (!match) throw new Error('Give the LinkedIn post URN (urn:li:share:…) or its post link.');
  return match[0];
}

export async function commentLinkedin({ post, text }) {
  const message = String(text || '').trim();
  if (!message) throw new Error('LinkedIn needs comment text.');
  if (message.length > 1250) throw new Error('LinkedIn comments are limited to 1250 characters.');
  const postUrn = linkedinPostUrn(post);
  const token = await accessToken();
  const stored = await readNetworkToken('linkedin');
  const actor = stored?.profile?.urn;
  if (!actor) throw new Error('Connect LinkedIn again so Socialbrewery can read your profile.');

  const res = await fetch(`https://api.linkedin.com/rest/socialActions/${encodeURIComponent(postUrn)}/comments`, {
    method: 'POST',
    headers: restHeaders(token, true),
    body: JSON.stringify({ actor, object: postUrn, message: { text: toLittleText(message) } }),
  });
  const raw = await res.text();
  let data = {};
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = {};
    }
  }
  if (!res.ok) {
    const reason = data.message || data.error_description || raw.slice(0, 300) || 'LinkedIn comment failed.';
    const err = new Error(res.status === 403
      ? `LinkedIn refused the comment (${reason}). This LinkedIn app may not be allowed to comment through the API.`
      : reason);
    err.status = res.status === 403 ? 400 : undefined;
    throw err;
  }
  return {
    postUrn,
    commentUrn: data.commentUrn || res.headers.get('x-restli-id') || '',
    url: `https://www.linkedin.com/feed/update/${encodeURIComponent(postUrn)}`,
  };
}


export async function updateLinkedInPost(urn, text) {
  const message = String(text || '').trim();
  if (!message) throw new Error('LinkedIn needs post text.');
  if (message.length > 3000) throw new Error('LinkedIn posts are limited to 3000 characters.');
  const postUrn = linkedinPostUrn(urn);
  const token = await accessToken();
  const res = await fetch(`https://api.linkedin.com/rest/posts/${encodeURIComponent(postUrn)}`, {
    method: 'POST',
    headers: { ...restHeaders(token, true), 'X-RestLi-Method': 'PARTIAL_UPDATE' },
    body: JSON.stringify({
      patch: {
        $set: { commentary: toLittleText(message) },
      },
    }),
  });
  const raw = await res.text();
  let data = {};
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = {};
    }
  }
  if (!res.ok) {
    throw new Error(data.message || data.error_description || raw.slice(0, 300) || 'LinkedIn post update failed.');
  }
  return {
    postUrn,
    url: `https://www.linkedin.com/feed/update/${encodeURIComponent(postUrn)}`,
  };
}

export async function uploadVideo({ token, owner, read, bytes }) {
  const init = await fetch('https://api.linkedin.com/rest/videos?action=initializeUpload', {
    method: 'POST',
    headers: restHeaders(token, true),
    body: JSON.stringify({
      initializeUploadRequest: {
        owner,
        fileSizeBytes: bytes,
        uploadCaptions: false,
        uploadThumbnail: false,
      },
    }),
  });
  const initData = await init.json().catch(() => ({}));
  if (!init.ok) {
    throw new Error(initData.message || 'LinkedIn did not start the video upload.');
  }
  const value = initData.value || {};
  const videoUrn = value.video;
  const instructions = value.uploadInstructions || [];
  if (!videoUrn || !instructions.length) throw new Error('LinkedIn did not return upload instructions.');

  const etags = [];
  for (const part of instructions) {
    const first = Number(part.firstByte);
    const last = Number(part.lastByte);
    const length = last - first + 1;
    const etag = await putRange(part.uploadUrl, await read(first, last));
    etags.push(etag);
  }

  const finalize = await fetch('https://api.linkedin.com/rest/videos?action=finalizeUpload', {
    method: 'POST',
    headers: restHeaders(token, true),
    body: JSON.stringify({
      finalizeUploadRequest: {
        video: videoUrn,
        uploadToken: '',
        uploadedPartIds: etags,
      },
    }),
  });
  if (!finalize.ok) {
    const data = await finalize.json().catch(() => ({}));
    throw new Error(data.message || 'LinkedIn could not finish the video upload.');
  }
  return videoUrn;
}

async function putRange(urlString, chunk) {
  const res = await fetch(urlString, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: chunk,
  });
  const etag = res.headers.get('etag') || '';
  if (!res.ok) throw new Error(`LinkedIn upload part failed (${res.status}).`);
  if (!etag) throw new Error('LinkedIn did not return an ETag for the uploaded part.');
  return etag.replace(/^"|"$/g, '');
}

async function readLocalRange(file, start, end) {
  const length = end - start + 1;
  const buffer = Buffer.alloc(length);
  const handle = await fs.open(file, 'r');
  try {
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
