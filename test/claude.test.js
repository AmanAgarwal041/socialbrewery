import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'socialbrewery-claude-'));
process.env.SOCIALBREWERY_HOME = temp;

const { __test, claudeChat } = await import('../src/claude.js');
const accounts = await import('../src/accounts.js');
const { runWithOrg } = await import('../src/context.js');
const { ensureData, loadHistory } = await import('../src/store.js');
const { runAgent } = await import('../src/agent.js');
await ensureData();

const thinking = (text) => ({ type: 'thinking', thinking: '', signature: `sig-${text}` });

test('Brew history converts for Claude, replaying thinking only for the current request', () => {
  const { system, messages } = __test.toClaude([
    { role: 'system', content: 'Be brief.' },
    { role: 'user', content: 'Earlier ask' },
    { role: 'assistant', content: 'Earlier answer', _claude: [thinking('old'), { type: 'text', text: 'Earlier answer' }] },
    { role: 'user', content: 'Post to Slack' },
    // A Grok turn in the same history: OpenAI-style tool calls become tool_use blocks.
    { role: 'assistant', content: null, tool_calls: [{ id: 'call:1', type: 'function', function: { name: 'list_slack_channels', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'call:1', name: 'list_slack_channels', content: '{"channels":[]}' },
    { role: 'assistant', content: null, _claude: [thinking('now'), { type: 'tool_use', id: 'toolu_1', name: 'post_slack', input: { text: 'hi' } }] },
    { role: 'tool', tool_call_id: 'toolu_1', name: 'post_slack', content: '{"ok":true}' },
  ]);
  assert.equal(system, 'Be brief.');
  assert.deepEqual(messages.map((m) => m.role), ['user', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user']);
  assert.deepEqual(messages[1].content, [{ type: 'text', text: 'Earlier answer' }], 'thinking from an earlier request is dropped');
  assert.deepEqual(messages[3].content, [{ type: 'tool_use', id: 'call_1', name: 'list_slack_channels', input: {} }]);
  assert.deepEqual(messages[4].content, [{ type: 'tool_result', tool_use_id: 'call_1', content: '{"channels":[]}' }]);
  assert.equal(messages[5].content[0].signature, 'sig-now', 'thinking from the current request is replayed unchanged');
  assert.equal(messages[6].content[0].tool_use_id, 'toolu_1');
});

function mockClaude(replies) {
  const requests = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://api.anthropic.com/v1/messages');
    requests.push({ headers: init.headers, body: JSON.parse(init.body) });
    const reply = replies.shift();
    return new Response(JSON.stringify({ id: 'msg', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: {}, ...reply }), { status: 200 });
  };
  return requests;
}

test('claudeChat sends the organisation key, adaptive thinking, and the default fallback', async () => {
  const org = await accounts.createOrg({ name: 'C', config: { ANTHROPIC_API_KEY: 'sk-ant-org' } });
  const requests = mockClaude([{ content: [thinking('t'), { type: 'text', text: 'Which channel?' }, { type: 'tool_use', id: 'toolu_9', name: 'list_slack_channels', input: {} }], stop_reason: 'tool_use' }]);
  const tools = [{ type: 'function', function: { name: 'list_slack_channels', description: 'Channels', parameters: { type: 'object', properties: {} } } }];
  const reply = await runWithOrg({ org, config: await accounts.loadOrgConfig(org.id), user: null, role: 'admin' }, () =>
    claudeChat({ messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'Hi' }], tools }),
  );
  const [{ headers, body }] = requests;
  assert.equal(headers['x-api-key'], 'sk-ant-org');
  assert.equal(headers['anthropic-version'], '2023-06-01');
  assert.equal(headers['anthropic-beta'], 'server-side-fallback-2026-07-01,thinking-binding-controls-2026-08-01');
  assert.equal(body.model, 'claude-opus-5-5');
  assert.deepEqual(body.thinking, { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } });
  assert.deepEqual(body.output_config, { effort: 'medium' });
  assert.equal(body.fallbacks, 'default');
  assert.equal(body.system, 'S');
  assert.deepEqual(body.tools, [{ name: 'list_slack_channels', description: 'Channels', input_schema: { type: 'object', properties: {} } }]);
  assert.equal(reply.content, 'Which channel?');
  assert.equal(reply.tool_calls[0].function.name, 'list_slack_channels');
  assert.equal(reply._claude.length, 3);
});

test('Brew runs on Claude when the organisation picks it', async () => {
  const org = await accounts.createOrg({ name: 'Brew', config: { AGENT_PROVIDER: 'claude', ANTHROPIC_API_KEY: 'sk-ant-brew' } });
  const ctx = { org, config: await accounts.loadOrgConfig(org.id), user: null, role: 'admin' };
  const requests = mockClaude([
    { content: [thinking('first'), { type: 'text', text: 'Which network?' }] },
    { content: [thinking('second'), { type: 'text', text: 'LinkedIn it is.' }] },
  ]);
  const events = [];
  const send = (event, data) => events.push([event, data]);
  await runWithOrg(ctx, () => runAgent({ text: 'Post our launch', send }));
  await runWithOrg(ctx, () => runAgent({ text: 'LinkedIn', send }));

  assert.ok(events.some(([e, d]) => e === 'status' && d.text === 'Claude is thinking…'));
  assert.deepEqual(events.filter(([e]) => e === 'message').map(([, d]) => d.content), ['Which network?', 'LinkedIn it is.']);
  assert.match(requests[0].body.system, /^You are Claude, the posting agent/);
  // The second request carries the first answer without its thinking block.
  const second = requests[1].body.messages;
  assert.deepEqual(second[1], { role: 'assistant', content: [{ type: 'text', text: 'Which network?' }] });
  const history = await runWithOrg(ctx, () => loadHistory());
  assert.equal(history.display.at(-1).content, 'LinkedIn it is.');
});

test('Brew asks for the Anthropic key when Claude is chosen without one', async () => {
  const org = await accounts.createOrg({ name: 'NoKey', config: { AGENT_PROVIDER: 'claude', XAI_API_KEY: 'xai-only' } });
  const ctx = { org, config: await accounts.loadOrgConfig(org.id), user: null, role: 'admin' };
  await assert.rejects(runWithOrg(ctx, () => runAgent({ text: 'Hi', send: () => {} })), /Anthropic API key/);
});

test.after(() => fs.rm(temp, { recursive: true, force: true }));
