import { randomBytes, timingSafeEqual } from 'node:crypto';
import { appUrl } from './env.js';
import {
  addPost,
  clearNetworkToken,
  clearOauthState,
  listPosts,
  readNetworkToken,
  readOauthState,
  writeNetworkToken,
  writeOauthState,
} from './store.js';
import { cfg } from './context.js';

const SCOPES = 'identity submit read mysubreddits flair edit';
const OAUTH = 'https://oauth.reddit.com';

const SUBMIT_ERRORS = {
  SUBREDDIT_NOEXIST: 'That subreddit does not exist.',
  SUBREDDIT_NOTALLOWED: 'You are not allowed to post in that subreddit (it may be private or restricted).',
  NO_SELFS: 'That subreddit only allows link posts. Add a URL instead of text.',
  NO_LINKS: 'That subreddit only allows text posts. Remove the URL and write the post as text.',
  SUBMIT_VALIDATION_FLAIR_REQUIRED: 'That subreddit requires a post flair. Pick one and try again.',
  BAD_SR_NAME: 'That is not a valid subreddit name.',
  TOO_LONG: 'Part of the post is too long for Reddit.',
  NO_TEXT: 'Reddit needs a title.',
  BAD_URL: 'That link is not a valid URL.',
  BANNED_FROM_SUBREDDIT: 'This account is banned from that subreddit.',
};

export function redditRedirectUri() {
  return `${appUrl()}/api/reddit/callback`;
}

function clientConfig() {
  const clientId = cfg.REDDIT_CLIENT_ID;
  const clientSecret = cfg.REDDIT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Add the Reddit client ID and secret in Settings (an organisation admin can do this).');
  }
  return { clientId, clientSecret };
}

function basicAuth() {
  const { clientId, clientSecret } = clientConfig();
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

function userAgent(username) {
  return `web:socialbrewery:0.3 (by /u/${username || 'socialbrewery'})`;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function unescapeUrl(value) {
  const url = String(value || '').replace(/&amp;/g, '&');
  return url.startsWith('https:') ? url : '';
}

export async function beginRedditConnect() {
  const { clientId } = clientConfig();
  const state = randomBytes(24).toString('hex');
  await writeOauthState({ state, exp: Date.now() + 15 * 60 * 1000 }, 'reddit');
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    state,
    redirect_uri: redditRedirectUri(),
    duration: 'permanent',
    scope: SCOPES,
  });
  return `https://www.reddit.com/api/v1/authorize?${params}`;
}

async function tokenRequest(params) {
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: basicAuth(),
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': userAgent(),
    },
    body: new URLSearchParams(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const reason = data.error === 'invalid_grant' ? 'Reddit login expired.' : data.message || data.error || 'Reddit did not return a token.';
    const err = new Error(`${reason} Connect Reddit again.`);
    err.status = 400;
    throw err;
  }
  return data;
}

export async function finishRedditConnect(code, state) {
  const saved = await readOauthState('reddit');
  await clearOauthState('reddit');
  if (!saved || !safeEqual(saved.state, state) || saved.exp < Date.now()) {
    throw new Error('That Reddit connection expired. Try Connect again.');
  }
  const token = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redditRedirectUri() });
  const res = await fetch(`${OAUTH}/api/v1/me?raw_json=1`, {
    headers: { Authorization: `bearer ${token.access_token}`, 'User-Agent': userAgent() },
  });
  const me = await res.json().catch(() => ({}));
  if (!res.ok || !me.name) throw new Error('Reddit did not return your account.');
  const account = {
    id: me.id || '',
    username: me.name,
    title: `u/${me.name}`,
    picture: unescapeUrl(me.icon_img || me.snoovatar_img),
    karma: Number(me.total_karma ?? (me.link_karma || 0) + (me.comment_karma || 0)),
  };
  await writeNetworkToken('reddit', {
    access_token: token.access_token,
    refresh_token: token.refresh_token || '',
    expires_at: Date.now() + (token.expires_in ?? 3600) * 1000,
    scope: token.scope || '',
    account,
  });
  return account;
}

export async function redditStatus() {
  const token = await readNetworkToken('reddit');
  if (!token?.refresh_token && !token?.access_token) return { connected: false, account: null };
  return { connected: Boolean(token.account), account: token.account || null };
}

