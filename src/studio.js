// Video Studio: a brand-configurable knowledge pack (studio/ bundled into studio-pack.js) plus tools
// that turn a scene list into a HyperFrames composition, voice it, and render it to the media library.
// Pack reads and project files work everywhere; voiceover speed-up and rendering need ffmpeg/npx on Node.
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { STUDIO_FILES } from './studio-pack.js';
import { EFFECTS, FORMATS, TEMPLATES, composeHtml as composeWith, noDashes, normalizeBrand as normalizeBrandWith, normalizeScenes } from './studio-compose.js';

export { EFFECTS, FORMATS, TEMPLATES, normalizeScenes };
import { cfg, orgDataDir } from './context.js';
import { root } from './paths.js';
import { createMedia, readJson, updateJson, writeJson } from './store.js';
import { onWorkers, readBlobRange, blobSize, writeBlob } from './storage.js';


// ---------- Knowledge pack ----------

function titleAndSummary(text) {
  const title = /^#\s+(.+)$/m.exec(text)?.[1]?.trim() || '';
  const summary = /^>\s+(.+)$/m.exec(text)?.[1]?.trim() || '';
  return { title, summary };
}

export function studioUri(file) {
  return `studio://${file}`;
}

export function listStudioDocs() {
  return Object.keys(STUDIO_FILES).map((file) => ({
    path: file,
    uri: studioUri(file),
    ...titleAndSummary(STUDIO_FILES[file]),
    mimeType: file.endsWith('.json') ? 'application/json' : file.endsWith('.html') ? 'text/html' : 'text/markdown',
  }));
}

export function readStudioDoc(ref) {
  const file = String(ref || '').replace(/^studio:\/\//, '').replace(/^\/+/, '');
  if (!Object.hasOwn(STUDIO_FILES, file)) throw new Error(`No studio document "${file}". Use list_studio_docs to see what exists.`);
  return { path: file, uri: studioUri(file), text: STUDIO_FILES[file] };
}

function section(prefix) {
  return Object.keys(STUDIO_FILES)
    .filter((file) => file.startsWith(prefix) && file.endsWith('.md'))
    .map((file) => ({ id: path.posix.basename(file, '.md'), uri: studioUri(file), ...titleAndSummary(STUDIO_FILES[file]) }));
}

export function listVideoStyles() {
  return {
    styles: section('motion/'),
    playbooks: section('playbooks/'),
    templates: Object.entries(TEMPLATES).map(([id, t]) => ({ id, ...t })),
    effects: EFFECTS,
    brands: builtInBrands().map((b) => ({ id: b.id, name: b.name })),
    guides: section('guides/'),
  };
}

// ---------- Brand kits ----------

function builtInBrands() {
  return Object.keys(STUDIO_FILES)
    .filter((file) => file.startsWith('brands/') && file.endsWith('.json'))
    .map((file) => JSON.parse(STUDIO_FILES[file]));
}

const brandsFile = () => path.join(orgDataDir(), 'studio', 'brands.json');

export async function listBrandKits() {
  const custom = await readJson(brandsFile(), []);
  return [...builtInBrands().map((b) => ({ ...b, builtIn: true })), ...(Array.isArray(custom) ? custom : [])];
}

export function normalizeBrand(input = {}, base = JSON.parse(STUDIO_FILES['brands/default.json'])) {
  return normalizeBrandWith(input, base);
}

export async function saveBrandKit(input) {
  if (!input?.id) throw new Error('Give the brand kit an id, like "acme".');
  const brand = normalizeBrand(input);
  if (builtInBrands().some((b) => b.id === brand.id)) throw new Error(`"${brand.id}" is a built-in brand kit. Pick another id.`);
  await updateJson(brandsFile(), [], (list) => {
    const next = (Array.isArray(list) ? list : []).filter((b) => b.id !== brand.id);
    next.push(brand);
    return next.slice(-50);
  });
  return brand;
}

export async function resolveBrand(ref) {
  if (ref && typeof ref === 'object') return normalizeBrand(ref);
  const id = String(ref || 'default');
  const found = (await listBrandKits()).find((b) => b.id === id);
  if (!found) throw new Error(`No brand kit "${id}". Use list_video_styles or save_brand_kit.`);
  return normalizeBrand(found, normalizeBrand({}));
}

export async function getVideoPlaybook({ playbook = 'launch-video', style, brand } = {}) {
  const pb = readStudioDoc(`playbooks/${playbook}.md`);
  const docs = [pb, readStudioDoc('guides/style-guide.md'), readStudioDoc('guides/copy-rules.md'), readStudioDoc('guides/voice-audio.md')];
  if (style) docs.push(readStudioDoc(`motion/${style}.md`));
  const kit = await resolveBrand(brand);
  return {
    brand: kit,
    text: docs.map((d) => `<!-- ${d.uri} -->\n${d.text}`).join('\n\n---\n\n'),
    more: listStudioDocs().filter((d) => !docs.some((x) => x.path === d.path)).map((d) => d.uri),
  };
}

// ---------- Compose ----------

export function composeHtml(options) {
  return composeWith(STUDIO_FILES['templates/composition.html'], { ...options, brand: options.brand || normalizeBrand({}) });
}

// ---------- Projects ----------

const studioDir = (...parts) => path.join(orgDataDir(), 'studio', ...parts);
const projectFile = (id) => {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) throw new Error('Unknown project id.');
  return studioDir('projects', `${id}.json`);
};

