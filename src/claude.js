import { cfg } from './context.js';

// Claude for Brew, drafts, and reviews, with the organisation's own Anthropic key. The server keeps
// zero npm dependencies, so this calls the Messages API over HTTP instead of through the SDK.
//
// Brew stores its history in the OpenAI-style shape Grok uses ({ role, content, tool_calls } and
// role: 'tool' results). This converts that history for Claude and returns Claude's reply in the same
// shape, with Claude's raw content blocks kept in `_claude`. Claude's thinking blocks are only valid in
// the conversation that produced them, and Brew trims old turns, so thinking is replayed only for the
// current request (after its last user message); earlier blocks are dropped, which the API allows
// because they form a leading run.

const API = 'https://api.anthropic.com/v1/messages';
// Server-side refusal fallback is available on these models.
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-opus-5']);

function apiKey() {
  const key = cfg.ANTHROPIC_API_KEY;
  if (!key) throw new Error('Add your Anthropic API key in Settings (an organisation admin can do this).');
  return key;
}

function parseArgs(raw) {
  if (raw && typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

// Tool ids from Grok turns may contain characters Claude rejects; map them consistently.
const safeId = (id) => String(id || 'call').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'call';

function toClaude(messages) {
  const system = messages.filter((m) => m.role === 'system').map((m) => String(m.content || '')).join('\n\n');
  const rest = messages.filter((m) => m.role !== 'system');
  let lastUser = -1;
  rest.forEach((m, i) => {
    if (m.role === 'user') lastUser = i;
  });

  const out = [];
  let results = [];
  const flush = () => {
    if (results.length) out.push({ role: 'user', content: results });
    results = [];
  };
  rest.forEach((m, i) => {
    if (m.role === 'tool') {
      results.push({ type: 'tool_result', tool_use_id: safeId(m.tool_call_id), content: String(m.content ?? '') });
      return;
    }
    flush();
    if (m.role === 'user') {
      out.push({ role: 'user', content: String(m.content ?? '') });
      return;
    }
    // Assistant turn.
    const current = i > lastUser;
    let blocks;
    if (Array.isArray(m._claude)) {
      blocks = current ? m._claude : m._claude.filter((b) => b.type !== 'thinking' && b.type !== 'redacted_thinking');
    } else {
      blocks = [];
      if (m.content) blocks.push({ type: 'text', text: String(m.content) });
      for (const call of m.tool_calls || []) {
        blocks.push({ type: 'tool_use', id: safeId(call.id), name: call.function?.name || '', input: parseArgs(call.function?.arguments) });
      }
    }
    if (blocks.length) out.push({ role: 'assistant', content: blocks });
  });
  flush();
  return { system, messages: out };
}

function toolsForClaude(tools = []) {
  return tools.map((t) => ({ name: t.function.name, description: t.function.description || '', input_schema: t.function.parameters || { type: 'object', properties: {} } }));
}

export async function claudeChat({ messages, tools }) {
  const model = cfg.CLAUDE_MODEL || 'claude-opus-5-5';
  const haiku = model.startsWith('claude-haiku');
  const converted = toClaude(messages);
  const body = {
    model,
    max_tokens: 16000,
    system: converted.system || undefined,
    messages: converted.messages,
    ...(tools?.length ? { tools: toolsForClaude(tools) } : {}),
    // Caches the growing conversation between steps.
    cache_control: { type: 'ephemeral' },
    ...(haiku
      ? {}
      : {
          // Medium effort: Brew's steps are short tool calls; drop rather than fail on a stale thinking block.
          thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } },
          output_config: { effort: 'medium' },
        }),
    ...(FALLBACK_MODELS.has(model) ? { fallbacks: 'default' } : {}),
  };
  const betas = [...(FALLBACK_MODELS.has(model) ? ['server-side-fallback-2026-07-01'] : []), ...(haiku ? [] : ['thinking-binding-controls-2026-08-01'])];
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey(),
      'anthropic-version': '2023-06-01',
      ...(betas.length ? { 'anthropic-beta': betas.join(',') } : {}),
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: { message: text.slice(0, 400) } };
  }
  if (!res.ok) throw new Error(data.error?.message || `Claude request failed (${res.status}).`);
  if (data.stop_reason === 'refusal') throw new Error('Claude declined this request.');

  const content = Array.isArray(data.content) ? data.content : [];
  const reply = content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  const toolCalls = content
    .filter((b) => b.type === 'tool_use')
    .map((b) => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input || {}) } }));
  return { role: 'assistant', content: reply || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}), _claude: content };
}

export const __test = { toClaude };
