import { Readable } from 'node:stream';

// Storage backend for Cloudflare Workers: JSON documents in a D1 table, videos in an R2 bucket.
// Keys are the same relative paths the file backend uses (e.g. "orgs/<id>/posts.json").
export function cloudflareStorage({ db, bucket }) {
  let tableReady = false;

  async function ensureTable() {
    if (tableReady) return;
    await db.prepare('CREATE TABLE IF NOT EXISTS documents (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)').run();
    tableReady = true;
  }

  return {
    kind: 'cloudflare',
    async readText(key) {
      await ensureTable();
      const value = await db.prepare('SELECT value FROM documents WHERE key = ?').bind(key).first('value');
      return value ?? null;
    },
    async writeText(key, text) {
      await ensureTable();
      await db
        .prepare('INSERT INTO documents (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
        .bind(key, text, Date.now())
        .run();
    },
    async remove(key) {
      await ensureTable();
      await db.prepare('DELETE FROM documents WHERE key = ?').bind(key).run();
      await bucket.delete(key);
    },
    async blobSize(key) {
      const head = await bucket.head(key);
      return head ? head.size : null;
    },
    async readBlobRange(key, start, end) {
      const object = await bucket.get(key, { range: { offset: start, length: end - start + 1 } });
      if (!object) throw new Error('That video file is missing from storage.');
      return Buffer.from(await object.arrayBuffer());
    },
    async blobStream(key, range) {
      const options = range ? { range: { offset: range.start, length: range.end - range.start + 1 } } : {};
      const object = await bucket.get(key, options);
      if (!object) throw new Error('That video file is missing from storage.');
      return Readable.fromWeb(object.body);
    },
    async writeBlob(key, body, { mime } = {}) {
      const object = await bucket.put(key, body, mime ? { httpMetadata: { contentType: mime } } : undefined);
      return object.size;
    },
  };
}
