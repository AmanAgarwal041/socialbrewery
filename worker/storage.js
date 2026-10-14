import { Readable } from 'node:stream';

// D1 rows hold at most 2 MB, and BLOB columns read back as plain number arrays, so videos kept
// in D1 are split into 1.4 MB pieces stored as base64 text (about 1.87 MB per row).
const PIECE = 1_400_000;
const MB = 1024 * 1024;

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS documents (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS media_files (key TEXT PRIMARY KEY, size INTEGER NOT NULL, mime TEXT, created_at INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS media_pieces (key TEXT NOT NULL, part INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (key, part))',
];

// Storage backend for Cloudflare Workers. JSON documents always live in D1. Videos live in R2
// when a bucket is bound, otherwise in D1, where the oldest videos are removed to stay inside
// the budget (the Free plan allows 500 MB per database).
export function cloudflareStorage({ db, bucket, maxVideoMb = 25, budgetMb = 350 }) {
  let ready = false;
  const maxVideo = maxVideoMb * MB;
  const budget = budgetMb * MB;

  async function ensureTables() {
    if (ready) return;
    await db.batch(SCHEMA.map((sql) => db.prepare(sql)));
    ready = true;
  }

  async function removeVideo(key) {
    await db.batch([
      db.prepare('DELETE FROM media_pieces WHERE key = ?').bind(key),
      db.prepare('DELETE FROM media_files WHERE key = ?').bind(key),
    ]);
  }

  async function makeRoom(incoming) {
    const { results } = await db.prepare('SELECT key, size FROM media_files ORDER BY created_at ASC').all();
    let used = results.reduce((sum, row) => sum + row.size, 0);
    for (const row of results) {
      if (used + incoming <= budget) break;
      await removeVideo(row.key);
      used -= row.size;
    }
  }

  async function readPieces(key, start, end) {
    const { results } = await db
      .prepare('SELECT part, data FROM media_pieces WHERE key = ? AND part BETWEEN ? AND ? ORDER BY part')
      .bind(key, Math.floor(start / PIECE), Math.floor(end / PIECE))
      .all();
    const first = Math.floor(start / PIECE) * PIECE;
    const joined = Buffer.concat(results.map((row) => Buffer.from(row.data, 'base64')));
    return joined.subarray(start - first, end - first + 1);
  }

  async function writePieces(key, body, size) {
    let part = 0;
    let total = 0;
    let pending = [];
    let pendingBytes = 0;
    const flush = async (all) => {
      while (pendingBytes >= PIECE || (all && pendingBytes > 0)) {
        const joined = Buffer.concat(pending);
        const piece = joined.subarray(0, PIECE);
        pending = [joined.subarray(piece.length)];
        pendingBytes = joined.length - piece.length;
        await db.prepare('INSERT INTO media_pieces (key, part, data) VALUES (?, ?, ?)').bind(key, part, piece.toString('base64')).run();
        part += 1;
      }
    };
    const add = async (chunk) => {
      total += chunk.length;
      if (total > maxVideo) throw tooLarge(maxVideoMb);
      pending.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.length));
      pendingBytes += chunk.length;
      await flush(false);
    };
    await makeRoom(size || 0);
    try {
      if (typeof body?.getReader === 'function') {
        const reader = body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          await add(value);
        }
      } else {
        await add(Buffer.from(body));
      }
      await flush(true);
    } catch (err) {
      await removeVideo(key);
      throw err;
    }
    return total;
  }

  const videos = bucket
    ? {
        async size(key) {
          const head = await bucket.head(key);
          return head ? head.size : null;
        },
        async range(key, start, end) {
          const object = await bucket.get(key, { range: { offset: start, length: end - start + 1 } });
          if (!object) throw missing();
          return Buffer.from(await object.arrayBuffer());
        },
        async body(key, range) {
          const object = await bucket.get(key, range ? { range: { offset: range.start, length: range.end - range.start + 1 } } : {});
          if (!object) throw missing();
          return object.body;
        },
        async write(key, body, { mime } = {}) {
          const object = await bucket.put(key, body, mime ? { httpMetadata: { contentType: mime } } : undefined);
          return object.size;
        },
        async remove(key) {
          await bucket.delete(key);
        },
      }
    : {
        async size(key) {
          await ensureTables();
          const size = await db.prepare('SELECT size FROM media_files WHERE key = ?').bind(key).first('size');
          return size ?? null;
        },
        async range(key, start, end) {
          if ((await this.size(key)) == null) throw missing();
          return readPieces(key, start, end);
        },
        async body(key, range) {
          const size = await this.size(key);
          if (size == null) throw missing();
          let at = range ? range.start : 0;
          const last = range ? range.end : size - 1;
          return new ReadableStream({
            async pull(controller) {
              if (at > last) {
                controller.close();
                return;
              }
              const end = Math.min(last, (Math.floor(at / PIECE) + 1) * PIECE - 1);
              controller.enqueue(new Uint8Array(await readPieces(key, at, end)));
              at = end + 1;
            },
          });
        },
        async write(key, body, { mime, size } = {}) {
          await ensureTables();
          const expected = size || (typeof body?.getReader === 'function' ? 0 : body.length);
          if (expected > maxVideo) throw tooLarge(maxVideoMb);
          await removeVideo(key);
          const total = await writePieces(key, body, expected);
          await db
            .prepare('INSERT OR REPLACE INTO media_files (key, size, mime, created_at) VALUES (?, ?, ?, ?)')
            .bind(key, total, mime || null, Date.now())
            .run();
          return total;
        },
        async remove(key) {
          await ensureTables();
          await removeVideo(key);
        },
      };

  return {
    kind: 'cloudflare',
    videosIn: bucket ? 'r2' : 'd1',
    maxVideoBytes: bucket ? 100 * MB : maxVideo,
    async readText(key) {
      await ensureTables();
      const value = await db.prepare('SELECT value FROM documents WHERE key = ?').bind(key).first('value');
      return value ?? null;
    },
    async writeText(key, text) {
      await ensureTables();
      await db
        .prepare('INSERT INTO documents (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
        .bind(key, text, Date.now())
        .run();
    },
    async remove(key) {
      await ensureTables();
      await db.prepare('DELETE FROM documents WHERE key = ?').bind(key).run();
      await videos.remove(key);
    },
    blobSize: (key) => videos.size(key),
    readBlobRange: (key, start, end) => videos.range(key, start, end),
    blobBody: (key, range) => videos.body(key, range),
    async blobStream(key, range) {
      return Readable.fromWeb(await videos.body(key, range));
    },
    writeBlob: (key, body, options) => videos.write(key, body, options),
  };
}

function missing() {
  return Object.assign(new Error('That video is no longer stored. Attach it or generate it again.'), { status: 404 });
}

function tooLarge(mb) {
  return Object.assign(new Error(`Videos must be ${mb} MB or smaller on this server.`), { status: 413 });
}
