import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeOrgSettings,
  normalizeSystem,
  orgDefaults,
  orgSettingsView,
  parseEnv,
  serializeEnv,
  systemDefaults,
} from '../src/env.js';

test('server settings round-trip through quotes and keep organisation keys out', () => {
  const values = { ...systemDefaults(), GITHUB_AUTH_CLIENT_SECRET: 'secret with "quotes"', BREW_LABEL: 'local batch' };
  const parsed = parseEnv(serializeEnv(values));
  assert.equal(parsed.GITHUB_AUTH_CLIENT_SECRET, 'secret with "quotes"');
  assert.equal(parsed.BREW_LABEL, 'local batch');
  assert.equal(parsed.PORT, '3847');
  assert.equal(parsed.HOST, '127.0.0.1');
  assert.equal(parsed.XAI_API_KEY, undefined);
});

test('a public host is allowed but warns without https', () => {
  const local = normalizeSystem(systemDefaults());
  assert.deepEqual(local.errors, []);
  assert.deepEqual(local.warnings, []);
  const open = normalizeSystem({ ...systemDefaults(), HOST: '0.0.0.0', APP_URL: 'http://example.com' });
  assert.deepEqual(open.errors, []);
  assert.equal(open.warnings.length, 1);
  const https = normalizeSystem({ ...systemDefaults(), HOST: '0.0.0.0', APP_URL: 'https://brew.example.com' });
  assert.deepEqual(https.warnings, []);
  assert.ok(normalizeSystem({ PORT: '99999' }).errors.length);
});

test('organisation settings keep secrets write-only', () => {
  const current = { ...orgDefaults(), XAI_API_KEY: 'xai-saved', SLACK_BOT_TOKEN: 'xoxb-saved' };
  const { values, errors } = normalizeOrgSettings(
    { XAI_API_KEY: '', XAI_MODEL: 'grok-x', SLACK_BOT_TOKEN: 'ignored', ANALYSIS_PROVIDER: 'OpenAI' },
    current,
    ['SLACK_BOT_TOKEN'],
  );
  assert.deepEqual(errors, []);
  assert.equal(values.XAI_API_KEY, 'xai-saved');
  assert.equal(values.XAI_MODEL, 'grok-x');
  assert.equal(values.SLACK_BOT_TOKEN, '');
  assert.equal(values.ANALYSIS_PROVIDER, 'openai');

  const view = orgSettingsView(current);
  const key = view.find((field) => field.key === 'XAI_API_KEY');
  assert.equal(key.value, '');
  assert.equal(key.set, true);
  assert.equal(JSON.stringify(view).includes('xai-saved'), false);

  assert.ok(normalizeOrgSettings({ ANALYSIS_PROVIDER: 'claude' }).errors.length);
  assert.ok(normalizeOrgSettings({ MCP_PUBLIC_URL: 'http://tunnel.example' }).errors.length);
  assert.equal(normalizeOrgSettings({ MCP_PUBLIC_URL: 'https://t.example/mcp' }).values.MCP_PUBLIC_URL, 'https://t.example');
});

test('comments and export lines parse', () => {
  const parsed = parseEnv('# comment\nexport XAI_MODEL=grok-4\nPORT=3900\n');
  assert.equal(parsed.XAI_MODEL, 'grok-4');
  assert.equal(parsed.PORT, '3900');
  assert.equal(parsed.comment, undefined);
});
