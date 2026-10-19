import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

process.env.SOCIALBREWERY_MASTER_KEY = randomBytes(32).toString('base64');

const { useStorage, blobSize, readBlobRange, writeBlob, storageKey } = await import('../src/storage.js');
const { cloudflareStorage } = await import('../worker/storage.js');
const { dataDir } = await import('../src/paths.js');

// Just enough of D1 to run the statements the Workers backend uses.
function fakeD1() {
  const documents = new Map();
  const files = new Map();
  const pieces = new Map();
  const execute = (sql, args) => {
    if (sql.startsWith('CREATE TABLE')) return [];
    if (sql === 'SELECT value FROM documents WHERE key = ?') return documents.has(args[0]) ? [{ value: documents.get(args[0]) }] : [];
    if (sql.startsWith('INSERT INTO documents')) return void documents.set(args[0], args[1]);
    if (sql === 'DELETE FROM documents WHERE key = ?') return void documents.delete(args[0]);
    if (sql === 'SELECT size FROM media_files WHERE key = ?') return files.has(args[0]) ? [{ size: files.get(args[0]).size }] : [];
    if (sql.startsWith('SELECT key, size FROM media_files')) {
      return [...files].sort((a, b) => a[1].created_at - b[1].created_at).map(([key, row]) => ({ key, size: row.size }));
    }
    if (sql.startsWith('INSERT OR REPLACE INTO media_files')) return void files.set(args[0], { size: args[1], created_at: args[3] });
    if (sql === 'DELETE FROM media_files WHERE key = ?') return void files.delete(args[0]);
    if (sql.startsWith('INSERT INTO media_pieces')) return void pieces.set(`${args[0]}#${args[1]}`, args[2]);
    if (sql === 'DELETE FROM media_pieces WHERE key = ?') {
      for (const id of [...pieces.keys()]) if (id.startsWith(`${args[0]}#`)) pieces.delete(id);
      return;
    }
    if (sql.startsWith('SELECT part, data FROM media_pieces')) {
      const out = [];
      for (let part = args[1]; part <= args[2]; part += 1) {
        const data = pieces.get(`${args[0]}#${part}`);
        if (data) out.push({ part, data });
      }
      return out;
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const prepare = (sql) => {
    let args = [];
    const statement = {
      bind(...values) {
        args = values;
        return statement;
      },
      run: async () => (execute(sql, args), { success: true }),
      all: async () => ({ results: execute(sql, args) || [] }),
      first: async (column) => (execute(sql, args) || [])[0]?.[column] ?? null,
    };
    return statement;
  };
  return {
    documents,
    files,
    pieces,
    prepare,
    batch: async (statements) => Promise.all(statements.map((s) => s.run())),
  };
}

function fakeR2() {
  const objects = new Map();
  return {
    objects,
    async put(key, body) {
      const bytes = Buffer.from(typeof body?.getReader === 'function' ? await new Response(body).arrayBuffer() : body);
      objects.set(key, bytes);
      return { size: bytes.length };
    },
    async head(key) {
      return objects.has(key) ? { size: objects.get(key).length } : null;
    },
    async get(key, options = {}) {
      const bytes = objects.get(key);
      if (!bytes) return null;
      const { offset = 0, length = bytes.length - offset } = options.range || {};
      const slice = bytes.subarray(offset, offset + length);
      return { size: bytes.length, body: new Response(slice).body, arrayBuffer: async () => slice };
    },
    async delete(key) {
      objects.delete(key);
    },
  };
}

const videoFile = (name) => `${dataDir}/orgs/${'b'.repeat(24)}/media/${name}.mp4`;

test('the Workers backend keeps organisations in D1 and videos in R2', async () => {
  const db = fakeD1();
  const bucket = fakeR2();
  useStorage(cloudflareStorage({ db, bucket }));
  const accounts = await import('../src/accounts.js');
  const { runWithOrg } = await import('../src/context.js');
  const store = await import('../src/store.js');

  const org = await accounts.createOrg({ name: 'Edge', clerkId: 'org_edge', config: { XAI_API_KEY: 'xai-edge-secret' } });
  assert.equal((await accounts.orgForClerk({ clerkOrgId: 'org_edge', clerkUserId: 'user_lin', role: 'admin' })).id, org.id);
  assert.match(db.documents.get('system/orgs.json'), /org_edge/);

  const configRow = db.documents.get(`orgs/${org.id}/config.json`);
  assert.ok(configRow, 'organisation settings are a D1 row');
  assert.doesNotMatch(configRow, /xai-edge-secret/);
  assert.equal((await accounts.loadOrgConfig(org.id)).XAI_API_KEY, 'xai-edge-secret');

  await runWithOrg({ org: { id: org.id, name: org.name }, config: await accounts.loadOrgConfig(org.id), user: null, role: 'owner' }, async () => {
    const video = randomBytes(5000);
    const media = await store.createMedia({ buffer: video, name: 'clip.mp4', mime: 'video/mp4', source: 'upload' });
    assert.equal(bucket.objects.get(`orgs/${org.id}/media/${media.file}`).length, 5000);
    assert.equal(db.pieces.size, 0, 'videos stay out of D1 when R2 is bound');
    const file = store.mediaPath(await store.getMedia(media.id));
    assert.deepEqual(await readBlobRange(file, 100, 199), video.subarray(100, 200));

    await store.writeNetworkToken('slack', { access_token: 'xoxb-edge' });
    assert.doesNotMatch(db.documents.get(`orgs/${org.id}/token-slack.json`), /xoxb-edge/);
    assert.equal((await store.readNetworkToken('slack')).access_token, 'xoxb-edge');
    await store.clearNetworkToken('slack');
    assert.equal(await store.readNetworkToken('slack'), null);
  });
});

test('without R2, videos are split into D1 rows and the oldest make room', async () => {
  const db = fakeD1();
  const storage = cloudflareStorage({ db, maxVideoMb: 5, budgetMb: 7 });
  useStorage(storage);

  const first = randomBytes(3_500_000);
  assert.equal(await writeBlob(videoFile('first'), first, { mime: 'video/mp4' }), first.length);
  assert.equal(db.pieces.size, 3, '3.5 MB is three 1.4 MB pieces');
  for (const data of db.pieces.values()) assert.ok(data.length < 2_000_000, 'each row stays under the D1 row limit');
  assert.equal(await blobSize(videoFile('first')), first.length);
  assert.deepEqual(await readBlobRange(videoFile('first'), 1_399_990, 1_400_009), first.subarray(1_399_990, 1_400_010));
  assert.deepEqual(await readBlobRange(videoFile('first'), 0, first.length - 1), first);

  const streamed = randomBytes(3_000_000);
  const body = new Response(streamed).body;
  await writeBlob(videoFile('second'), body, { mime: 'video/mp4', size: streamed.length });
  const whole = Buffer.from(await new Response(await storage.blobBody(storageKey(videoFile('second')))).arrayBuffer());
  assert.deepEqual(whole, streamed);
  const part = Buffer.from(await new Response(await storage.blobBody(storageKey(videoFile('second')), { start: 1_000_000, end: 2_999_999 })).arrayBuffer());
  assert.deepEqual(part, streamed.subarray(1_000_000));

  await writeBlob(videoFile('third'), randomBytes(2_000_000), { mime: 'video/mp4' });
  assert.equal(await blobSize(videoFile('first')), null, 'the oldest video was removed to stay inside 7 MB');
  assert.equal(await blobSize(videoFile('second')), streamed.length);
  await assert.rejects(readBlobRange(videoFile('first'), 0, 9), /no longer stored/);

  await assert.rejects(writeBlob(videoFile('huge'), new Response(randomBytes(6 * 1024 * 1024)).body, { mime: 'video/mp4' }), /5 MB or smaller/);
  assert.equal(await blobSize(videoFile('huge')), null);
  assert.ok(![...db.pieces.keys()].some((id) => id.includes('huge')), 'a rejected upload leaves no pieces behind');
});
