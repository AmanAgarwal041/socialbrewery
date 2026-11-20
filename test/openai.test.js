import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'socialbrewery-openai-'));
process.env.SOCIALBREWERY_HOME = temp;

const accounts = await import('../src/accounts.js');
const { runWithOrg } = await import('../src/context.js');
const { ensureData, loadHistory } = await import('../src/store.js');
const { agentProvider, agentsReady, runAgent } = await import('../src/agent.js');
const { normalizeOrgSettings } = await import('../src/env.js');
await ensureData();

function mockOpenAI(replies) {
  const requests = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://api.openai.com/v1/chat/completions');
    requests.push({ headers: init.headers, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', refusal: null, ...replies.shift() }, finish_reason: 'stop' }] }), { status: 200 });
  };
  return requests;
}

async function orgCtx(config) {
  const org = await accounts.createOrg({ name: 'OpenAI org', config });
  return { org, config: await accounts.loadOrgConfig(org.id), user: null, role: 'admin' };
}

test('OpenAI is an assistant choice for Brew and drafts', async () => {
  assert.equal(normalizeOrgSettings({ AGENT_PROVIDER: 'OpenAI' }).values.AGENT_PROVIDER, 'openai');
  const ctx = await orgCtx({ AGENT_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-org' });
  runWithOrg(ctx, () => {
    assert.equal(agentProvider(), 'openai');
    assert.equal(agentProvider('claude'), 'claude');
    assert.deepEqual(agentsReady(), { grok: false, claude: false, openai: true });
  });
});

test('Brew runs on OpenAI with tools, and tool results go back in OpenAI shape', async () => {
  const ctx = await orgCtx({ AGENT_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-org', OPENAI_MODEL: 'gpt-test' });
  const requests = mockOpenAI([
    { content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'unknown_tool', arguments: '{}' } }] },
    { content: 'Done.' },
  ]);
  const events = [];
  await runWithOrg(ctx, () => runAgent({ text: 'Post our launch', send: (e, d) => events.push([e, d]) }));

  assert.ok(events.some(([e, d]) => e === 'status' && d.text === 'OpenAI is thinking…'));
  const [first, second] = requests;
  assert.equal(first.headers.Authorization, 'Bearer sk-org');
  assert.equal(first.body.model, 'gpt-test');
  assert.equal(first.body.temperature, undefined);
  assert.ok(first.body.tools.some((t) => t.function.name === 'generate_short_video'), 'every assistant can make clips');
  assert.match(first.body.messages[0].content, /^You are OpenAI, the posting agent/);
  const tool = second.body.messages.find((m) => m.role === 'tool');
  assert.deepEqual(Object.keys(tool).sort(), ['content', 'role', 'tool_call_id']);
  assert.equal(tool.tool_call_id, 'call_1');
  assert.equal((await runWithOrg(ctx, () => loadHistory())).display.at(-1).content, 'Done.');
});

test('Brew asks for the OpenAI key when OpenAI is chosen without one', async () => {
  const ctx = await orgCtx({ AGENT_PROVIDER: 'openai', XAI_API_KEY: 'xai-only' });
  await assert.rejects(runWithOrg(ctx, () => runAgent({ text: 'Hi', send: () => {} })), /OpenAI API key/);
});
