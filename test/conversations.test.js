import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'socialbrewery-conversations-'));
process.env.SOCIALBREWERY_HOME = temp;

const accounts = await import('../src/accounts.js');
const { runWithOrg } = await import('../src/context.js');
const { brewChatFile, ensureData, listPosts, loadHistory, saveHistory } = await import('../src/store.js');
const { runAgent } = await import('../src/agent.js');
const { deleteConversation, getConversation, listConversations, loadExtensionRuns, mergeExtensionRuns } = await import('../src/extension.js');
await ensureData();

function mockOpenAI(replies) {
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', refusal: null, ...replies.shift() }, finish_reason: 'stop' }] }), { status: 200 });
  };
  return requests;
}

const org = await accounts.createOrg({ name: 'Chats', config: { AGENT_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-org' } });
const ctxFor = async (userId) => ({ org, config: await accounts.loadOrgConfig(org.id), user: { id: userId }, role: 'admin' });
const asUser = async (userId, fn) => runWithOrg(await ctxFor(userId), fn);
const say = (userId, text, chat) => asUser(userId, () => runAgent({ text, send: () => {}, chat: { userId, ...chat } }));

test('Brew chats are per person, listed with extension runs, and shared with the extension', async () => {
  mockOpenAI([{ content: 'Drafted.' }, { content: 'Posted.' }]);
  await say('user_ada', 'Write a LinkedIn post about our launch', { id: 'chat-1' });
  await say('user_ada', 'Now post it', { id: 'chat-1' });

  const chat = await asUser('user_ada', () => getConversation('user_ada', 'chat-1'));
  assert.equal(chat.source, 'dashboard');
  assert.equal(chat.continues, true);
  assert.deepEqual(chat.display.map((i) => i.content), ['Write a LinkedIn post about our launch', 'Drafted.', 'Now post it', 'Posted.']);

  // The extension pulls the same list (GET /api/extension/runs) and sees the Brew chat as a run.
  const { runs } = await asUser('user_ada', () => loadExtensionRuns('user_ada'));
  const summary = runs.find((r) => r.id === 'chat-1');
  assert.equal(summary.source, 'dashboard');
  assert.equal(summary.status, 'done');
  assert.equal(summary.title, 'Write a LinkedIn post about our launch');
  assert.deepEqual(summary.steps.map((s) => s.kind), ['user', 'assistant', 'user', 'assistant']);

  // An extension run shows up in the dashboard list, read-only there.
  const extRun = { id: 'run-x', title: 'Reddit research', provider: 'claude', status: 'done', createdAt: 1, updatedAt: Date.now() + 1000, steps: [{ kind: 'user', text: 'Find leads', at: 1 }, { kind: 'action', text: 'Opened reddit.com', at: 2 }, { kind: 'approval', text: 'Click Post', at: 3, approved: false }], posts: [] };
  await asUser('user_ada', () => mergeExtensionRuns('user_ada', { runs: [extRun] }));
  const list = await asUser('user_ada', () => listConversations('user_ada'));
  assert.deepEqual(list.map((c) => [c.id, c.source]), [['run-x', 'extension'], ['chat-1', 'dashboard']]);
  const ext = await asUser('user_ada', () => getConversation('user_ada', 'run-x'));
  assert.equal(ext.continues, false);
  assert.deepEqual(ext.display.map((i) => [i.role, i.tool, i.content]), [
    ['user', undefined, 'Find leads'],
    ['tool', 'browser_action', 'Opened reddit.com'],
    ['tool', 'browser_approval', 'Declined: Click Post'],
  ]);

  // Someone else in the organisation sees none of it.
  assert.deepEqual(await asUser('user_bob', () => listConversations('user_bob')), []);
  assert.equal(await asUser('user_bob', () => getConversation('user_bob', 'chat-1')), null);
});

test('A new Brew chat can start from an extension run, and Brew chats coming back from a browser add no posts', async () => {
  const requests = mockOpenAI([{ content: 'Picking up from there.' }]);
  const { conversationTranscript } = await import('../src/extension.js');
  const resume = await asUser('user_ada', () => conversationTranscript('user_ada', 'run-x'));
  assert.match(resume, /User: Find leads/);
  await say('user_ada', 'Continue', { id: 'chat-2', resume });
  const first = requests[0].messages.find((m) => m.role === 'user');
  assert.match(first.content, /<earlier>\nUser: Find leads[\s\S]*<\/earlier>\n\nContinue/);

  // The extension pushes a pulled Brew chat back unchanged, with a post in it: nothing new in Posts.
  const before = (await asUser('user_ada', () => listPosts())).length;
  const { runs } = await asUser('user_ada', () => loadExtensionRuns('user_ada'));
  const pulled = runs.find((r) => r.id === 'chat-2');
  await asUser('user_ada', () => mergeExtensionRuns('user_ada', { runs: [{ ...pulled, posts: [{ network: 'LinkedIn', url: 'https://www.linkedin.com/feed/update/1', title: 'x', at: 1 }] }] }));
  assert.equal((await asUser('user_ada', () => listPosts())).length, before);
});

test('Deleting a conversation removes it everywhere, including the Brew chat itself', async () => {
  await asUser('user_ada', () => deleteConversation('user_ada', 'chat-1'));
  const list = await asUser('user_ada', () => listConversations('user_ada'));
  assert.ok(!list.some((c) => c.id === 'chat-1'));
  assert.deepEqual((await asUser('user_ada', () => loadHistory(brewChatFile('user_ada', 'chat-1')))).display, []);
  assert.ok((await asUser('user_ada', () => loadExtensionRuns('user_ada'))).deleted.includes('chat-1'));

  // Deleted in the extension (PUT with deleted ids): the Brew chat file goes too.
  await asUser('user_ada', () => mergeExtensionRuns('user_ada', { runs: [], deleted: ['chat-2'] }));
  assert.deepEqual((await asUser('user_ada', () => loadHistory(brewChatFile('user_ada', 'chat-2')))).display, []);
});

test('The organisation’s older shared Brew chat is listed last and can only be continued as a new chat', async () => {
  await asUser('user_ada', () => saveHistory({ display: [{ id: 'a', role: 'user', content: 'Old question', at: '2026-01-01T00:00:00Z' }], model: [] }));
  const list = await asUser('user_ada', () => listConversations('user_ada'));
  assert.equal(list.at(-1).id, 'shared');
  const shared = await asUser('user_ada', () => getConversation('user_ada', 'shared'));
  assert.equal(shared.continues, false);
  assert.equal(shared.display[0].content, 'Old question');
});