export async function createVideoProject(input = {}) {
  const id = randomUUID();
  return saveProject({ id, createdAt: new Date().toISOString() }, input);
}

export async function updateVideoProject({ projectId, ...patch } = {}) {
  const current = await readJson(projectFile(projectId), null);
  if (!current) throw new Error('Unknown project id.');
  return saveProject(current, patch);
}

export async function getVideoProject({ projectId, includeHtml = true } = {}) {
  const project = await readJson(projectFile(projectId), null);
  if (!project) throw new Error('Unknown project id.');
  return includeHtml ? project : { ...project, html: undefined };
}

async function saveProject(current, patch) {
  const next = { ...current };
  for (const key of ['title', 'template', 'style', 'brand', 'scenes', 'cta', 'question', 'voiceoverId', 'formats']) {
    if (patch[key] !== undefined) next[key] = patch[key];
  }
  next.template = next.template || 'short-vertical';
  if (!TEMPLATES[next.template]) throw new Error(`template must be one of ${Object.keys(TEMPLATES).join(', ')}.`);
  const brand = await resolveBrand(next.brand);
  const formats = Array.isArray(next.formats) && next.formats.length ? next.formats : [TEMPLATES[next.template].format];
  if (next.voiceoverId) await getVoiceover(next.voiceoverId);
  const builds = {};
  for (const format of formats) {
    builds[format] = composeHtml({ format, brand, scenes: next.scenes, cta: next.cta, question: next.question, audio: next.voiceoverId ? 'assets/voiceover.mp3' : '' });
  }
  next.formats = formats;
  next.updatedAt = new Date().toISOString();
  next.html = Object.fromEntries(Object.entries(builds).map(([k, v]) => [k, v.html]));
  next.duration = builds[formats[0]].duration;
  await writeJson(projectFile(next.id), next);
  return {
    projectId: next.id,
    title: next.title || '',
    formats,
    duration: next.duration,
    scenes: builds[formats[0]].scenes.length,
    brand: brand.id,
    next: 'Review the scenes, then call render_video with this projectId. The composition HTML is in get_video_project.',
  };
}

// ---------- Voiceover ----------

const voiceIndex = () => studioDir('voiceovers.json');

export async function getVoiceover(id) {
  const list = await readJson(voiceIndex(), []);
  const found = (Array.isArray(list) ? list : []).find((v) => v.id === id);
  if (!found) throw new Error('Unknown voiceoverId.');
  return found;
}

