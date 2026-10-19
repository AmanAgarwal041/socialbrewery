import test from 'node:test';
import assert from 'node:assert/strict';
import { analysisProvider } from '../src/analysis.js';
import { openaiChat } from '../src/openai.js';
import { runWithOrg } from '../src/context.js';

const inOrg = (config, fn) => runWithOrg({ org: { id: 'a'.repeat(24), name: 'Test' }, config, user: null, role: 'owner' }, fn);

test('analysis provider is grok, claude, or openai', () => {
  inOrg({}, () => {
    assert.equal(analysisProvider(), 'grok');
    assert.equal(analysisProvider('OpenAI'), 'openai');
    assert.equal(analysisProvider('Claude'), 'claude');
    assert.throws(() => analysisProvider('gemini'), /grok, claude, or openai/);
  });
  inOrg({ ANALYSIS_PROVIDER: 'openai' }, () => assert.equal(analysisProvider(), 'openai'));
});

test('openai analysis asks for an api key', async () => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'from-the-shell';
  try {
    await inOrg({}, () => assert.rejects(() => openaiChat({ messages: [] }), /OpenAI API key/));
  } finally {
    if (previous == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});
