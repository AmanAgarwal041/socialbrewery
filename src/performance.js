import net from 'node:net';
import { lookup } from 'node:dns/promises';

export function isVideoId(id) {
  return /^[a-zA-Z0-9_-]{11}$/.test(String(id || ''));
}

export function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

export function last28DayRange(now = new Date()) {
  const end = new Date(now);
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - 28);
  return { startDate: isoDate(start), endDate: isoDate(end) };
}

export function rowToMetrics(headers, row) {
  const metrics = {};
  (headers || []).forEach((header, index) => {
    const name = typeof header === 'string' ? header : header?.name;
    if (!name) return;
    metrics[name] = row?.[index] ?? null;
  });
  return metrics;
}

export function shapeVideo(video) {
  const id = video?.id || '';
  const stats = video?.statistics || {};
  const thumbs = video?.snippet?.thumbnails || {};
  return {
    id,
    thumbnail: (thumbs.medium || thumbs.high || thumbs.default)?.url || '',
    title: video?.snippet?.title || 'Untitled',
    description: video?.snippet?.description || '',
    publishedAt: video?.snippet?.publishedAt || '',
    duration: video?.contentDetails?.duration || '',
    privacyStatus: video?.status?.privacyStatus || '',
    views: numberOrNull(stats.viewCount),
    likes: numberOrNull(stats.likeCount),
    comments: numberOrNull(stats.commentCount),
    url: id ? `https://www.youtube.com/watch?v=${id}` : '',
    shortsUrl: id ? `https://www.youtube.com/shorts/${id}` : '',
  };
}

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function isPrivateAddress(address) {
  const host = String(address || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (net.isIP(host) === 4) {
    const [a, b] = host.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (host === '::1' || host === '::') return true;
  return host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80');
}

export function assertPublicUrl(urlString, label = 'Video URL') {
  let url;
  try {
    url = new URL(String(urlString || ''));
  } catch {
    throw new Error(`That ${label.toLowerCase()} is not valid.`);
  }
  if (url.protocol !== 'https:') throw new Error(`${label} must be https.`);
  if (url.username || url.password) throw new Error(`${label} cannot include a password.`);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new Error(`${label} must be a public address.`);
  }
  if (net.isIP(host) && isPrivateAddress(host)) throw new Error(`${label} must be a public address.`);
  return url;
}

export async function assertResolvedPublicUrl(urlString, label = 'Video URL') {
  const url = assertPublicUrl(urlString, label);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) return url;
  const records = await lookup(host, { all: true });
  if (records.some((record) => isPrivateAddress(record.address))) {
    throw new Error(`${label} must be a public address.`);
  }
  return url;
}

// Fetches a URL someone else supplied. Every hop, redirects included, must resolve to a public
// address so the server cannot be pointed at its own network.
export async function fetchPublic(urlString, label = 'Video URL') {
  let current = await assertResolvedPublicUrl(urlString, label);
  for (let hop = 0; hop < 4; hop += 1) {
    const res = await fetch(current, { redirect: 'manual' });
    if (res.status < 300 || res.status >= 400) return { res, url: current };
    const next = res.headers.get('location');
    await res.body?.cancel();
    if (!next) throw new Error(`The ${label.toLowerCase()} redirected without a destination.`);
    current = await assertResolvedPublicUrl(new URL(next, current).toString(), label);
  }
  throw new Error(`The ${label.toLowerCase()} redirected too many times.`);
}
