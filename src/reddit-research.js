import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { orgDataDir } from './context.js';
import { readJson, updateJson } from './store.js';
import { redditApi, redditApiConnected, redditFullname, subredditName } from './reddit.js';
import { intentSignals, redditSkill, REDDIT_SKILLS } from './reddit-skills.js';

// Reddit research: searching public posts for people who need what the organisation makes, reading
// threads and user activity, and keeping the leads found (reddit-leads.json, one list per
// organisation). Reading goes through the connected Reddit account's `read` scope. Without API keys
// every search returns Reddit's own search URL instead, and the Chrome extension can research in
// the person's own tabs. Nothing here messages anyone.

const SORTS = new Set(['relevance', 'hot', 'top', 'new', 'comments']);
const TIMES = new Set(['hour', 'day', 'week', 'month', 'year', 'all']);
export const LEAD_STATUSES = ['new', 'engaged', 'won', 'dismissed'];
const FITS = new Set(['high', 'medium', 'low']);
const MAX_LEADS = 2000;

function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const text = (value, max) => String(value ?? '').trim().slice(0, max);
const leadsFile = () => path.join(orgDataDir(), 'reddit-leads.json');

export function redditUsername(value) {
  const name = String(value || '').trim().replace(/^https?:\/\/(www\.|old\.)?reddit\.com/i, '').replace(/^\/?u(ser)?\//i, '').replace(/\/.*$/, '');
  if (!/^[A-Za-z0-9_-]{3,20}$/.test(name)) throw fail('Give a Reddit username like u/spez.');
  return name;
}

function permalink(value) {
  const link = String(value || '');
  return link.startsWith('/') ? `https://www.reddit.com${link}` : '';
}

function iso(seconds) {
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : '';
}

function searchUrl({ query, subreddit, sort, time }) {
  const params = new URLSearchParams({ q: query, sort, t: time });
  if (subreddit) params.set('restrict_sr', 'on');
  return `https://www.reddit.com${subreddit ? `/r/${subreddit}` : ''}/search/?${params}`;
}

function shapePost(item) {
  const author = item.author && item.author !== '[deleted]' ? item.author : '';
  return {
    id: item.name || '',
    subreddit: item.subreddit || '',
    title: item.title || '',
    author,
    url: permalink(item.permalink),
    excerpt: text(item.selftext, 600),
    score: Number.isFinite(item.score) ? item.score : null,
    comments: Number.isFinite(item.num_comments) ? item.num_comments : null,
    createdAt: iso(item.created_utc),
    flair: item.link_flair_text || '',
    locked: Boolean(item.locked || item.archived),
    signals: intentSignals(item.title, item.selftext),
  };
}

function shapeComment(item) {
  return {
    id: item.name || '',
    author: item.author && item.author !== '[deleted]' ? item.author : '',
    text: text(item.body, 800),
    score: Number.isFinite(item.score) ? item.score : null,
    url: permalink(item.permalink),
    createdAt: iso(item.created_utc),
    signals: intentSignals(item.body),
  };
}

async function needsApi(manual) {
  if (await redditApiConnected()) return null;
  return {
    manual: true,
    ...manual,
    note: 'Reddit API keys are not connected, so Socialbrewery cannot read Reddit here. Open the link to see the results on Reddit, or use the Socialbrewery Chrome extension, which researches in the person\'s own browser.',
  };
}

export async function searchReddit({ query, subreddit, sort, time, limit } = {}) {
  const q = text(query, 512);
  if (!q) throw fail('Give something to search for.');
  const sr = subreddit ? subredditName(subreddit) : '';
  const order = SORTS.has(sort) ? sort : 'relevance';
  const window = TIMES.has(time) ? time : 'month';
  const manual = await needsApi({ searchUrl: searchUrl({ query: q, subreddit: sr, sort: order, time: window }) });
  if (manual) return manual;
  const data = await redditApi('GET', sr ? `/r/${sr}/search` : '/search', {
    q,
    sort: order,
    t: window,
    type: 'link',
    restrict_sr: sr ? 'true' : undefined,
    limit: Math.min(50, Math.max(1, Number(limit) || 25)),
  });
  const posts = (data.data?.children || []).filter((c) => c.kind === 't3').map((c) => shapePost(c.data)).filter((p) => p.url);
  // Posts with buying signals first, then Reddit's own order.
  const ranked = posts.map((p, i) => ({ p, i })).sort((a, b) => b.p.signals.length - a.p.signals.length || a.i - b.i).map(({ p }) => p);
  return { query: q, subreddit: sr, sort: order, time: window, posts: ranked };
}

export async function findSubreddits({ query, limit } = {}) {
  const q = text(query, 200);
  if (!q) throw fail('Give a topic to find communities for.');
  const manual = await needsApi({ searchUrl: `https://www.reddit.com/search/?${new URLSearchParams({ q, type: 'communities' })}` });
  if (manual) return manual;
  const data = await redditApi('GET', '/subreddits/search', { q, limit: Math.min(25, Math.max(1, Number(limit) || 10)) });
  return {
    query: q,
    subreddits: (data.data?.children || []).map(({ data: sr }) => ({
      name: sr.display_name,
      title: sr.title || '',
      description: text(sr.public_description, 300),
      subscribers: Number.isFinite(sr.subscribers) ? sr.subscribers : null,
      nsfw: Boolean(sr.over18),
      restricted: sr.subreddit_type === 'restricted' || sr.subreddit_type === 'private',
      url: `https://www.reddit.com/r/${sr.display_name}/`,
    })).filter((sr) => sr.name && !sr.nsfw),
  };
}

export async function getRedditThread({ post, limit } = {}) {
  const id = redditFullname(post);
  if (!id.startsWith('t3_')) throw fail('Give the link of a Reddit post, not a comment.');
  const manual = await needsApi({ url: `https://www.reddit.com/comments/${id.slice(3)}/` });
  if (manual) return manual;
  const data = await redditApi('GET', `/comments/${id.slice(3)}`, { limit: Math.min(100, Math.max(1, Number(limit) || 40)), depth: 2, sort: 'top' });
  const postData = data?.[0]?.data?.children?.[0]?.data;
  if (!postData) throw fail('Reddit could not find that post.', 404);
  const comments = [];
  const walk = (children, depth) => {
    for (const child of children || []) {
      if (child.kind !== 't1') continue;
      comments.push({ ...shapeComment(child.data), depth });
      if (child.data.replies?.data?.children) walk(child.data.replies.data.children, depth + 1);
    }
  };
  walk(data?.[1]?.data?.children, 0);
  return { post: shapePost(postData), comments: comments.filter((c) => c.author).slice(0, 100) };
}

export async function researchRedditUser({ username, limit } = {}) {
  const name = redditUsername(username);
  const manual = await needsApi({ url: `https://www.reddit.com/user/${name}/` });
  if (manual) return manual;
  const count = Math.min(100, Math.max(5, Number(limit) || 40));
  const [about, submitted, comments] = await Promise.all([
    redditApi('GET', `/user/${name}/about`),
    redditApi('GET', `/user/${name}/submitted`, { limit: count, sort: 'new' }).catch(() => ({ data: { children: [] } })),
    redditApi('GET', `/user/${name}/comments`, { limit: count, sort: 'new' }).catch(() => ({ data: { children: [] } })),
  ]);
  const user = about.data || {};
  if (user.is_suspended) return { username: name, suspended: true };
  const posts = (submitted.data?.children || []).map((c) => shapePost(c.data)).filter((p) => p.url);
  const replies = (comments.data?.children || []).map((c) => ({ ...shapeComment(c.data), subreddit: c.data.subreddit || '', postTitle: c.data.link_title || '' }));
  const activity = {};
  for (const item of [...posts, ...replies]) if (item.subreddit) activity[item.subreddit] = (activity[item.subreddit] || 0) + 1;
  return {
    username: user.name || name,
    url: `https://www.reddit.com/user/${user.name || name}/`,
    createdAt: iso(user.created_utc),
    karma: Number(user.total_karma ?? (user.link_karma || 0) + (user.comment_karma || 0)),
    activeIn: Object.entries(activity).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([subreddit, items]) => ({ subreddit, items })),
    posts: posts.slice(0, 25).map(({ id, subreddit, title, url, excerpt, createdAt, signals }) => ({ id, subreddit, title, url, excerpt: excerpt.slice(0, 300), createdAt, signals })),
    comments: replies.slice(0, 40).map(({ subreddit, postTitle, text: body, url, createdAt, signals }) => ({ subreddit, postTitle, text: body.slice(0, 300), url, createdAt, signals })),
  };
}

