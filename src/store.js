import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { dataDir } from './paths.js';
import { currentOrgId, orgDataDir } from './context.js';
import { decryptJson, encryptJson, isEncrypted } from './secure.js';
import { onWorkers, readText, removeEntry, writeBlob, writeText } from './storage.js';

export const systemDir = path.join(dataDir, 'system');

const orgFile = (name) => path.join(orgDataDir(), name);
const mediaDir = () => orgFile('media');
const postsFile = () => orgFile('posts.json');
const historyFile = () => orgFile('history.json');
const mediaFile = () => orgFile('media.json');
const analysisFile = () => orgFile('analyses.json');

export const NETWORKS = new Set(['youtube', 'linkedin', 'instagram', 'x', 'hashnode', 'slack', 'reddit']);

function networkTokenFile(network) {
  if (!NETWORKS.has(network)) throw new Error('Unknown network.');
  return orgFile(`token-${network}.json`);
}

function networkOauthFile(network) {
  if (!NETWORKS.has(network)) throw new Error('Unknown network.');
  return orgFile(`oauth-${network}.json`);
}

let queue = Promise.resolve();

// Serialises read-modify-write updates within one Node process. Workers isolates cannot share
// promises across requests, so there each update runs on its own.
export function enqueue(fn) {
  if (onWorkers()) return Promise.resolve().then(fn);
  const run = queue.then(fn, fn);
  queue = run.then(() => undefined, () => undefined);
  return run;
}

export async function readJson(file, fallback) {
  const text = await readText(file);
  return text == null ? fallback : JSON.parse(text);
}

export async function writeJson(file, value) {
  await writeText(file, JSON.stringify(value, null, 2));
}

export async function ensureData() {
  if (!onWorkers()) await fs.mkdir(systemDir, { recursive: true, mode: 0o700 });
}

export function updateJson(file, fallback, mutator) {
  return enqueue(async () => {
    const current = await readJson(file, fallback);
    const next = await mutator(current);
    await writeJson(file, next);
    return next;
  });
}

export async function listPosts() {
  const posts = await readJson(postsFile(), []);
  return Array.isArray(posts) ? posts : [];
}

export function updatePostYoutube(youtubeId, fields) {
  return updateJson(postsFile(), [], (posts) => {
    const list = Array.isArray(posts) ? posts : [];
    return list.map((post) => (post.youtubeId === youtubeId ? { ...post, ...fields } : post));
  });
}

export function addPost(post) {
  return updateJson(postsFile(), [], (posts) => {
    const list = Array.isArray(posts) ? posts : [];
    list.unshift(post);
    return list.slice(0, 200);
  });
}

export async function loadHistory() {
  const history = await readJson(historyFile(), { display: [], model: [] });
  return {
    display: Array.isArray(history.display) ? history.display : [],
    model: Array.isArray(history.model) ? history.model : [],
  };
}

export function saveHistory(history) {
  return enqueue(() => writeJson(historyFile(), {
    display: history.display.slice(-100),
    model: history.model,
  }));
}

export async function listAnalyses() {
  const list = await readJson(analysisFile(), []);
  return Array.isArray(list) ? list : [];
}

export function saveAnalysis(record) {
  return updateJson(analysisFile(), [], (list) => {
    const next = Array.isArray(list) ? list : [];
    next.unshift(record);
    return next.slice(0, 100);
  });
}

export function clearHistory() {
  return enqueue(() => writeJson(historyFile(), { display: [], model: [] }));
}

export async function readToken() {
  return readNetworkToken('youtube');
}

export function writeToken(token) {
  return writeNetworkToken('youtube', token);
}

export function clearToken() {
  return clearNetworkToken('youtube');
}

export async function readNetworkToken(network) {
  const stored = await readJson(networkTokenFile(network), null);
  if (!stored || typeof stored !== 'object') return null;
  if (!isEncrypted(stored)) return null;
  const token = decryptJson(stored, `${currentOrgId()}:token:${network}`);
  return token && typeof token === 'object' ? token : null;
}

export function writeNetworkToken(network, token) {
  const file = networkTokenFile(network);
  const box = encryptJson(token, `${currentOrgId()}:token:${network}`);
  return enqueue(() => writeJson(file, box));
}

export function clearNetworkToken(network) {
  const file = networkTokenFile(network);
  return enqueue(() => removeEntry(file));
}

export async function readOauthState(network = 'youtube') {
  return readJson(networkOauthFile(network), null);
}

export function writeOauthState(state, network = 'youtube') {
  const file = networkOauthFile(network);
  return enqueue(() => writeJson(file, state));
}

export function clearOauthState(network = 'youtube') {
  const file = networkOauthFile(network);
  return enqueue(() => removeEntry(file));
}

export async function getMedia(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return null;
  const index = await readJson(mediaFile(), []);
  const record = (Array.isArray(index) ? index : []).find((item) => item.id === id);
  if (!record) return null;
  return record;
}

export function mediaPath(record) {
  const base = path.resolve(mediaDir(), path.basename(record.file || ''));
  const root = path.resolve(mediaDir());
  if (!base.startsWith(`${root}${path.sep}`)) {
    throw new Error('Bad media path.');
  }
  return base;
}

export function addMediaRecord(record) {
  return updateJson(mediaFile(), [], (index) => {
    const list = Array.isArray(index) ? index : [];
    list.unshift(record);
    return list.slice(0, 100);
  });
}

export async function createMedia({ buffer, name, mime, source, prompt }) {
  const id = randomUUID();
  const ext = mime === 'video/webm' ? '.webm' : mime === 'video/quicktime' ? '.mov' : '.mp4';
  const file = `${id}${ext}`;
  await writeBlob(path.join(mediaDir(), file), buffer, { mime });
  const record = {
    id,
    name: name || `short${ext}`,
    file,
    mime,
    bytes: buffer.length,
    createdAt: new Date().toISOString(),
    source,
    prompt: prompt || '',
  };
  await addMediaRecord(record);
  return record;
}

export async function allocateMedia({ name, mime, source, prompt }) {
  const id = randomUUID();
  const ext = mime === 'video/webm' ? '.webm' : mime === 'video/quicktime' ? '.mov' : '.mp4';
  const file = `${id}${ext}`;
  const record = {
    id,
    name: name || `short${ext}`,
    file,
    mime,
    bytes: 0,
    createdAt: new Date().toISOString(),
    source,
    prompt: prompt || '',
  };
  return { record, filePath: path.join(mediaDir(), file) };
}

export function rememberMedia(record) {
  return addMediaRecord(record);
}
