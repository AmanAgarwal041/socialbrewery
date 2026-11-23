import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'socialbrewery-devto-'));
process.env.SOCIALBREWERY_HOME = temp;
process.env.APP_URL = 'https://brew.example.com';

const devto = await import('../src/devto.js');
const accounts = await import('../src/accounts.js');
const { postToDevto } = await import('../src/actions.js');
const { MCP_TOOLS } = await import('../src/mcp.js');
const { runWithOrg } = await import('../src/context.js');
const { ensureData, listPosts } = await import('../src/store.js');
await ensureData();

async function inNewOrg(config, fn) {
  const org = await accounts.createOrg({ name: 'Acme', config });
  return runWithOrg({ org: { id: org.id, name: org.name }, config: await accounts.loadOrgConfig(org.id), user: null, role: 'admin' }, () => fn(org));
}

/** Answers DEV API calls from a table of `METHOD /path` → body, and records every request. */
function fakeDev(routes) {
  const calls = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const key = `${init.method || 'GET'} ${u.pathname}`;
    calls.push({ key, url: String(url), headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
    const route = routes[key];
    if (!route) return new Response(JSON.stringify({ error: 'not found', status: 404 }), { status: 404 });
    const [status, body] = Array.isArray(route) ? route : [200, route];
    return new Response(JSON.stringify(body), { status });
  };
  return { calls, restore: () => (globalThis.fetch = previous) };
}

test('DEV tags are lowercase alphanumeric, deduped, and capped at four', () => {
  assert.deepEqual(devto.devtoTags('AI Agents, #JavaScript, ai-agents, node.js'), ['aiagents', 'javascript', 'nodejs']);
  assert.equal(devto.devtoTags(['a', 'b', 'c', 'd', 'e']).length, 4);
  assert.deepEqual(devto.devtoTags(''), []);
});

test('DEV calls send the key, the v1 Accept header and a User-Agent, and explain failures', async () => {
  await inNewOrg({ DEVTO_API_KEY: 'dev-key' }, async () => {
    const fake = fakeDev({ 'GET /api/users/me': [401, { error: 'unauthorized', status: 401 }] });
    try {
      await assert.rejects(devto.devtoApi('/users/me'), /rejected the API key/);
      const { headers } = fake.calls[0];
      assert.equal(headers['api-key'], 'dev-key');
      assert.equal(headers.Accept, 'application/vnd.forem.api-v1+json');
      assert.ok(headers['User-Agent'], 'dev.to answers 403 without a User-Agent');
    } finally {
      fake.restore();
    }
    const limited = fakeDev({ 'GET /api/users/me': [429, { error: 'Rate limit reached', status: 429 }] });
    try {
      await assert.rejects(devto.devtoApi('/users/me'), (err) => err.status === 429 && /rate limiting/.test(err.message));
    } finally {
      limited.restore();
    }
  });
  await inNewOrg({}, async () => {
    await assert.rejects(devto.devtoApi('/users/me'), /Add your DEV API key/);
  });
});

test('connecting DEV, publishing a draft for an organisation, and listing stats', async () => {
  await inNewOrg({ DEVTO_API_KEY: 'dev-key', DEVTO_ORGANIZATION: 'https://dev.to/acme/' }, async () => {
    const fake = fakeDev({
      'GET /api/users/me': { id: 42, username: 'ana', name: 'Ana', profile_image: 'https://media2.dev.to/ana.png' },
      'GET /api/organizations/acme': { id: 7, username: 'acme', name: 'Acme Inc' },
      'POST /api/articles': [201, { id: 991, url: 'https://dev.to/acme/hello-world-temp-slug-1', slug: 'hello-world-temp-slug-1', published: false }],
      'GET /api/articles/me/all': [200, [
        { id: 991, title: 'Hello world', url: 'https://dev.to/acme/hello', description: 'Hi', published: true, published_at: '2026-11-20T10:00:00Z', page_views_count: 120, public_reactions_count: 9, comments_count: 2, reading_time_minutes: 4, cover_image: null, tag_list: ['ai', 'webdev'] },
      ]],
    });
    try {
      const account = await devto.connectDevto();
      assert.equal(account.username, 'ana');
      assert.deepEqual(account.organization, { id: 7, username: 'acme', name: 'Acme Inc', url: 'https://dev.to/acme' });
      assert.equal((await devto.devtoStatus()).connected, true);

      const result = await postToDevto({ title: 'Hello world', content: '## Intro\n\nHi.', tags: ['AI', 'Web Dev'], description: 'Hi', draft: true, source: 'agent' });
      assert.equal(result.draft, true);
      assert.equal(result.url, 'https://dev.to/acme/hello-world-temp-slug-1/edit');
      const sent = fake.calls.find((c) => c.key === 'POST /api/articles').body.article;
      assert.equal(sent.published, false);
      assert.equal(sent.organization_id, 7);
      assert.deepEqual(sent.tags, ['ai', 'webdev']);
      assert.equal(sent.ai_disclosure_level, 'some_ai', 'agent-written articles are disclosed');
      assert.equal(sent.body_markdown, '## Intro\n\nHi.');

      const saved = (await listPosts()).find((p) => p.network === 'devto');
      assert.equal(saved.devtoId, '991');
      assert.equal(saved.privacyStatus, 'draft');

      const [article] = await devto.listDevtoPosts(5);
      assert.equal(fake.calls.at(-1).url, 'https://dev.to/api/articles/me/all?per_page=5');
      assert.equal(article.views, 120);
      assert.equal(article.reactions, 9);
      assert.equal(article.comments, 2);
      assert.deepEqual(article.tags, ['ai', 'webdev']);
    } finally {
      fake.restore();
    }
  });
});

test('DEV manual posts are not disclosed unless a tier is chosen, and updates send only what changes', async () => {
  await inNewOrg({ DEVTO_API_KEY: 'dev-key' }, async () => {
    const fake = fakeDev({
      'GET /api/users/me': { id: 42, username: 'ana', name: 'Ana' },
      'POST /api/articles': [201, { id: 5, url: 'https://dev.to/ana/post-5', slug: 'post-5', published: true }],
      'PUT /api/articles/5': { id: 5, title: 'New title', url: 'https://dev.to/ana/post-5', published: false },
    });
    try {
      await devto.connectDevto();
      const post = await devto.publishDevto({ title: 'Post', content: 'Body', draft: false, aiDisclosure: 'made-up' });
      assert.equal(post.url, 'https://dev.to/ana/post-5');
      const sent = fake.calls.find((c) => c.key === 'POST /api/articles').body.article;
      assert.equal(sent.published, true);
      assert.equal('ai_disclosure_level' in sent, false);
      assert.equal('organization_id' in sent, false);

      const updated = await devto.updateDevto({ post: '5', title: 'New title', published: false });
      assert.deepEqual(fake.calls.at(-1).body, { article: { title: 'New title', published: false } });
      assert.equal(updated.published, false);
      await assert.rejects(devto.updateDevto({ post: 'abc', title: 'x' }), /article id/);
      await assert.rejects(devto.updateDevto({ post: '5' }), /what to change/);
    } finally {
      fake.restore();
    }
  });
});

test('the connector lists the DEV tools with the disclosure tiers', () => {
  const names = MCP_TOOLS.map((t) => t.name);
  for (const name of ['publish_devto_article', 'update_devto_article', 'list_devto_articles']) assert.ok(names.includes(name), name);
  const publish = MCP_TOOLS.find((t) => t.name === 'publish_devto_article');
  assert.deepEqual(publish.inputSchema.properties.aiDisclosure.enum, ['no_ai', 'some_ai', 'fully_autonomous']);
});

test('a post the extension records as DEV or dev.to lands in Posts as devto', async () => {
  const { mergeExtensionRuns } = await import('../src/extension.js');
  await inNewOrg({}, async () => {
    const run = (id, network, url) => ({
      id,
      title: 'DEV article',
      provider: 'claude',
      status: 'done',
      createdAt: 1,
      updatedAt: 10,
      steps: [{ kind: 'user', text: 'Publish it', at: 1 }],
      posts: [{ network, url, title: 'Article', at: 5 }],
    });
    await mergeExtensionRuns('user_ana', { runs: [run('run-a', 'DEV', 'https://dev.to/ana/one-1'), run('run-b', 'dev.to', 'https://dev.to/ana/two-2')] });
    const fromExtension = (await listPosts()).filter((p) => p.source === 'extension');
    assert.deepEqual(fromExtension.map((p) => p.network).sort(), ['devto', 'devto']);
  });
});
