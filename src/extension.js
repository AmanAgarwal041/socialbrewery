import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { orgDataDir } from './context.js';
import { NETWORKS, addPost, brewChatFile, loadHistory, readJson, removeBrewChat, updateJson } from './store.js';

// One person's conversations in an organisation, shared by the Chrome extension and the dashboard.
// Extension runs (extension/): what someone asked, what the agent did in their tabs, and what got
// posted. The extension works without an account; signing in copies its runs here. Brew chats in the
// dashboard are listed here too (`source: 'dashboard'`), as a summary of the full chat in
// `brewChatFile`, so both sides show the same list. API keys and media never come here.

const MAX_RUNS = 100;
const MAX_STEPS = 150;
const MAX_BYTES = 1_500_000;
const PROVIDERS = new Set(['claude', 'grok', 'openai']);
const STATUSES = new Set(['running', 'done', 'stopped', 'error']);
const KINDS = new Set(['user', 'assistant', 'action', 'approval']);
const SOURCES = new Set(['extension', 'dashboard']);
const ID = /^[\w-]{1,64}$/;

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
  if (!ID.test(id)) return null;
  return {
    id,
    title: text(run.title, 200),
    source: SOURCES.has(run.source) ? run.source : 'extension',
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
  const deletedNow = (Array.isArray(body?.deleted) ? body.deleted : []).map((id) => text(id, 64)).filter((id) => ID.test(id));
  const newPosts = [];
  const removedChats = [];
  const doc = await updateJson(runsFile(userId), null, (current) => {
    const deleted = new Set([...(Array.isArray(current?.deleted) ? current.deleted : []), ...deletedNow]);
    const byId = new Map((Array.isArray(current?.runs) ? current.runs : []).map((run) => [run.id, run]));
    const known = new Set([...byId.values()].flatMap((run) => (run.posts || []).map((p) => p.url)));
    for (const run of incoming) {
      const existing = byId.get(run.id);
      if (!existing || run.updatedAt >= existing.updatedAt) byId.set(run.id, run);
      // Brew saved its own posts already; a Brew chat coming back from a browser adds none.
      if (run.source === 'dashboard') continue;
      for (const post of run.posts) if (!known.has(post.url)) (known.add(post.url), newPosts.push(post));
    }
    for (const id of deleted) {
      if (byId.get(id)?.source === 'dashboard') removedChats.push(id);
      byId.delete(id);
    }
    return { runs: shrink([...byId.values()]), deleted: [...deleted].slice(-1000) };
  });
  for (const id of removedChats) await removeBrewChat(userId, id).catch(() => {});
  for (const post of newPosts) {
    const network = post.network
      .trim()
      .toLowerCase()
      .replace(/^twitter$/, 'x')
      .replace(/^(dev|dev\.to|dev community)$/, 'devto');
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

// ---------- the dashboard's side ----------

const TOOL_NETWORK = {
  upload_youtube_short: 'YouTube',
  update_youtube_video: 'YouTube',
  post_linkedin: 'LinkedIn',
  comment_linkedin: 'LinkedIn',
  post_instagram_reel: 'Instagram',
  post_x: 'X',
  reply_x: 'X',
  publish_hashnode_article: 'Hashnode',
  publish_devto_article: 'DEV',
  post_slack: 'Slack',
  reply_slack: 'Slack',
  post_reddit: 'Reddit',
};

const ms = (iso) => Date.parse(iso || '') || 0;

/** The summary of a Brew chat that goes into the shared list. Brew already saved its posts to Posts. */
export function brewRunSummary(chatId, history, status) {
  const steps = history.display.map((item) => {
    const at = ms(item.at);
    if (item.role === 'user') return { kind: 'user', text: text(item.content, 2000), at };
    if (item.role === 'assistant') return { kind: 'assistant', text: text(item.content, 2000), at };
    return { kind: 'action', text: text(item.content, 2000), at, ...(item.error ? { error: true } : {}) };
  });
  const posts = history.display
    .filter((item) => item.role === 'tool' && !item.error && TOOL_NETWORK[item.tool] && cleanLink(item.url))
    .map((item) => ({ network: TOOL_NETWORK[item.tool], url: cleanLink(item.url), title: text(item.content, 200), at: ms(item.at) }));
  const createdAt = Number(history.createdAt) || steps[0]?.at || Date.now();
  return cleanRun({
    id: chatId,
    title: history.title || steps.find((s) => s.kind === 'user')?.text.slice(0, 80) || 'Brew chat',
    source: 'dashboard',
    provider: history.provider,
    status,
    createdAt,
    updatedAt: Date.now(),
    steps,
    posts,
  });
}

/** Saves a Brew chat's summary into the shared list without touching anything else. */
export async function saveDashboardRun(userId, run) {
  await updateJson(runsFile(userId), null, (current) => {
    const deleted = Array.isArray(current?.deleted) ? current.deleted : [];
    const runs = (Array.isArray(current?.runs) ? current.runs : []).filter((r) => r.id !== run.id);
    if (!deleted.includes(run.id)) runs.push(run);
    return { runs: shrink(runs), deleted };
  });
}

/** The same text the extension sends when it continues a saved chat (transcript() in run.ts). */
export function runTranscript(run, limit = 12_000) {
  const lines = (run.steps || []).map((step) => {
    if (step.kind === 'user') return `User: ${step.text}`;
    if (step.kind === 'assistant') return `Assistant: ${step.text}`;
    if (step.kind === 'approval') return `(${step.approved ? 'User approved' : 'User declined'}: ${step.text})`;
    return `(${step.error ? 'Failed' : 'Did'}: ${step.text})`;
  });
  for (const post of run.posts || []) lines.push(`(Posted on ${post.network}: ${post.title} ${post.url})`);
  const all = lines.join('\n\n');
  return all.length > limit ? `[Earlier messages trimmed]\n…${all.slice(-limit)}` : all;
}

/** A run from the extension in the dashboard's chat shape (read-only there). */
export function runDisplay(run) {
  const items = (run.steps || []).map((step, i) => ({
    id: `${run.id}-${i}`,
    role: step.kind === 'user' || step.kind === 'assistant' ? step.kind : 'tool',
    tool: step.kind === 'approval' ? 'browser_approval' : step.kind === 'action' ? 'browser_action' : undefined,
    content: step.kind === 'approval' ? `${step.approved ? 'Approved' : 'Declined'}: ${step.text}` : step.text,
    error: Boolean(step.error) || (step.kind === 'approval' && !step.approved),
    at: step.at ? new Date(step.at).toISOString() : undefined,
  }));
  for (const [i, post] of (run.posts || []).entries()) {
    items.push({ id: `${run.id}-post-${i}`, role: 'tool', tool: 'browser_post', content: `Posted on ${post.network}: ${post.title}`, url: post.url, error: false, at: post.at ? new Date(post.at).toISOString() : undefined });
  }
  return items;
}

const SHARED_ID = 'shared';

/** The list both sides show, newest first. The organisation's older shared Brew chat comes last. */
export async function listConversations(userId) {
  const { runs } = await loadExtensionRuns(userId);
  const list = runs
    .map((r) => ({ id: r.id, title: r.title, source: r.source || 'extension', provider: r.provider, status: r.status, createdAt: r.createdAt, updatedAt: r.updatedAt, posts: (r.posts || []).length }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const shared = await loadHistory();
  if (shared.display.length) {
    list.push({ id: SHARED_ID, title: 'Earlier Brew chat (whole organisation)', source: 'shared', provider: '', status: 'done', createdAt: ms(shared.display[0].at), updatedAt: ms(shared.display.at(-1).at), posts: 0 });
  }
  return list;
}

/**
 * One conversation for the dashboard. `continues` is true for the person's own Brew chats; anything
 * else (an extension run, the older shared chat) is continued as a new chat seeded with its transcript.
 */
export async function getConversation(userId, id) {
  if (id === SHARED_ID) {
    const shared = await loadHistory();
    if (!shared.display.length) return null;
    return { id, source: 'shared', title: 'Earlier Brew chat (whole organisation)', continues: false, display: shared.display };
  }
  if (!ID.test(id)) return null;
  const run = (await loadExtensionRuns(userId)).runs.find((r) => r.id === id);
  if (!run) return null;
  if (run.source === 'dashboard') {
    const chat = await loadHistory(brewChatFile(userId, id));
    return { id, source: 'dashboard', title: run.title, provider: run.provider, continues: true, display: chat.display, run };
  }
  return { id, source: 'extension', title: run.title, provider: run.provider, continues: false, display: runDisplay(run), run };
}

/** The transcript a new Brew chat starts from, or '' when there is nothing to continue. */
export async function conversationTranscript(userId, id) {
  if (id === SHARED_ID) {
    const shared = await loadHistory();
    return runTranscript({ steps: brewRunSummary('shared', shared, 'done')?.steps || [], posts: [] });
  }
  const found = await getConversation(userId, id);
  return found?.run ? runTranscript(found.run) : '';
}

export async function deleteConversation(userId, id) {
  if (!ID.test(id) || id === SHARED_ID) return;
  await mergeExtensionRuns(userId, { runs: [], deleted: [id] });
  await removeBrewChat(userId, id).catch(() => {});
}
