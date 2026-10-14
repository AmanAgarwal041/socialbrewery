import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

process.env.SOCIALBREWERY_MASTER_KEY = randomBytes(32).toString('base64');

const { useStorage, blobSize, readBlobRange } = await import('../src/storage.js');
const { cloudflareStorage } = await import('../worker/storage.js');

// Just enough of D1 and R2 to run the store against the Workers backend.
function fakeD1() {
  const rows = new Map();
  return {
    rows,
    prepare(sql) {
      let args = [];
      return {
        bind(...values) {
          args = values;
          return this;
        },
        async first(column) {
          assert.match(sql, /^SELECT value FROM documents WHERE key = \?$/);
          return rows.has(args[0]) ? { value: rows.get(args[0]) }[column] : null;
        },
        async run() {
          if (sql.startsWith('INSERT')) rows.set(args[0], args[1]);
          if (sql.startsWith('DELETE')) rows.delete(args[0]);
          return { success: true };
        },
      };
    },
  };
}

function fakeR2() {
  const objects = new Map();
  return {
    objects,
    async put(key, body) {
      const bytes = Buffer.from(body instanceof ReadableStream ? await new Response(body).arrayBuffer() : body);
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

test('the Workers backend keeps accounts in D1 and videos in R2', async () => {
  const db = fakeD1();
  const bucket = fakeR2();
  useStorage(cloudflareStorage({ db, bucket }));
  const accounts = await import('../src/accounts.js');
  const { runWithOrg } = await import('../src/context.js');
  const store = await import('../src/store.js');

  const owner = await accounts.upsertUser({ provider: 'github', subject: '9', email: 'lin@example.com', name: 'Lin' });
  const org = await accounts.createOrg({ name: 'Edge', ownerId: owner.id, config: { XAI_API_KEY: 'xai-edge-secret' } });
  const session = await accounts.createSession(owner.id, org.id);
  assert.equal((await accounts.getSession(session.token)).userId, owner.id);

  const configRow = db.rows.get(`orgs/${org.id}/config.json`);
  assert.ok(configRow, 'organisation settings are a D1 row');
  assert.doesNotMatch(configRow, /xai-edge-secret/);
  assert.equal((await accounts.loadOrgConfig(org.id)).XAI_API_KEY, 'xai-edge-secret');
  assert.ok(db.rows.has('system/users.json'));

  await runWithOrg({ org: { id: org.id, name: org.name }, config: await accounts.loadOrgConfig(org.id), user: null, role: 'owner' }, async () => {
    const video = randomBytes(5000);
    const media = await store.createMedia({ buffer: video, name: 'clip.mp4', mime: 'video/mp4', source: 'upload' });
    assert.equal(bucket.objects.get(`orgs/${org.id}/media/${media.file}`).length, 5000);
    const file = store.mediaPath(await store.getMedia(media.id));
    assert.equal(await blobSize(file), 5000);
    assert.deepEqual(await readBlobRange(file, 100, 199), video.subarray(100, 200));

    await store.writeNetworkToken('slack', { access_token: 'xoxb-edge' });
    assert.doesNotMatch(db.rows.get(`orgs/${org.id}/token-slack.json`), /xoxb-edge/);
    assert.equal((await store.readNetworkToken('slack')).access_token, 'xoxb-edge');
    await store.clearNetworkToken('slack');
    assert.equal(await store.readNetworkToken('slack'), null);
  });
});
