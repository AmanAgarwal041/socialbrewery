import { randomBytes, timingSafeEqual } from 'node:crypto';
import { appUrl } from './env.js';
import { buildVideoBody, buildVideoUpdate } from './shorts.js';
import { assertResolvedPublicUrl, isVideoId, last28DayRange, rowToMetrics, shapeVideo } from './performance.js';
import {
  addPost,
  updatePostYoutube,
  clearOauthState,
  clearToken,
  createMedia,
  getMedia,
  mediaPath,
  readOauthState,
  readToken,
  writeOauthState,
  writeToken,
} from './store.js';
import { cfg } from './context.js';
import { blobSize, readBlobRange } from './storage.js';

const UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload';
const READ_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
const ANALYTICS_SCOPE = 'https://www.googleapis.com/auth/yt-analytics.readonly';
const EDIT_SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';

export function redirectUri() {
  return `${appUrl()}/api/youtube/callback`;
}

function clientConfig() {
  const clientId = cfg.YOUTUBE_CLIENT_ID;
  const clientSecret = cfg.YOUTUBE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Add the YouTube client ID and secret in Settings (an organisation admin can do this).');
  }
  return { clientId, clientSecret };
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function beginConnect() {
  const { clientId } = clientConfig();
  const state = randomBytes(24).toString('hex');
  await writeOauthState({ state, exp: Date.now() + 15 * 60 * 1000 });
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: `${UPLOAD_SCOPE} ${READ_SCOPE} ${ANALYTICS_SCOPE} ${EDIT_SCOPE}`,
    access_type: 'offline',
    prompt: 'consent select_account',
    include_granted_scopes: 'true',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function finishConnect(code, state) {
  const saved = await readOauthState();
  await clearOauthState();
  if (!saved || !safeEqual(saved.state, state) || saved.exp < Date.now()) {
    throw new Error('That YouTube connection expired. Try Connect again.');
  }
  const { clientId, clientSecret } = clientConfig();
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }),
  });
  const token = await tokenRes.json();
  if (!tokenRes.ok) {
    throw new Error(token.error_description || token.error || 'YouTube did not return a token.');
  }
  if (!token.refresh_token) {
    throw new Error('Google did not return a refresh token. Connect again and accept the consent screen.');
  }
  const stored = {
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    expires_at: Date.now() + (token.expires_in ?? 3600) * 1000,
    channel: null,
  };
  stored.channel = await fetchChannel(stored.access_token);
  await writeToken(stored);
  return stored.channel;
}

async function fetchChannel(accessToken) {
  const res = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || 'YouTube did not return the channel.');
  }
  const channel = data.items?.[0];
  if (!channel) throw new Error('That Google account has no YouTube channel.');
  return {
    id: channel.id,
    title: channel.snippet?.title || 'YouTube channel',
    customUrl: channel.snippet?.customUrl || '',
    thumbnail: safeThumb(channel.snippet?.thumbnails?.default?.url),
  };
}

function safeThumb(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return '';
    if (/\.(ggpht|googleusercontent|ytimg)\.com$/.test(parsed.hostname)) return parsed.toString();
  } catch {
    return '';
  }
  return '';
}

export async function youtubeStatus() {
  const token = await readToken();
  if (!token?.refresh_token) return { connected: false, channel: null };
  try {
    const access = await accessToken();
    const channel = await fetchChannel(access);
    const latest = await readToken();
    if (latest && (latest.channel?.id !== channel.id || latest.channel?.customUrl !== channel.customUrl || latest.channel?.title !== channel.title)) {
      latest.channel = channel;
      await writeToken(latest);
    }
    return { connected: true, channel };
  } catch {
    return { connected: true, channel: token.channel || null };
  }
}

export async function disconnectYoutube() {
  const token = await readToken();
  if (token?.refresh_token) {
    await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: token.refresh_token }),
    }).catch(() => undefined);
  }
  await clearToken();
}

async function accessToken() {
  const token = await readToken();
  if (!token?.refresh_token) {
    const err = new Error('Connect YouTube on the YouTube page first.');
    err.status = 400;
    throw err;
  }
  if (token.access_token && token.expires_at > Date.now() + 30_000) return token.access_token;
  const { clientId, clientSecret } = clientConfig();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: token.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error_description || 'YouTube login expired. Connect the channel again.');
  }
  token.access_token = data.access_token;
  token.expires_at = Date.now() + (data.expires_in ?? 3600) * 1000;
  if (data.refresh_token) token.refresh_token = data.refresh_token;
  await writeToken(token);
  return token.access_token;
}

