import { clampSeconds } from './shorts.js';
import { allocateMedia, rememberMedia } from './store.js';
import { onWorkers, removeEntry, writeBlob } from './storage.js';
import { cfg } from './context.js';

function apiKey() {
  const key = cfg.XAI_API_KEY;
  if (!key) throw new Error('Add your xAI API key in Settings (an organisation admin can do this).');
  return key;
}

async function xai(pathname, { method = 'GET', body } = {}) {
  const headers = { Authorization: `Bearer ${apiKey()}` };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`https://api.x.ai${pathname}`, { method, headers, body });
  const text = await res.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text.slice(0, 400) };
    }
  }
  if (!res.ok) {
    const message = data.error?.message || data.error || data.message || `Grok request failed (${res.status}).`;
    throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
  }
  return data;
}

export async function grokChat({ messages, tools }) {
  const data = await xai('/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      model: cfg.XAI_MODEL || 'grok-4.6',
      messages,
      tools,
      temperature: 0.4,
    }),
  });
  const message = data.choices?.[0]?.message;
  if (!message) throw new Error('Grok returned an empty reply.');
  return message;
}

function delay(ms, signal) {
  if (signal?.aborted) return Promise.reject(new Error('Stopped.'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Stopped.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function generateShort({ prompt, duration, onProgress, signal }) {
  const text = String(prompt || '').trim();
  if (!text) throw new Error('Grok needs a prompt before it can generate a Short.');
  if (text.length > 4000) throw new Error('That video prompt is too long.');
  const seconds = clampSeconds(duration);
  const started = await xai('/v1/videos/generations', {
    method: 'POST',
    body: JSON.stringify({
      model: cfg.XAI_VIDEO_MODEL || 'grok-imagine-video-1.5',
      prompt: text,
      duration: seconds,
      aspect_ratio: '9:16',
      resolution: '720p',
    }),
  });
  const requestId = started.request_id;
  if (!requestId) throw new Error('Grok video did not return a request id.');

  const deadline = Date.now() + 8 * 60 * 1000;
  let video;
  while (Date.now() < deadline) {
    // Each status check is a subrequest; the Workers free plan allows 50 per request.
    await delay(onWorkers() ? 15000 : 4000, signal);
    onProgress?.('Generating the Short…');
    const data = await xai(`/v1/videos/${requestId}`);
    if (data.status === 'done') {
      video = data.video;
      break;
    }
    if (data.status === 'failed' || data.status === 'expired') {
      const message = data.error?.message || data.error || `Video generation ${data.status}.`;
      throw new Error(typeof message === 'string' ? message : `Video generation ${data.status}.`);
    }
  }
  if (!video?.url) throw new Error('Video generation timed out after 8 minutes.');

  const { record, filePath } = await allocateMedia({
    name: 'grok-short.mp4',
    mime: 'video/mp4',
    source: 'grok',
    prompt: text,
  });
  try {
    const bytes = await download(video.url, filePath);
    record.bytes = bytes;
    record.duration = video.duration || seconds;
    await rememberMedia(record);
    return record;
  } catch (err) {
    await removeEntry(filePath).catch(() => {});
    throw err;
  }
}

async function download(url, dest) {
  let res = await fetch(url);
  if (res.status === 401 || res.status === 403) {
    res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey()}` } });
  }
  if (!res.ok) throw new Error(`Could not download the generated video (${res.status}).`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < 1000) throw new Error('The generated video file was empty.');
  await writeBlob(dest, bytes, { mime: 'video/mp4' });
  return bytes.length;
}
