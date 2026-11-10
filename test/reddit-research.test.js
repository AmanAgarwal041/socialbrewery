import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'socialbrewery-reddit-research-'));
process.env.SOCIALBREWERY_HOME = temp;
process.env.APP_URL = 'https://brew.example.com';

const research = await import('../src/reddit-research.js');
const skills = await import('../src/reddit-skills.js');
const accounts = await import('../src/accounts.js');
const { handleRpc } = await import('../src/mcp.js');
const { runWithOrg } = await import('../src/context.js');
const { ensureData, writeNetworkToken } = await import('../src/store.js');
await ensureData();

async function inNewOrg(config, fn) {
  const org = await accounts.createOrg({ name: 'Acme', config });
  return runWithOrg({ org: { id: org.id, name: org.name }, config: await accounts.loadOrgConfig(org.id), user: null, role: 'admin' }, () => fn(org));
}

test('intent signals label buying intent and ignore plain chatter', () => {
  assert.deepEqual(skills.intentSignals('Looking for an alternative to Hootsuite, it is too expensive'), ['asks for a recommendation', 'wants an alternative', 'has a pain point']);
  assert.deepEqual(skills.intentSignals('Look at my cat'), []);
  assert.match(skills.redditSkill('skills://reddit-lead-research').text, /Never send direct messages/);
  assert.throws(() => skills.redditSkill('nope'), /No skill/);
});

test('leads are validated, deduplicated by user and post, and never move back to new', async () => {
  await inNewOrg({}, async () => {
    assert.equal(research.cleanLead({ username: '[deleted]' }), null);
    const first = await research.saveRedditLeads(
      [
        { username: 'u/ada_dev', postUrl: 'https://old.reddit.com/r/selfhosted/comments/abc123/need_a_tool/?utm=x', postTitle: 'Any tool for this?', fit: 'high', reason: 'Asked for exactly this.' },
        { username: 'bob', postUrl: 'javascript:alert(1)', reason: 'x' },
      ],
      'agent',
    );
    assert.equal(first.added, 2);
    const [ada] = first.leads;
    assert.equal(ada.username, 'ada_dev');
    assert.equal(ada.subreddit, 'selfhosted');
    assert.equal(ada.postUrl, 'https://www.reddit.com/r/selfhosted/comments/abc123/need_a_tool/');
    assert.deepEqual(ada.signals, ['asks for a recommendation']);
    assert.equal(first.leads[1].postUrl, '');

    await research.updateRedditLead(ada.id, { status: 'engaged', notes: 'Replied' });
    const again = await research.saveRedditLeads({ username: 'ADA_dev', postUrl: 'https://www.reddit.com/r/selfhosted/comments/abc123/', reason: 'Still a fit.' }, 'extension');
    assert.equal(again.added, 0);
    assert.equal(again.updated, 1);
    const [saved] = await research.listRedditLeads({ subreddit: 'r/selfhosted' });
    assert.equal(saved.status, 'engaged');
    assert.equal(saved.notes, 'Replied');
    assert.equal(saved.reason, 'Still a fit.');
    assert.equal(saved.source, 'agent');

    // An older copy from another device does not overwrite a newer change.
    await research.saveRedditLeads({ username: 'ada_dev', postUrl: saved.postUrl, reason: 'stale', updatedAt: 1 }, 'extension');
    assert.equal((await research.listRedditLeads({ subreddit: 'selfhosted' }))[0].reason, 'Still a fit.');

    await assert.rejects(research.updateRedditLead(ada.id, { status: 'spammed' }), /Status must be/);
    await research.deleteRedditLead(ada.id);
    assert.equal((await research.listRedditLeads()).length, 1);
  });
});

test('without Reddit keys, research returns Reddit links instead of reading', async () => {
  await inNewOrg({}, async () => {
    const result = await research.searchReddit({ query: 'alternative to buffer', subreddit: 'r/socialmedia', sort: 'new' });
    assert.equal(result.manual, true);
    assert.equal(result.searchUrl, 'https://www.reddit.com/r/socialmedia/search/?q=alternative+to+buffer&sort=new&t=month&restrict_sr=on');
    assert.equal((await research.researchRedditUser({ username: 'u/spez' })).url, 'https://www.reddit.com/user/spez/');
  });
});

test('search goes through the connected account and ranks posts with intent first', async () => {
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(new URL(String(url)));
    const post = (id, title, author = 'someone') => ({ kind: 't3', data: { name: `t3_${id}`, id, title, author, subreddit: 'devops', permalink: `/r/devops/comments/${id}/x/`, selftext: '', score: 3, num_comments: 1, created_utc: 1_760_000_000 } });
    return new Response(JSON.stringify({ data: { children: [post('aaa', 'My weekend homelab'), post('bbb', 'Looking for a tool to schedule posts'), post('ccc', 'gone', '[deleted]')] } }), { status: 200 });
  };
  try {
    await inNewOrg({ REDDIT_CLIENT_ID: 'id', REDDIT_CLIENT_SECRET: 'secret' }, async () => {
      await writeNetworkToken('reddit', { access_token: 'tok', refresh_token: 'r', expires_at: Date.now() + 3_600_000, account: { username: 'me' } });
      const result = await research.searchReddit({ query: 'schedule posts', subreddit: 'devops' });
      assert.equal(calls[0].origin + calls[0].pathname, 'https://oauth.reddit.com/r/devops/search');
      assert.equal(calls[0].searchParams.get('restrict_sr'), 'true');
      assert.deepEqual(result.posts.map((p) => p.id), ['t3_bbb', 't3_aaa', 't3_ccc']);
      assert.equal(result.posts[2].author, '');
    });
  } finally {
    globalThis.fetch = previous;
  }
});

test('connector lists research tools, skill resources, and lead prompts', async () => {
  const tools = (await handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).result.tools.map((t) => t.name);
  for (const name of ['search_reddit', 'research_reddit_user', 'save_reddit_leads', 'get_research_skill']) assert.ok(tools.includes(name), name);
  const resources = (await handleRpc({ jsonrpc: '2.0', id: 2, method: 'resources/list' })).result.resources.map((r) => r.uri);
  assert.ok(resources.includes('skills://reddit-user-research'));
  const read = await handleRpc({ jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: 'skills://reddit-lead-research' } });
  assert.match(read.result.contents[0].text, /# Reddit lead research/);
  const prompt = await handleRpc({ jsonrpc: '2.0', id: 4, method: 'prompts/get', params: { name: 'find_reddit_leads', arguments: { offer: 'Schedules social posts' } } });
  assert.match(prompt.result.messages[0].content.text, /What the product does, in plain words: Schedules social posts/);
});
