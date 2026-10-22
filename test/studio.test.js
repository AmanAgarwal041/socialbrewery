import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { handleRpc, MCP_TOOLS } from '../src/mcp.js';
import { runWithOrg } from '../src/context.js';
import { useStorage, fileStorage } from '../src/storage.js';
import { dataDir } from '../src/paths.js';
import { atempoChain, composeHtml, listStudioDocs, listVideoStyles, normalizeBrand, readStudioDoc } from '../src/studio.js';
import { STUDIO_FILES } from '../src/studio-pack.js';

const ORG = 'c'.repeat(24);
const inOrg = (fn) => runWithOrg({ org: { id: ORG, name: 'Studio' }, config: {}, user: null, role: 'owner' }, fn);
const call = (name, args = {}) => handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
const json = (res) => JSON.parse(res.result.content[0].text);

test('studio pack is in sync with studio/', () => {
  execFileSync(process.execPath, ['scripts/build-studio-pack.mjs', '--check'], { stdio: 'pipe' });
});

test('studio pack has guides, styles, playbooks, brands, and vendored licenses', () => {
  for (const file of ['guides/style-guide.md', 'guides/copy-rules.md', 'motion/cinematic.md', 'motion/graph-to-3d-pillars.md',
    'playbooks/launch-video.md', 'brands/openlit.json', 'brands/default.json', 'templates/composition.html',
    'vendor/brag/LICENSE', 'vendor/cinetic/LICENSE', 'vendor/cinetic/SKILL.md', 'LICENSES.md']) {
    assert.ok(Object.hasOwn(STUDIO_FILES, file), file);
  }
  const styles = listVideoStyles();
  assert.ok(styles.styles.some((s) => s.id === 'cinematic' && s.summary));
  assert.ok(styles.brands.some((b) => b.id === 'openlit'));
  assert.ok(listStudioDocs().every((d) => d.uri.startsWith('studio://')));
  assert.throws(() => readStudioDoc('../package.json'), /No studio document/);
  const openlit = JSON.parse(STUDIO_FILES['brands/openlit.json']);
  assert.equal(openlit.colors.button, '#C2410C');
  assert.equal(openlit.colors.buttonText, '#FFFFFF');
});

test('house copy rules: no em or en dashes in the guides we wrote', () => {
  for (const [file, text] of Object.entries(STUDIO_FILES)) {
    if (file.startsWith('vendor/')) continue;
    assert.ok(!/[\u2013\u2014]/.test(text), `${file} has an em or en dash`);
  }
});

test('composeHtml builds a HyperFrames composition from scenes and a brand', () => {
  const brand = normalizeBrand(JSON.parse(STUDIO_FILES['brands/openlit.json']));
  const out = composeHtml({
    format: '9x16',
    brand,
    scenes: [
      { headline: 'Your agent said Done \u2014 it lied', highlight: 'lied', duration: 3, captions: [{ at: 0, text: 'Your agent said Done' }] },
      { headline: 'Trace every step', image: 'https://example.com/shot.png', focus: { x: 30, y: 40, scale: 2 }, duration: 4, effect: 'zoom-through' },
      { headline: 'GPU load', pillars: [10, 40, 25], duration: 3 },
      { headline: 'OpenLIT', duration: 4, effect: 'endcard' },
    ],
    question: 'What does your agent lie about?<script>',
  });
  assert.equal(out.duration, 14);
  assert.equal(out.width, 1080);
  assert.match(out.html, /data-composition-id="main"/);
  assert.match(out.html, /data-duration="14.000"/);
  assert.match(out.html, /window.__timelines\['main'\]/);
  assert.match(out.html, /--button: #C2410C; --buttonText: #FFFFFF;/);
  assert.match(out.html, /STYLIZED TRANSITION/);
  assert.match(out.html, /Book a call with the founder/);
  assert.ok(!out.html.includes('<script>\'') && out.html.includes('lie about?&lt;script&gt;'));
  assert.ok(!/[\u2014]/.test(out.html.split('<script id="spec"')[0]));
  assert.ok(!/\{\{\w+\}\}/.test(out.html));
  assert.throws(() => composeHtml({ scenes: [{ headline: 'x', image: 'file:///etc/passwd' }] }), /https/);
  assert.throws(() => composeHtml({ scenes: [{ headline: 'x', effect: 'pillars' }] }), /measured bar heights/);
});

test('atempo chains stay inside ffmpeg limits', () => {
  assert.equal(atempoChain(1.25), 'atempo=1.25');
  assert.equal(atempoChain(3), 'atempo=2.0,atempo=1.5');
});

test('connector exposes studio tools, resources, and prompts', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sb-studio-test-'));
  useStorage(fileStorage(dir));
  try {
    await inOrg(async () => {
      const init = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
      assert.ok(init.result.capabilities.resources && init.result.capabilities.prompts);
      const names = MCP_TOOLS.map((t) => t.name);
      for (const n of ['list_video_styles', 'get_video_playbook', 'create_video_project', 'render_video', 'generate_voiceover']) assert.ok(names.includes(n), n);

      const resources = await handleRpc({ jsonrpc: '2.0', id: 2, method: 'resources/list' });
      assert.ok(resources.result.resources.some((r) => r.uri === 'studio://guides/style-guide.md'));
      const read = await handleRpc({ jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: 'studio://motion/cinematic.md' } });
      assert.match(read.result.contents[0].text, /Rack focus/);

      const prompts = await handleRpc({ jsonrpc: '2.0', id: 4, method: 'prompts/list' });
      assert.ok(prompts.result.prompts.some((p) => p.name === 'make_launch_video'));
      const prompt = await handleRpc({ jsonrpc: '2.0', id: 5, method: 'prompts/get', params: { name: 'make_launch_video', arguments: { source: 'https://github.com/x/y/pull/1', brand: 'openlit', style: 'cinematic' } } });
      assert.match(prompt.result.messages[0].content.text, /4IRPuRJvf53MmuBPNKJI/);

      const playbook = json(await call('get_video_playbook', { playbook: 'product-short', brand: 'openlit' }));
      assert.equal(playbook.brand.id, 'openlit');
      assert.match(playbook.text, /Pain-first hook/);

      const saved = json(await call('save_brand_kit', { id: 'acme', name: 'Acme', colors: { accent: '#FF0000' } }));
      assert.equal(saved.colors.accent, '#FF0000');
      const bad = await call('save_brand_kit', { id: 'acme2', colors: { accent: 'red' } });
      assert.equal(bad.result.isError, true);

      const created = json(await call('create_video_project', {
        title: 'Test', template: 'launch-landscape', brand: 'acme', formats: ['16x9', '9x16'],
        scenes: [{ headline: 'Hello', duration: 2 }, { headline: 'Bye', duration: 2, effect: 'endcard' }], question: 'Why?',
      }));
      assert.deepEqual(created.formats, ['16x9', '9x16']);
      assert.equal(created.duration, 4);
      const project = json(await call('get_video_project', { projectId: created.projectId }));
      assert.match(project.html['16x9'], /--accent: #FF0000/);
      const updated = json(await call('update_video_project', { projectId: created.projectId, scenes: [{ headline: 'Only', duration: 5 }] }));
      assert.equal(updated.duration, 5);
      const voice = await call('generate_voiceover', { text: 'hello', provider: 'elevenlabs', voiceId: 'v' });
      assert.equal(voice.result.isError, true);
      assert.match(voice.result.content[0].text, /ElevenLabs API key/);
    });
  } finally {
    useStorage(fileStorage(dataDir));
    await fs.rm(dir, { recursive: true, force: true });
  }
});