export async function disconnectReddit() {
  const token = await readNetworkToken('reddit');
  if (token?.refresh_token) {
    try {
      await fetch('https://www.reddit.com/api/v1/revoke_token', {
        method: 'POST',
        headers: { Authorization: basicAuth(), 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': userAgent() },
        body: new URLSearchParams({ token: token.refresh_token, token_type_hint: 'refresh_token' }),
      });
    } catch {
      // Revoking is best effort; the local token is removed either way.
    }
  }
  await clearNetworkToken('reddit');
}

async function session() {
  const token = await readNetworkToken('reddit');
  if (!token?.access_token && !token?.refresh_token) {
    const err = new Error('Connect Reddit on the Connectors page first.');
    err.status = 400;
    throw err;
  }
  if (token.access_token && token.expires_at > Date.now() + 60_000) {
    return { access: token.access_token, username: token.account?.username || '' };
  }
  if (!token.refresh_token) {
    const err = new Error('Reddit login expired. Connect Reddit again.');
    err.status = 400;
    throw err;
  }
  const fresh = await tokenRequest({ grant_type: 'refresh_token', refresh_token: token.refresh_token });
  token.access_token = fresh.access_token;
  token.expires_at = Date.now() + (fresh.expires_in ?? 3600) * 1000;
  if (fresh.refresh_token) token.refresh_token = fresh.refresh_token;
  await writeNetworkToken('reddit', token);
  return { access: token.access_token, username: token.account?.username || '' };
}

export async function redditApi(method, path, params = {}) {
  const { access, username } = await session();
  const url = new URL(`${OAUTH}${path}`);
  const init = {
    method,
    headers: { Authorization: `bearer ${access}`, 'User-Agent': userAgent(username) },
  };
  if (method === 'GET') {
    url.searchParams.set('raw_json', '1');
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
  } else {
    const body = new URLSearchParams({ api_type: 'json' });
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') body.set(key, String(value));
    }
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = body;
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  const err = redditError(res.status, data);
  if (err) throw err;
  return data;
}

export function redditError(status, data = {}) {
  if (status < 200 || status >= 300) {
    let message = data.message || data.reason || `Reddit request failed (${status}).`;
    if (status === 401) message = 'Reddit rejected the login. Connect Reddit again.';
    else if (status === 403) message = 'Reddit refused that request. The subreddit may be private, or this account may be banned there.';
    else if (status === 404) message = 'Reddit could not find that subreddit or post.';
    else if (status === 429) message = 'Reddit is rate limiting this account. Wait a few minutes and try again.';
    const err = new Error(message);
    err.status = status >= 500 ? 502 : 400;
    return err;
  }
  const errors = data.json?.errors || [];
  if (!errors.length) return null;
  const [code, text] = errors[0];
  let message = SUBMIT_ERRORS[code] || text || code;
  if (code === 'RATELIMIT') message = `Reddit says you are posting too often: ${text}`;
  const err = new Error(message);
  err.code = code;
  err.status = 400;
  return err;
}

export function subredditName(value) {
  const name = String(value || '').trim().replace(/^https?:\/\/(www\.|old\.)?reddit\.com/i, '').replace(/^\/?r\//i, '').replace(/\/.*$/, '');
  if (!/^[A-Za-z0-9_]{2,21}$/.test(name)) throw new Error('Give a subreddit name like r/selfhosted.');
  return name;
}

export function redditFullname(value) {
  const raw = String(value || '').trim();
  const fullname = raw.match(/^t[13]_[a-z0-9]+$/i);
  if (fullname) return raw.toLowerCase();
  const link = raw.match(/\/comments\/([a-z0-9]+)(?:\/[^/]*\/([a-z0-9]+))?/i);
  if (link) return link[2] ? `t1_${link[2].toLowerCase()}` : `t3_${link[1].toLowerCase()}`;
  if (/^[a-z0-9]{5,10}$/i.test(raw)) return `t3_${raw.toLowerCase()}`;
  throw new Error('Give the Reddit post link or id.');
}

export async function redditApiConnected() {
  const token = await readNetworkToken('reddit');
  return Boolean(token?.access_token || token?.refresh_token);
}

// Reddit's own submit page accepts these query params, so posting works without API keys.
export function redditSubmitUrl({ subreddit, title, text, url }) {
  const sr = subredditName(subreddit);
  const link = String(url || '').trim();
  const params = new URLSearchParams({ type: link ? 'LINK' : 'TEXT', title: String(title || '').trim().slice(0, 300) });
  if (link) params.set('url', link);
  else if (String(text || '').trim()) params.set('text', String(text).trim());
  return `https://www.reddit.com/r/${sr}/submit?${params}`;
}

export function redditRulesUrl(subreddit) {
  return `https://www.reddit.com/r/${subredditName(subreddit)}/about/rules`;
}

export async function trackRedditPost({ link, title, text }) {
  const raw = String(link || '').trim();
  const match = raw.match(/^https:\/\/(?:www\.|old\.|new\.)?reddit\.com\/r\/([A-Za-z0-9_]{2,21})\/comments\/([a-z0-9]+)(?:\/([^/?#]*))?/i);
  if (!match) throw new Error('Paste the link of your Reddit post, like https://www.reddit.com/r/selfhosted/comments/abc123/…');
  const [, sr, id, slug] = match;
  const posts = await listPosts();
  const existing = posts.find((p) => p.network === 'reddit' && p.redditId === `t3_${id.toLowerCase()}`);
  if (existing) return existing;
  const post = {
    id: randomBytes(8).toString('hex'),
    network: 'reddit',
    title: String(title || '').trim() || (slug ? slug.replace(/_/g, ' ') : `Post in r/${sr}`),
    description: String(text || '').trim(),
    redditId: `t3_${id.toLowerCase()}`,
    subreddit: sr,
    url: `https://www.reddit.com/r/${sr}/comments/${id}/${slug || ''}`,
    createdAt: new Date().toISOString(),
    source: 'manual',
  };
  await addPost(post);
  return post;
}

export async function listRedditSubreddits() {
  const data = await redditApi('GET', '/subreddits/mine/subscriber', { limit: 100 });
  return (data.data?.children || [])
    .map(({ data: sr }) => ({
      name: sr.display_name,
      title: sr.title || '',
      subscribers: Number.isFinite(sr.subscribers) ? sr.subscribers : null,
      submissionType: sr.submission_type || 'any',
      nsfw: Boolean(sr.over18),
      icon: unescapeUrl(sr.community_icon || sr.icon_img),
    }))
    .sort((a, b) => (b.subscribers || 0) - (a.subscribers || 0));
}

export async function subredditDetails(value) {
  const name = subredditName(value);
  const [about, rules, flairs] = await Promise.all([
    redditApi('GET', `/r/${name}/about`),
    redditApi('GET', `/r/${name}/about/rules`).catch(() => ({ rules: [] })),
    redditApi('GET', `/r/${name}/api/link_flair_v2`).catch(() => []),
  ]);
  const sr = about.data || {};
  return {
    name: sr.display_name || name,
    title: sr.title || '',
    subscribers: Number.isFinite(sr.subscribers) ? sr.subscribers : null,
    submissionType: sr.submission_type || 'any',
    nsfw: Boolean(sr.over18),
    banned: Boolean(sr.user_is_banned),
    restricted: sr.subreddit_type === 'restricted' || sr.subreddit_type === 'private',
    rules: (rules.rules || []).map((rule) => ({
      title: rule.short_name || '',
      description: String(rule.description || '').slice(0, 600),
    })),
    flairs: (Array.isArray(flairs) ? flairs : [])
      .filter((flair) => !flair.mod_only)
      .map((flair) => ({ id: flair.id, text: flair.text || '' })),
  };
}

export async function submitReddit({ subreddit, title, text, url, flairId, flairText, nsfw, spoiler, source }) {
  const sr = subredditName(subreddit);
  const cleanTitle = String(title || '').trim();
  if (!cleanTitle) throw new Error('Reddit needs a title.');
  if (cleanTitle.length > 300) throw new Error('Reddit titles are 300 characters at most.');
  const link = String(url || '').trim();
  if (link && !/^https?:\/\/\S+$/i.test(link)) throw new Error('That link is not a valid URL.');
  const body = String(text || '').trim();
  if (body.length > 40000) throw new Error('Reddit text posts are 40,000 characters at most.');
  const data = await redditApi('POST', '/api/submit', {
    sr,
    kind: link ? 'link' : 'self',
    title: cleanTitle,
    url: link || undefined,
    text: link ? undefined : body,
    flair_id: flairId,
    flair_text: flairId ? flairText : undefined,
    nsfw: nsfw ? 'true' : undefined,
    spoiler: spoiler ? 'true' : undefined,
    sendreplies: 'true',
    resubmit: 'true',
  });
  const result = data.json?.data || {};
  const post = {
    id: randomBytes(8).toString('hex'),
    network: 'reddit',
    title: cleanTitle,
    description: link ? `${link}${body ? `\n\n${body}` : ''}` : body,
    redditId: result.name || (result.id ? `t3_${result.id}` : ''),
    subreddit: sr,
    url: typeof result.url === 'string' && result.url.startsWith('https:') ? result.url : '',
    createdAt: new Date().toISOString(),
    source: source || 'manual',
  };
  await addPost(post);
  return post;
}

export async function commentReddit({ post, text }) {
  const body = String(text || '').trim();
  if (!body) throw new Error('Reddit needs comment text.');
  const data = await redditApi('POST', '/api/comment', { thing_id: redditFullname(post), text: body.slice(0, 10000) });
  const thing = data.json?.data?.things?.[0]?.data || {};
  return { id: thing.name || '', url: thing.permalink ? `https://www.reddit.com${thing.permalink}` : '' };
}

export async function deleteReddit(post) {
  const id = redditFullname(post);
  await redditApi('POST', '/api/del', { id });
  return { deleted: true, id };
}

export async function redditStats(limit = 25) {
  const posts = (await listPosts()).filter((p) => p.network === 'reddit' && p.redditId).slice(0, limit);
  if (!posts.length) return [];
  const data = await redditApi('GET', '/api/info', { id: posts.map((p) => p.redditId).join(',') });
  const live = new Map((data.data?.children || []).map(({ data: item }) => [item.name, item]));
  return posts.map((post) => {
    const item = live.get(post.redditId);
    return {
      id: post.id,
      redditId: post.redditId,
      title: post.title,
      subreddit: post.subreddit,
      url: item?.permalink ? `https://www.reddit.com${item.permalink}` : post.url || '',
      createdAt: post.createdAt,
      score: item ? item.score : null,
      upvoteRatio: item ? item.upvote_ratio : null,
      comments: item ? item.num_comments : null,
      removed: Boolean(item?.removed_by_category) || item?.selftext === '[removed]',
      deleted: !item || item.removed_by_category === 'deleted' || item.author === '[deleted]',
    };
  });
}