// ---------- leads ----------

function redditLink(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^https:\/\/(?:www\.|old\.|new\.)?reddit\.com(\/r\/[A-Za-z0-9_]{2,21}\/comments\/[a-z0-9]+(?:\/[^?#\s]*)?)/i);
  return match ? `https://www.reddit.com${match[1]}`.slice(0, 500) : '';
}

function postIdOf(link) {
  return link.match(/\/comments\/([a-z0-9]+)/i)?.[1]?.toLowerCase() || '';
}

export function leadKey(lead) {
  return `${String(lead.username || '').toLowerCase()}|${postIdOf(lead.postUrl || '')}`;
}

// Validates one lead from a tool, the dashboard, or the extension. Returns null when it is unusable.
export function cleanLead(input, source = 'manual') {
  let username;
  try {
    username = redditUsername(input?.username);
  } catch {
    return null;
  }
  const postUrl = redditLink(input?.postUrl || input?.url);
  const subreddit = (() => {
    try {
      return input?.subreddit ? subredditName(input.subreddit) : postUrl.match(/\/r\/([^/]+)/)?.[1] || '';
    } catch {
      return '';
    }
  })();
  const signals = (Array.isArray(input?.signals) ? input.signals : []).map((s) => text(s, 60)).filter(Boolean).slice(0, 8);
  return {
    username,
    subreddit,
    postUrl,
    postTitle: text(input?.postTitle || input?.title, 300),
    excerpt: text(input?.excerpt, 600),
    fit: FITS.has(input?.fit) ? input.fit : 'medium',
    reason: text(input?.reason, 500),
    signals: signals.length ? signals : intentSignals(input?.postTitle || input?.title, input?.excerpt),
    status: LEAD_STATUSES.includes(input?.status) ? input.status : 'new',
    notes: text(input?.notes, 1000),
    source: ['extension', 'agent', 'grok', 'claude', 'dashboard', 'manual'].includes(source) ? source : 'manual',
  };
}

export async function listRedditLeads({ status, subreddit, fit } = {}) {
  const leads = await readJson(leadsFile(), []);
  return (Array.isArray(leads) ? leads : []).filter(
    (l) => (!status || l.status === status) && (!fit || l.fit === fit) && (!subreddit || l.subreddit.toLowerCase() === String(subreddit).replace(/^\/?r\//i, '').toLowerCase()),
  );
}

// Adds leads, or updates the saved copy of the same person and post. An incoming lead never moves a
// lead back to "new", and the newer copy wins when both sides changed (the extension sends its own
// updatedAt).
export async function saveRedditLeads(items, source = 'manual') {
  const incoming = (Array.isArray(items) ? items : [items]).slice(0, 200);
  const cleaned = incoming.map((item) => ({ lead: cleanLead(item, source), updatedAt: Number(item?.updatedAt) || 0 })).filter((x) => x.lead);
  if (!cleaned.length) throw fail('Each lead needs a Reddit username and, ideally, the link of the post that made them a lead.');
  let added = 0;
  let updated = 0;
  const now = Date.now();
  const saved = [];
  await updateJson(leadsFile(), [], (current) => {
    const list = Array.isArray(current) ? current : [];
    const byKey = new Map(list.map((l) => [leadKey(l), l]));
    for (const { lead, updatedAt } of cleaned) {
      const key = leadKey(lead);
      const existing = byKey.get(key);
      if (!existing) {
        const record = { id: randomBytes(8).toString('hex'), ...lead, createdAt: new Date(now).toISOString(), updatedAt: updatedAt || now };
        list.unshift(record);
        byKey.set(key, record);
        saved.push(record);
        added++;
        continue;
      }
      if (updatedAt && updatedAt < (existing.updatedAt || 0)) {
        saved.push(existing);
        continue;
      }
      const status = lead.status === 'new' && existing.status !== 'new' ? existing.status : lead.status;
      Object.assign(existing, {
        ...lead,
        status,
        postTitle: lead.postTitle || existing.postTitle,
        excerpt: lead.excerpt || existing.excerpt,
        reason: lead.reason || existing.reason,
        notes: lead.notes || existing.notes,
        source: existing.source,
        updatedAt: updatedAt || now,
      });
      saved.push(existing);
      updated++;
    }
    return list.slice(0, MAX_LEADS);
  });
  return { added, updated, leads: saved };
}

export async function updateRedditLead(id, patch = {}) {
  const leadId = String(id || '');
  let found = null;
  await updateJson(leadsFile(), [], (current) => {
    const list = Array.isArray(current) ? current : [];
    const lead = list.find((l) => l.id === leadId);
    if (!lead) return list;
    if (patch.status !== undefined) {
      if (!LEAD_STATUSES.includes(patch.status)) throw fail(`Status must be one of ${LEAD_STATUSES.join(', ')}.`);
      lead.status = patch.status;
    }
    if (patch.fit !== undefined) {
      if (!FITS.has(patch.fit)) throw fail('Fit must be high, medium, or low.');
      lead.fit = patch.fit;
    }
    if (patch.reason !== undefined) lead.reason = text(patch.reason, 500);
    if (patch.notes !== undefined) lead.notes = text(patch.notes, 1000);
    lead.updatedAt = Date.now();
    found = lead;
    return list;
  });
  if (!found) throw fail('No saved lead with that id.', 404);
  return found;
}

export async function deleteRedditLead(id) {
  let removed = false;
  await updateJson(leadsFile(), [], (current) => {
    const list = Array.isArray(current) ? current : [];
    const next = list.filter((l) => l.id !== id);
    removed = next.length !== list.length;
    return next;
  });
  if (!removed) throw fail('No saved lead with that id.', 404);
  return { deleted: true, id };
}

// ---------- connector and Brew tools ----------

const LEAD_FIELDS = {
  username: { type: 'string', description: 'Reddit username, without u/.' },
  subreddit: { type: 'string' },
  postUrl: { type: 'string', description: 'Link of the post or comment that makes them a lead.' },
  postTitle: { type: 'string' },
  excerpt: { type: 'string', description: 'A short quote of what they wrote (from the tool result, never invented).' },
  fit: { type: 'string', enum: ['high', 'medium', 'low'] },
  reason: { type: 'string', description: 'One sentence: why they are a fit.' },
  signals: { type: 'array', items: { type: 'string' } },
  notes: { type: 'string' },
};

export const REDDIT_RESEARCH_TOOLS = [
  {
    name: 'get_research_skill',
    description: `Read a research skill: the method and limits to follow. Read reddit-lead-research before looking for leads, and reddit-user-research before judging one user. Skills: ${Object.entries(REDDIT_SKILLS).map(([k, s]) => `${k} (${s.summary})`).join('; ')}`,
    inputSchema: { type: 'object', additionalProperties: false, properties: { name: { type: 'string', enum: Object.keys(REDDIT_SKILLS) } }, required: ['name'] },
  },
  {
    name: 'find_subreddits',
    description: 'Find Reddit communities about a topic, with subscriber counts, to choose where to research or post.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { query: { type: 'string' }, limit: { type: 'integer', description: '1 to 25, default 10.' } }, required: ['query'] },
  },
  {
    name: 'search_reddit',
    description: 'Search public Reddit posts, across Reddit or in one subreddit. Results carry intent signals (asks for a recommendation, wants an alternative, pain point, buying, how-to) and come with the strongest signals first. Without Reddit API keys it returns a searchUrl instead.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Reddit search query, e.g. "alternative to Hootsuite".' },
        subreddit: { type: 'string', description: 'Optional: search only this subreddit.' },
        sort: { type: 'string', enum: [...SORTS] },
        time: { type: 'string', enum: [...TIMES], description: 'Default month.' },
        limit: { type: 'integer', description: '1 to 50, default 25.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_reddit_thread',
    description: 'Read a Reddit post and its top comments, to qualify the poster and find other people in the thread with the same need.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { post: { type: 'string', description: 'Post link or t3_ id.' }, limit: { type: 'integer' } }, required: ['post'] },
  },
  {
    name: 'research_reddit_user',
    description: "Read one Reddit user's public profile and recent posts and comments: account age, karma, where they are active, and what they asked. For judging a lead; follow the reddit-user-research skill.",
    inputSchema: { type: 'object', additionalProperties: false, properties: { username: { type: 'string' }, limit: { type: 'integer', description: 'Recent items to read, 5 to 100.' } }, required: ['username'] },
  },
  {
    name: 'save_reddit_leads',
    description: 'Save qualified Reddit leads to the organisation\'s lead list. The same user and post again updates the saved lead.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { leads: { type: 'array', items: { type: 'object', additionalProperties: false, properties: LEAD_FIELDS, required: ['username', 'reason'] } } },
      required: ['leads'],
    },
  },
  {
    name: 'list_reddit_leads',
    description: 'List saved Reddit leads, optionally filtered.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { status: { type: 'string', enum: LEAD_STATUSES }, fit: { type: 'string', enum: [...FITS] }, subreddit: { type: 'string' }, limit: { type: 'integer' } },
    },
  },
  {
    name: 'update_reddit_lead',
    description: 'Change a saved lead: status (new, engaged after a public reply, won, dismissed), fit, reason, or notes.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { id: { type: 'string' }, status: { type: 'string', enum: LEAD_STATUSES }, fit: { type: 'string', enum: [...FITS] }, reason: { type: 'string' }, notes: { type: 'string' } },
      required: ['id'],
    },
  },
];

export const REDDIT_RESEARCH_TOOL_NAMES = new Set(REDDIT_RESEARCH_TOOLS.map((t) => t.name));

export async function runRedditResearchTool(name, args = {}, source = 'agent') {
  if (name === 'get_research_skill') return redditSkill(args.name).text;
  if (name === 'find_subreddits') return findSubreddits(args);
  if (name === 'search_reddit') return searchReddit(args);
  if (name === 'get_reddit_thread') return getRedditThread(args);
  if (name === 'research_reddit_user') return researchRedditUser(args);
  if (name === 'save_reddit_leads') {
    const result = await saveRedditLeads(args.leads, source);
    return { added: result.added, updated: result.updated, ids: result.leads.map((l) => l.id) };
  }
  if (name === 'list_reddit_leads') {
    const leads = await listRedditLeads(args);
    return { total: leads.length, leads: leads.slice(0, Math.min(200, Math.max(1, Number(args.limit) || 50))) };
  }
  if (name === 'update_reddit_lead') {
    const { id, ...patch } = args;
    return updateRedditLead(id, patch);
  }
  throw new Error(`Unknown tool: ${name}`);
}
