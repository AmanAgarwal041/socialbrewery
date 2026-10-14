import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

process.env.SOCIALBREWERY_MASTER_KEY = randomBytes(32).toString('base64');

const { useStorage } = await import('../src/storage.js');
const docs = new Map();
useStorage({
  kind: 'memory',
  async readText(key) { return docs.get(key) ?? null; },
  async writeText(key, text) { docs.set(key, text); },
  async remove(key) { docs.delete(key); },
});
const { runWithOrg } = await import('../src/context.js');
const { writeNetworkToken } = await import('../src/store.js');
const { postToLinkedIn } = await import('../src/actions.js');

const inOrg = (fn) => runWithOrg({ org: { id: 'c'.repeat(24), name: 'Test' }, config: {}, user: null, role: 'owner' }, fn);

async function withFetch(handler, fn) {
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const call = { url: String(url), method: init.method || 'GET', body: init.body, redirect: init.redirect };
    calls.push(call);
    return handler(call);
  };
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = previous;
  }
}

const connect = () =>
  writeNetworkToken('linkedin', { access_token: 'li-token', expires_at: Date.now() + 3_600_000, profile: { urn: 'urn:li:person:abc' } });

const posted = (calls) => JSON.parse(calls.find((c) => c.url === 'https://api.linkedin.com/rest/posts').body);

test('LinkedIn link posts become article cards with an uploaded thumbnail', async () => {
  await inOrg(async () => {
    await connect();
    await withFetch((call) => {
      if (call.url === 'https://93.184.216.34/card.png') return new Response(Buffer.alloc(64, 7), { headers: { 'content-type': 'image/png' } });
      if (call.url.includes('/rest/images?action=initializeUpload')) {
        return Response.json({ value: { uploadUrl: 'https://upload.example/img', image: 'urn:li:image:42' } });
      }
      if (call.url === 'https://upload.example/img') return new Response(null, { status: 201 });
      if (call.url === 'https://api.linkedin.com/rest/posts') return new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:1' } });
      throw new Error(`Unexpected URL ${call.url}`);
    }, async (calls) => {
      const result = await postToLinkedIn({
        commentary: 'Our launch video',
        linkUrl: 'https://example.com/launch',
        linkTitle: 'Launch',
        linkDescription: 'Two minutes on what shipped',
        linkThumbnailUrl: 'https://93.184.216.34/card.png',
      });
      assert.equal(result.link, 'https://example.com/launch');
      assert.equal(result.thumbnailError, undefined);
      assert.equal(calls[0].redirect, 'manual', 'thumbnail fetches follow redirects only after checking them');
      assert.deepEqual(posted(calls).content, {
        article: {
          source: 'https://example.com/launch',
          title: 'Launch',
          description: 'Two minutes on what shipped',
          thumbnail: 'urn:li:image:42',
        },
      });
    });
  });
});

test('LinkedIn thumbnails on private addresses are refused but the card still posts', async () => {
  await inOrg(async () => {
    await connect();
    for (const thumbnail of ['http://93.184.216.34/a.png', 'https://127.0.0.1/a.png', 'https://169.254.169.254/latest/meta-data', 'https://localhost/a.png']) {
      await withFetch((call) => {
        if (call.url === 'https://api.linkedin.com/rest/posts') return new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:2' } });
        throw new Error(`The server fetched ${call.url}`);
      }, async (calls) => {
        const result = await postToLinkedIn({ commentary: 'Read this', linkUrl: 'https://example.com/post', linkThumbnailUrl: thumbnail });
        assert.match(result.thumbnailError, /without a thumbnail/);
        assert.equal(calls.length, 1, `only the post was sent for ${thumbnail}`);
        assert.equal(posted(calls).content.article.thumbnail, undefined);
      });
    }
  });
});

test('LinkedIn thumbnail redirects to private addresses are refused', async () => {
  await inOrg(async () => {
    await connect();
    await withFetch((call) => {
      if (call.url === 'https://93.184.216.34/r.png') return new Response(null, { status: 302, headers: { location: 'https://10.0.0.5/secret.png' } });
      if (call.url === 'https://api.linkedin.com/rest/posts') return new Response(null, { status: 201 });
      throw new Error(`The server fetched ${call.url}`);
    }, async () => {
      const result = await postToLinkedIn({ commentary: 'Hi', linkUrl: 'https://example.com', linkThumbnailUrl: 'https://93.184.216.34/r.png' });
      assert.match(result.thumbnailError, /public address/);
    });
  });
});

test('LinkedIn link cards need an http(s) link', async () => {
  await inOrg(async () => {
    await connect();
    await assert.rejects(postToLinkedIn({ commentary: 'x', linkUrl: 'javascript:alert(1)' }), /http or https/);
    await assert.rejects(postToLinkedIn({ commentary: 'x', linkUrl: 'not a url' }), /not a valid URL/);
  });
});