export async function publishShort({
  mediaId,
  title,
  description,
  tags,
  privacyStatus,
  madeForKids,
  source,
}) {
  const media = await getMedia(mediaId);
  if (!media) throw new Error('That video is not in the library. Attach a file or ask Grok to generate one.');
  const filePath = mediaPath(media);
  const bytes = await blobSize(filePath);
  if (!bytes) throw new Error('That video file is missing from storage.');
  const body = buildVideoBody({ title, description, tags, privacyStatus, madeForKids });
  const video = await uploadFile({
    filePath,
    mime: media.mime || 'video/mp4',
    bytes,
    body,
  });
  const post = {
    id: randomBytes(8).toString('hex'),
    mediaId,
    title: body.snippet.title,
    description: body.snippet.description,
    tags: body.snippet.tags,
    privacyStatus: body.status.privacyStatus,
    madeForKids: body.status.selfDeclaredMadeForKids,
    youtubeId: video.id,
    url: `https://www.youtube.com/shorts/${video.id}`,
    watchUrl: `https://www.youtube.com/watch?v=${video.id}`,
    createdAt: new Date().toISOString(),
    source: source || 'manual',
  };
  await addPost(post);
  return post;
}

async function uploadFile({ filePath, mime, bytes, body }) {
  const token = await accessToken();
  const init = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(bytes),
        'X-Upload-Content-Type': mime,
      },
      body: JSON.stringify(body),
    },
  );
  if (!init.ok) {
    const text = await init.text();
    throw new Error(youtubeError(text, init.status));
  }
  const location = init.headers.get('location');
  if (!location) throw new Error('YouTube did not return an upload URL.');
  const uploaded = await putFile(new URL(location, 'https://www.googleapis.com').toString(), filePath, { mime, bytes });
  if (uploaded.status < 200 || uploaded.status >= 300) {
    throw new Error(youtubeError(uploaded.body, uploaded.status));
  }
  let video;
  try {
    video = JSON.parse(uploaded.body);
  } catch {
    throw new Error('YouTube accepted the upload but returned an unreadable response.');
  }
  if (!video.id) throw new Error('YouTube did not return a video id.');
  return video;
}

function youtubeError(text, status) {
  try {
    const data = JSON.parse(text);
    if (data.error?.message) return data.error.message;
  } catch {
    // The body is already the message we show.
  }
  const snippet = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  return snippet || `YouTube upload failed (${status}).`;
}