async function nodeTools() {
  if (onWorkers()) throw new Error('This needs the Node server (ffmpeg and a browser). It is not available on the Cloudflare deploy.');
  const [{ execFile }, fs, os] = await Promise.all([import('node:child_process'), import('node:fs/promises'), import('node:os')]);
  const run = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 32 * 1024 * 1024, timeout: opts.timeout || 15 * 60 * 1000, cwd: opts.cwd, env: opts.env }, (err, stdout, stderr) => {
      if (err) { err.stderr = String(stderr || ''); reject(err); } else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
  const has = async (cmd) => run(cmd, ['-version']).then(() => true, () => false);
  return { run, fs, os, has };
}

async function probeSeconds(tools, file) {
  try {
    const { stdout } = await tools.run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
    return Number(Number(stdout.trim()).toFixed(3)) || null;
  } catch { return null; }
}

export async function generateVoiceover({ text, voiceId, model, speed, provider, brand, stability, similarity, style } = {}) {
  const script = noDashes(String(text || '').trim());
  if (!script) throw new Error('Give the voiceover text.');
  if (script.length > 5000) throw new Error('Keep one voiceover under 5,000 characters; split long scripts by scene.');
  const kit = await resolveBrand(brand);
  const rate = Number(speed || kit.voice?.speed || 1);
  if (!(rate >= 0.5 && rate <= 2)) throw new Error('speed must be between 0.5 and 2.');
  let audio;
  let used = provider || (cfg.ELEVENLABS_API_KEY ? 'elevenlabs' : 'kokoro');
  let note = '';
  if (used === 'elevenlabs') {
    try {
      audio = await elevenlabsSpeech({ text: script, voiceId: voiceId || kit.voice?.elevenlabsVoiceId, model: model || kit.voice?.model, stability, similarity, style });
    } catch (err) {
      if (provider === 'elevenlabs') throw err;
      note = `ElevenLabs failed (${err.message}); used Kokoro instead.`;
      used = 'kokoro';
    }
  }
  if (used === 'kokoro') audio = await kokoroSpeech({ text: script, voice: kit.voice?.kokoroVoice || 'am_michael' });
  if (used !== 'elevenlabs' && used !== 'kokoro') throw new Error('provider must be elevenlabs or kokoro.');

  const id = randomUUID();
  let buffer = audio;
  let duration = null;
  try {
    const tools = await nodeTools();
    if (await tools.has('ffmpeg')) {
      const dir = await tools.fs.mkdtemp(path.join(tools.os.tmpdir(), 'sb-vo-'));
      try {
        await tools.fs.writeFile(path.join(dir, 'in.audio'), audio);
        const filters = rate !== 1 ? atempoChain(rate) : 'anull';
        await tools.run('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(dir, 'in.audio'), '-af', filters, '-ar', '44100', '-b:a', '160k', path.join(dir, 'out.mp3')]);
        buffer = await tools.fs.readFile(path.join(dir, 'out.mp3'));
        duration = await probeSeconds(tools, path.join(dir, 'out.mp3'));
      } finally { await tools.fs.rm(dir, { recursive: true, force: true }); }
    } else if (rate !== 1) note = `${note} ffmpeg is missing, so the speed change was not applied.`.trim();
  } catch (err) {
    if (rate !== 1) note = `${note} Speed change skipped: ${err.message}`.trim();
  }
  const file = studioDir('voice', `${id}.mp3`);
  await writeBlob(file, buffer, { mime: 'audio/mpeg' });
  const record = { id, provider: used, speed: rate, duration, bytes: buffer.length, text: script.slice(0, 400), createdAt: new Date().toISOString() };
  await updateJson(voiceIndex(), [], (list) => [record, ...(Array.isArray(list) ? list : [])].slice(0, 200));
  return { voiceoverId: id, provider: used, durationSeconds: duration, speed: rate, ...(note ? { note } : {}) };
}

export function atempoChain(rate) {
  const parts = [];
  let r = rate;
  while (r > 2) { parts.push('atempo=2.0'); r /= 2; }
  while (r < 0.5) { parts.push('atempo=0.5'); r /= 0.5; }
  parts.push(`atempo=${Number(r.toFixed(4))}`);
  return parts.join(',');
}

async function elevenlabsSpeech({ text, voiceId, model, stability, similarity, style }) {
  const key = cfg.ELEVENLABS_API_KEY;
  if (!key) throw new Error('Add an ElevenLabs API key in Settings to use ElevenLabs voices.');
  if (!voiceId) throw new Error('Give a voiceId or set voice.elevenlabsVoiceId in the brand kit.');
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: model || 'eleven_multilingual_v2',
      voice_settings: { stability: stability ?? 0.45, similarity_boost: similarity ?? 0.8, style: style ?? 0.2, use_speaker_boost: true },
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = body?.detail?.message || body?.detail?.status || (typeof body?.detail === 'string' ? body.detail : '');
    throw new Error(`ElevenLabs ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

// Kokoro runs locally through scripts/kokoro-tts.py (pip install kokoro-onnx soundfile) with the model files in
// <SOCIALBREWERY_HOME>/kokoro/ (kokoro-v1.0.onnx, voices-v1.0.bin).
async function kokoroSpeech({ text, voice }) {
  const tools = await nodeTools();
  const dir = await tools.fs.mkdtemp(path.join(tools.os.tmpdir(), 'sb-kokoro-'));
  try {
    const out = path.join(dir, 'out.wav');
    await tools.fs.writeFile(path.join(dir, 'in.txt'), text);
    try {
      await tools.run('python3', [path.join(root, 'scripts', 'kokoro-tts.py'), '--text-file', path.join(dir, 'in.txt'), '--voice', voice, '--out', out], { timeout: 10 * 60 * 1000 });
    } catch (err) {
      const why = (err.stderr || err.message || '').trim().split('\n').pop();
      throw new Error(`Kokoro is not available here (${why}). Add an ElevenLabs key, or install kokoro-onnx and the model files (docs/video-studio.md).`);
    }
    return await tools.fs.readFile(out);
  } finally { await tools.fs.rm(dir, { recursive: true, force: true }); }
}

// ---------- Assets ----------

export async function addStudioAsset({ name, base64, url } = {}) {
  const safe = String(name || '').replace(/[^\w.-]/g, '_').slice(0, 80);
  if (!/\.(png|jpe?g|webp|gif|svg|mp4|webm)$/i.test(safe)) throw new Error('name must end in .png, .jpg, .webp, .gif, .svg, .mp4, or .webm.');
  let buffer;
  if (base64) buffer = Buffer.from(String(base64).replace(/^data:[^,]+,/, ''), 'base64');
  else if (/^https:\/\//i.test(String(url || ''))) {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`Could not download that file (${res.status}).`);
    buffer = Buffer.from(await res.arrayBuffer());
  } else throw new Error('Give base64 data or a public https url.');
  if (!buffer.length || buffer.length > 25 * 1024 * 1024) throw new Error('Assets must be between 1 byte and 25 MB.');
  await writeBlob(studioDir('assets', safe), buffer, {});
  return { image: `assets/${safe}`, bytes: buffer.length };
}

async function copyBlob(tools, from, to) {
  const size = await blobSize(from);
  if (!size) return false;
  await tools.fs.writeFile(to, await readBlobRange(from, 0, size - 1));
  return true;
}

// ---------- Render ----------

const jobs = new Map();
export const HYPERFRAMES = 'hyperframes@0.8.79';

export async function renderVideo({ projectId, format, quality = 'standard', master = true } = {}) {
  const project = await readJson(projectFile(projectId), null);
  if (!project) throw new Error('Unknown project id.');
  const fmt = format || project.formats?.[0];
  if (!project.html?.[fmt]) throw new Error(`This project has no ${fmt} cut. Add it with update_video_project formats.`);
  const tools = await nodeTools();
  const missing = [];
  if (!(await tools.has('ffmpeg'))) missing.push('ffmpeg');
  if (!(await tools.run('npx', ['--version']).then(() => true, () => false))) missing.push('npx (Node.js)');
  if (missing.length) throw new Error(`Rendering needs ${missing.join(' and ')} on the server. See docs/video-studio.md.`);
  const broken = [];
  for (const url of new Set(project.html[fmt].match(/src="https:\/\/[^"]+"/g) || [])) {
    const href = url.slice(5, -1).replace(/&amp;/g, '&');
    if (href.includes('cdn.jsdelivr.net/npm/gsap')) continue;
    const ok = await fetch(href, { method: 'HEAD', redirect: 'follow' }).then((r) => r.ok, () => false);
    if (!ok) broken.push(href);
  }
  if (broken.length) throw new Error(`These images could not be loaded, so they would render blank: ${broken.join(', ')}. Fix the URLs or use add_studio_asset.`);
  const jobId = randomUUID();
  const job = { jobId, projectId, format: fmt, status: 'rendering', startedAt: new Date().toISOString() };
  jobs.set(jobId, job);
  const orgDir = orgDataDir();
  // The org context (AsyncLocalStorage) follows this promise, so createMedia saves into the right org.
  doRender(tools, project, fmt, quality, master, job, orgDir).catch((err) => {
    job.status = 'failed';
    job.error = String(err.stderr || err.message || err).trim().split('\n').slice(-6).join('\n');
  });
  return { jobId, status: job.status, next: 'Poll get_render_status with this jobId. Renders take about 1 to 5 minutes.' };
}

export function getRenderStatus({ jobId } = {}) {
  const job = jobs.get(jobId);
  if (!job) throw new Error('Unknown jobId (jobs are kept in memory until the server restarts).');
  return job;
}

async function doRender(tools, project, fmt, quality, master, job, orgDir) {
  const dir = await tools.fs.mkdtemp(path.join(tools.os.tmpdir(), 'sb-render-'));
  try {
    await tools.fs.mkdir(path.join(dir, 'fonts'));
    await tools.fs.mkdir(path.join(dir, 'assets'));
    for (const font of ['Inter.ttf', 'GeistMono.ttf']) {
      await tools.fs.copyFile(path.join(root, 'studio', 'fonts', font), path.join(dir, 'fonts', font)).catch(() => {});
    }
    const html = project.html[fmt];
    for (const ref of new Set(html.match(/assets\/[\w.-]+/g) || [])) {
      if (ref === 'assets/voiceover.mp3') continue;
      await copyBlob(tools, path.join(orgDir, 'studio', ref), path.join(dir, ref));
    }
    if (project.voiceoverId) await copyBlob(tools, path.join(orgDir, 'studio', 'voice', `${project.voiceoverId}.mp3`), path.join(dir, 'assets', 'voiceover.mp3'));
    await tools.fs.writeFile(path.join(dir, 'index.html'), html);
    const raw = path.join(dir, 'raw.mp4');
    job.step = 'hyperframes';
    await tools.run('npx', ['-y', HYPERFRAMES, 'render', '-o', raw, '-f', '30', '-q', quality === 'delivery' ? 'delivery' : 'standard'], { cwd: dir, timeout: 20 * 60 * 1000 });
    let final = raw;
    if (master) {
      job.step = 'master';
      final = path.join(dir, 'final.mp4');
      const hasAudio = await tools.run('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', raw]).then((r) => r.stdout.trim() !== '', () => false);
      const args = hasAudio
        ? ['-y', '-loglevel', 'error', '-i', raw, '-af', 'loudnorm=I=-14:TP=-1:LRA=11', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', final]
        : ['-y', '-loglevel', 'error', '-i', raw, '-c', 'copy', '-movflags', '+faststart', final];
      await tools.run('ffmpeg', args);
    }
    job.step = 'saving';
    const buffer = await tools.fs.readFile(final);
    const media = await createMedia({ buffer, name: `${(project.title || 'studio-video').replace(/[^\w-]+/g, '-').slice(0, 60)}-${fmt}.mp4`, mime: 'video/mp4', source: 'studio', prompt: project.title || '' });
    job.status = 'done';
    delete job.step;
    job.mediaId = media.id;
    job.bytes = buffer.length;
    job.durationSeconds = await probeSeconds(tools, final);
    job.finishedAt = new Date().toISOString();
    job.next = 'Pass mediaId to post_youtube_short, post_slack, post_x, or post_instagram_reel after the user approves the post.';
  } finally {
    await tools.fs.rm(dir, { recursive: true, force: true });
  }
}
