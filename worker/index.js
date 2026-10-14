import http from 'node:http';
import { httpServerHandler } from 'cloudflare:node';
import { env } from 'cloudflare:workers';
import { useStorage, storageKey, writeBlob } from '../src/storage.js';
import { cloudflareStorage } from './storage.js';
import { runWithOrg } from '../src/context.js';
import { allocateMedia, getMedia, mediaPath, rememberMedia } from '../src/store.js';
import { handleRequest, mediaUploadInfo, publicMediaContext, signedInContext } from '../src/server.js';

const PORT = 3847;
// Cloudflare refuses request bodies above 100 MB on the Free plan.
const MAX_UPLOAD = 100 * 1024 * 1024;
const REQUIRED = ['APP_URL', 'SOCIALBREWERY_MASTER_KEY'];

useStorage(cloudflareStorage({ db: env.DB, bucket: env.MEDIA }));
http.createServer(handleRequest).listen(PORT);
const app = httpServerHandler({ port: PORT });

const API_MEDIA = /^\/api\/media\/([0-9a-f-]{36})$/i;
const PUBLIC_MEDIA = /^\/public\/media\/([a-f0-9]{24})\/([0-9a-f-]{36})$/i;

export default {
  async fetch(request, workerEnv, ctx) {
    const missing = REQUIRED.filter((key) => !workerEnv[key] || String(workerEnv[key]).includes('<'));
    if (!workerEnv.DB) missing.push('DB (D1 binding)');
    if (!workerEnv.MEDIA) missing.push('MEDIA (R2 binding)');
    if (missing.length) return text(503, `Socialbrewery is not configured yet. Set: ${missing.join(', ')}`);

    // Video bytes go straight between the client and R2; everything else runs through the Node app.
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
  if (length > MAX_UPLOAD) throw httpError('Videos must be 100 MB or smaller on this server.', 413);
  return runWithOrg(ctx, async () => {
    const { record, filePath } = await allocateMedia({ name, mime, source: 'upload' });
    record.bytes = await writeBlob(filePath, request.body, { mime });
    await rememberMedia(record);
    return json(201, { media: record });
  });
}

async function serveVideo(request, ctx, mediaId) {
  return runWithOrg(ctx, async () => {
    const record = await getMedia(mediaId);
    if (!record) throw httpError('That video is not in the library.', 404);
    const wantsRange = request.headers.has('range');
    let object;
    try {
      object = await env.MEDIA.get(storageKey(mediaPath(record)), wantsRange ? { range: request.headers } : undefined);
    } catch {
      throw httpError('That range is outside the video.', 416);
    }
    if (!object) throw httpError('That video file is missing from storage.', 404);
    const headers = new Headers({
      'Content-Type': record.mime || 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    if (!wantsRange || !object.range) {
      headers.set('Content-Length', String(object.size));
      return new Response(object.body, { status: 200, headers });
    }
    const range = object.range;
    const offset = range.suffix != null ? object.size - range.suffix : range.offset ?? 0;
    const length = range.suffix != null ? range.suffix : range.length ?? object.size - offset;
    if (offset < 0 || length <= 0 || offset + length > object.size) {
      object.body.cancel();
      throw httpError('That range is outside the video.', 416);
    }
    headers.set('Content-Length', String(length));
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
    return new Response(object.body, { status: 206, headers });
  });
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