export async function listChannelVideos(limit = 10) {
  const token = await accessToken();
  const count = Math.min(20, Math.max(1, Number(limit) || 10));
  const channel = await youtubeGet('channels?part=contentDetails&mine=true', token);
  const uploads = channel.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) throw new Error('YouTube did not return the uploads playlist.');
  const playlist = await youtubeGet(
    `playlistItems?part=contentDetails&maxResults=${count}&playlistId=${encodeURIComponent(uploads)}`,
    token,
  );
  const ids = (playlist.items || []).map((item) => item.contentDetails?.videoId).filter(Boolean);
  if (!ids.length) return [];
  const videos = await youtubeGet(
    `videos?part=snippet,statistics,contentDetails,status&id=${ids.join(',')}`,
    token,
  );
  const byId = new Map((videos.items || []).map((video) => [video.id, shapeVideo(video)]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

export async function updateVideo({ videoId, title, description, tags, privacyStatus }) {
  if (!isVideoId(videoId)) throw new Error('That is not a YouTube video id.');
  const token = await accessToken();
  const mine = await youtubeGet('channels?part=id&mine=true', token);
  const channelId = mine.items?.[0]?.id || '';
  const current = await youtubeGet(`videos?part=snippet,status&id=${encodeURIComponent(videoId)}`, token);
  const video = current.items?.[0];
  if (!video || (channelId && video.snippet?.channelId !== channelId)) {
    throw new Error('That video is not on the connected channel.');
  }
  const { parts, body } = buildVideoUpdate(video, { title, description, tags, privacyStatus });
  const updated = await youtubeSend('PUT', `videos?part=${parts.join(',')}`, token, body);
  const next = {
    videoId,
    title: updated.snippet?.title || body.snippet?.title || video.snippet?.title || '',
    description: updated.snippet?.description ?? body.snippet?.description ?? video.snippet?.description ?? '',
    tags: updated.snippet?.tags || body.snippet?.tags || video.snippet?.tags || [],
    privacyStatus: updated.status?.privacyStatus || body.status?.privacyStatus || video.status?.privacyStatus || '',
    url: `https://www.youtube.com/watch?v=${videoId}`,
    shortsUrl: `https://www.youtube.com/shorts/${videoId}`,
  };
  await updatePostYoutube(videoId, {
    title: next.title,
    description: next.description,
    tags: next.tags,
    privacyStatus: next.privacyStatus,
  });
  return next;
}

export async function videoPerformance(videoId) {
  if (!isVideoId(videoId)) throw new Error('That is not a YouTube video id.');
  const token = await accessToken();
  const range = last28DayRange();
  const params = new URLSearchParams({
    ids: 'channel==MINE',
    startDate: range.startDate,
    endDate: range.endDate,
    metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,comments,shares,subscribersGained',
    filters: `video==${videoId}`,
  });
  const res = await fetch(`https://youtubeanalytics.googleapis.com/v2/reports?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data.error?.message || 'YouTube analytics failed.';
    if (res.status === 403) {
      throw new Error(`${message} Enable YouTube Analytics API in Google Cloud, then reconnect the channel.`);
    }
    throw new Error(message);
  }
  const videos = await youtubeGet(
    `videos?part=snippet,statistics,contentDetails,status&id=${videoId}`,
    token,
  );
  const video = videos.items?.[0];
  if (!video) throw new Error('That video is not on the connected channel.');
  return {
    video: shapeVideo(video),
    last28Days: rowToMetrics(data.columnHeaders, data.rows?.[0]),
    range,
  };
}

export async function importRemoteVideo(videoUrl) {
  const url = await assertResolvedPublicUrl(videoUrl);
  let current = url;
  let res;
  for (let hop = 0; hop < 3; hop += 1) {
    res = await fetch(current, { redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location');
      if (!next) throw new Error('The video URL redirected without a destination.');
      current = await assertResolvedPublicUrl(new URL(next, current).toString());
      continue;
    }
    break;
  }
  if (!res?.ok) throw new Error(`Could not download that video (${res?.status || 'no response'}).`);
  const type = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const mime = type === 'video/webm' ? 'video/webm' : type === 'video/quicktime' ? 'video/quicktime' : 'video/mp4';
  if (type && !type.startsWith('video/') && type !== 'application/octet-stream') {
    throw new Error('That URL did not return a video file.');
  }
  const length = Number(res.headers.get('content-length') || 0);
  if (length > 200 * 1024 * 1024) throw new Error('That video is larger than 200 MB.');
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error('That video file was empty.');
  if (buffer.length > 200 * 1024 * 1024) throw new Error('That video is larger than 200 MB.');
  const name = decodeURIComponent(current.pathname.split('/').pop() || 'short.mp4');
  return createMedia({ buffer, name, mime, source: 'connector' });
}

async function youtubeGet(path, token) {
  return youtubeSend('GET', path, token);
}

async function youtubeSend(method, path, token, body) {
  const res = await fetch(`https://www.googleapis.com/youtube/v3/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = data.error?.errors?.[0]?.reason || '';
    const message = data.error?.message || 'YouTube request failed.';
    if (res.status === 403 && /insufficient|SCOPE/i.test(`${reason} ${message}`)) {
      throw new Error('Reconnect YouTube so Socialbrewery can edit videos that are already uploaded.');
    }
    throw new Error(message);
  }
  return data;
}

// Resumable upload in 8 MiB pieces (a multiple of 256 KiB, as YouTube requires) so a whole video
// never sits in memory and each piece is one request.
const UPLOAD_CHUNK = 8 * 1024 * 1024;

async function putFile(url, filePath, { mime, bytes }) {
  let start = 0;
  for (;;) {
    const end = Math.min(start + UPLOAD_CHUNK, bytes) - 1;
    const res = await fetch(url, {
      method: 'PUT',
      redirect: 'manual',
      headers: { 'Content-Type': mime, 'Content-Range': `bytes ${start}-${end}/${bytes}` },
      body: await readBlobRange(filePath, start, end),
    });
    const text = await res.text();
    if (res.status !== 308) return { status: res.status, body: text };
    const received = /bytes=0-(\d+)/.exec(res.headers.get('range') || '');
    start = received ? Number(received[1]) + 1 : 0;
    if (start >= bytes) return { status: 500, body: 'YouTube did not finish the upload.' };
  }
}
