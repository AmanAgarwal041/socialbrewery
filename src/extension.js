import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { orgDataDir } from './context.js';
import { NETWORKS, addPost, readJson, updateJson } from './store.js';

// Runs saved by the Chrome extension (extension/): what someone asked, what the agent did in their
// tabs, and what got posted. The extension works without an account; signing in copies its runs
// here, one document per person in each organisation. API keys and media never come here.

const MAX_RUNS = 100;
const MAX_STEPS = 150;
const MAX_BYTES = 1_500_000;
const PROVIDERS = new Set(['claude', 'grok']);
const STATUSES = new Set(['running', 'done', 'stopped', 'error']);
const KINDS = new Set(['user', 'assistant', 'action', 'approval']);

function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function runsFile(userId) {
  const safe = String(userId || '').replace(/[^\w-]/g, '').slice(0, 64);
  if (!safe) throw fail('Sign in to save runs.', 401);
  return path.join(orgDataDir(), `extension-runs-${safe}.json`);
}

const text = (value, max) => String(value ?? '').slice(0, max);
const time = (value) => (Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0);

function cleanLink(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href.slice(0, 500) : '';
  } catch {
    return '';
  }
}

function cleanRun(run) {
  const id = text(run?.id, 64);
  if (!/^[\w-]{1,64}$/.test(id)) return null;
  return {
    id,
    title: text(run.title, 200),
    provider: PROVIDERS.has(run.provider) ? run.provider : 'claude',
    status: STATUSES.has(run.status) ? run.status : 'done',
    createdAt: time(run.createdAt),
    updatedAt: time(run.updatedAt),
    steps: (Array.isArray(run.steps) ? run.steps : [])
      .filter((s) => KINDS.has(s?.kind))
      .slice(-MAX_STEPS)
      .map((s) => ({
        kind: s.kind,
        text: text(s.text, 2000),
        at: time(s.at),
        ...(s.kind === 'action' && s.error ? { error: true } : {}),
        ...(s.kind === 'approval' ? { approved: Boolean(s.approved) } : {}),
      })),
    posts: (Array.isArray(run.posts) ? run.posts : [])
      .map((p) => ({ network: text(p?.network, 40), url: cleanLink(p?.url), title: text(p?.title, 200), at: time(p?.at) }))
      .filter((p) => p.url)
      .slice(0, 50),
  };
}

function shrink(runs) {
  const kept = [...runs].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_RUNS);
  while (kept.length > 1 && JSON.stringify(kept).length > MAX_BYTES) kept.pop();
  return kept;
}

export async function loadExtensionRuns(userId) {
  const doc = await readJson(runsFile(userId), null);
  return { runs: Array.isArray(doc?.runs) ? doc.runs : [], deleted: Array.isArray(doc?.deleted) ? doc.deleted : [] };
}

// Merges runs from one browser into the saved copy: the newer copy of each run wins, and deleted
// ids stay deleted on every device. Posts seen for the first time also go into the organisation's
// Posts list, so the dashboard shows what the extension published.
export async function mergeExtensionRuns(userId, body) {
  const incoming = (Array.isArray(body?.runs) ? body.runs : []).slice(0, MAX_RUNS).map(cleanRun).filter(Boolean);
  const deletedNow = (Array.isArray(body?.deleted) ? body.deleted : []).map((id) => text(id, 64)).filter((id) => /^[\w-]{1,64}$/.test(id));
  const newPosts = [];
  const doc = await updateJson(runsFile(userId), null, (current) => {
    const deleted = new Set([...(Array.isArray(current?.deleted) ? current.deleted : []), ...deletedNow]);
    const byId = new Map((Array.isArray(current?.runs) ? current.runs : []).map((run) => [run.id, run]));
    const known = new Set([...byId.values()].flatMap((run) => (run.posts || []).map((p) => p.url)));
    for (const run of incoming) {
      const existing = byId.get(run.id);
      if (!existing || run.updatedAt >= existing.updatedAt) byId.set(run.id, run);
      for (const post of run.posts) if (!known.has(post.url)) (known.add(post.url), newPosts.push(post));
    }
    for (const id of deleted) byId.delete(id);
    return { runs: shrink([...byId.values()]), deleted: [...deleted].slice(-1000) };
  });
  for (const post of newPosts) {
    const network = post.network.toLowerCase().replace(/^twitter$/, 'x');
    if (!NETWORKS.has(network)) continue;
    await addPost({
      id: randomBytes(8).toString('hex'),
      network,
      title: post.title || `Posted from the extension`,
      description: '',
      url: post.url,
      createdAt: new Date(post.at || Date.now()).toISOString(),
      source: 'extension',
    });
  }
  return doc;
}
