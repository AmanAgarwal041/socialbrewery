import http from 'node:http';
import { httpServerHandler } from 'cloudflare:node';
import { env } from 'cloudflare:workers';
import { useStorage, storageKey } from '../src/storage.js';
import { cloudflareStorage } from './storage.js';
import { runWithOrg } from '../src/context.js';
import { allocateMedia, getMedia, mediaPath, rememberMedia } from '../src/store.js';
import { handleRequest, mediaUploadInfo, publicMediaContext, signedInContext } from '../src/server.js';

const PORT = 3847;
const REQUIRED = ['APP_URL', 'SOCIALBREWERY_MASTER_KEY'];

const storage = cloudflareStorage({
  db: env.DB,
  bucket: env.MEDIA,
  maxVideoMb: Number(env.D1_VIDEO_MAX_MB) || 25,
  budgetMb: Number(env.D1_VIDEO_BUDGET_MB) || 350,
});
useStorage(storage);
http.createServer(handleRequest).listen(PORT);
const app = httpServerHandler({ port: PORT });

const API_MEDIA = /^\/api\/media\/([0-9a-f-]{36})$/i;
const PUBLIC_MEDIA = /^\/public\/media\/([a-f0-9]{24})\/([0-9a-f-]{36})$/i;

export default {
  async fetch(request, workerEnv, ctx) {
    const missing = REQUIRED.filter((key) => !workerEnv[key] || String(workerEnv[key]).includes('<'));
    if (!workerEnv.DB) missing.push('DB (D1 binding)');
    if (missing.length) return text(503, `Socialbrewery is not configured yet. Set: ${missing.join(', ')}`);

    // Video bytes go straight between the client and storage; everything else runs through the Node app.
    try {
      const { pathname, searchParams } = new URL(request.url);
      if (request.method === 'POST' && pathname === '/api/media') return await upload(request);
      const own = pathname.match(API_MEDIA);
      if (request.method === 'GET' && own) return await serveVideo(request, await signedInContext(nodeRequest(request)), own[1]);
      const shared = pathname.match(PUBLIC_MEDIA);
      if (request.method === 'GET' && shared) {
        return await serveVideo(request, await publicMediaContext(shared[1], shared[2], searchParams), shared[2]);
      }
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) console.error(err);
      return json(status, { error: err.message || 'Something went wrong.' });
    }
    return app.fetch(request, workerEnv, ctx);
  },
};

function nodeRequest(request) {
  return { method: request.method, headers: Object.fromEntries(request.headers) };
}

async function upload(request) {
  const req = nodeRequest(request);
  const ctx = await signedInContext(req);
  const { name, mime } = mediaUploadInfo(req);
  const length = Number(request.headers.get('content-length') || 0);
  if (!length || !request.body) throw httpError('That video file is empty.', 400);
  if (length > storage.maxVideoBytes) {
    throw httpError(`Videos must be ${Math.floor(storage.maxVideoBytes / 1024 / 1024)} MB or smaller on this server.`, 413);
  }
  return runWithOrg(ctx, async () => {
    const { record, filePath } = await allocateMedia({ name, mime, source: 'upload' });
    record.bytes = await storage.writeBlob(storageKey(filePath), request.body, { mime, size: length });
    await rememberMedia(record);
    return json(201, { media: record });
  });
}

async function serveVideo(request, ctx, mediaId) {
  return runWithOrg(ctx, async () => {
    const record = await getMedia(mediaId);
    if (!record) throw httpError('That video is not in the library.', 404);
    const key = storageKey(mediaPath(record));
    const size = await storage.blobSize(key);
    if (size == null) throw httpError('That video is no longer stored. Attach it or generate it again.', 404);
    const headers = new Headers({
      'Content-Type': record.mime || 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    const range = parseRange(request.headers.get('range'), size);
    if (!range) {
      headers.set('Content-Length', String(size));
      return new Response(await storage.blobBody(key), { status: 200, headers });
    }
    headers.set('Content-Length', String(range.end - range.start + 1));
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
    return new Response(await storage.blobBody(key, range), { status: 206, headers });
  });
}

function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) throw httpError('Ask for a byte range like bytes=0-.', 416);
  let start;
  let end;
  if (!match[1]) {
    start = Math.max(0, size - Number(match[2]));
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  if (start > end || start >= size) throw httpError('That range is outside the video.', 416);
  return { start, end };
}

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function text(status, body) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
