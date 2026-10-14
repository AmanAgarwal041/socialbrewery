import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { dataDir } from './paths.js';

// Everything persistent goes through one backend: files under data/ when running on Node,
// D1 (JSON) and R2 (videos) when running on Cloudflare Workers. Callers keep using paths
// inside dataDir; the backend turns them into keys like "orgs/<id>/posts.json".
let backend = null;

export function useStorage(next) {
  backend = next;
}

function current() {
  if (!backend) backend = fileStorage();
  return backend;
}

export function onWorkers() {
  return current().kind === 'cloudflare';
}

export function storageKey(file) {
  const rel = path.relative(dataDir, path.resolve(file));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Storage path is outside the data folder.');
  return rel.split(path.sep).join('/');
}

export const readText = (file) => current().readText(storageKey(file));
export const writeText = (file, text) => current().writeText(storageKey(file), text);
export const removeEntry = (file) => current().remove(storageKey(file));
export const blobSize = (file) => current().blobSize(storageKey(file));
export const readBlobRange = (file, start, end) => current().readBlobRange(storageKey(file), start, end);
export const blobStream = (file, range) => current().blobStream(storageKey(file), range);
export const writeBlob = (file, body, options = {}) => current().writeBlob(storageKey(file), body, options);
export const maxVideoBytes = () => current().maxVideoBytes || 200 * 1024 * 1024;

export function fileStorage(base = dataDir) {
  const full = (key) => path.join(base, ...key.split('/'));
  return {
    kind: 'files',
    async readText(key) {
      try {
        return await fs.readFile(full(key), 'utf8');
      } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
      }
    },
    async writeText(key, text) {
      const file = full(key);
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      const tmp = `${file}.${process.pid}.tmp`;
      const handle = await fs.open(tmp, 'w', 0o600);
      try {
        await handle.writeFile(text);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(tmp, file);
    },
    async remove(key) {
      await fs.rm(full(key), { force: true });
    },
    async blobSize(key) {
      try {
        return (await fs.stat(full(key))).size;
      } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
      }
    },
    async readBlobRange(key, start, end) {
      const length = end - start + 1;
      const buffer = Buffer.alloc(length);
      const handle = await fs.open(full(key), 'r');
      try {
        let offset = 0;
        while (offset < length) {
          const { bytesRead } = await handle.read(buffer, offset, length - offset, start + offset);
          if (!bytesRead) break;
          offset += bytesRead;
        }
        return offset === length ? buffer : buffer.subarray(0, offset);
      } finally {
        await handle.close();
      }
    },
    async blobStream(key, range) {
      return createReadStream(full(key), range || {});
    },
    async writeBlob(key, body) {
      const file = full(key);
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
        await fs.writeFile(file, body, { mode: 0o600 });
        return body.length;
      }
      const source = typeof body?.getReader === 'function' ? Readable.fromWeb(body) : body;
      await pipeline(source, createWriteStream(file, { mode: 0o600 }));
      return (await fs.stat(file)).size;
    },
  };
}
