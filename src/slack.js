import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { addPost, clearNetworkToken, getMedia, listPosts, mediaPath, readNetworkToken, writeNetworkToken } from './store.js';
import { cfg } from './context.js';
import { blobSize, readBlobRange } from './storage.js';

const API = 'https://slack.com/api';

export const SLACK_SCOPES = [
  'chat:write',
  'chat:write.public',
  'channels:read',
  'groups:read',
  'channels:join',
  'files:write',
  'reactions:read',
];

export const SLACK_MANIFEST = {
  display_information: {
    name: 'Socialbrewery',
    description: 'Posts updates, clips, and links from Socialbrewery.',
    background_color: '#5b5fc7',
  },
  features: { bot_user: { display_name: 'Socialbrewery', always_online: false } },
  oauth_config: { scopes: { bot: SLACK_SCOPES } },
  settings: { org_deploy_enabled: false, socket_mode_enabled: false, token_rotation_enabled: false },
};

const ERRORS = {
  invalid_auth: 'Slack rejected the bot token. Copy the Bot User OAuth Token (starts with xoxb-) again and reconnect.',
  not_authed: 'Slack rejected the bot token. Copy the Bot User OAuth Token (starts with xoxb-) again and reconnect.',
  account_inactive: 'That Slack app was uninstalled or the token was revoked. Reinstall it and paste the new token.',
  token_revoked: 'That Slack app was uninstalled or the token was revoked. Reinstall it and paste the new token.',
  channel_not_found: 'Slack cannot find that channel. For a private channel, invite the app first with /invite @Socialbrewery.',
  not_in_channel: 'The app is not in that channel. In Slack, run /invite @Socialbrewery in the channel and try again.',
  is_archived: 'That channel is archived.',
  msg_too_long: 'That message is too long for Slack.',
  restricted_action: 'This workspace does not let apps post in that channel.',
  ratelimited: 'Slack is rate limiting the app. Wait a minute and try again.',
};

function token() {
  const value = String(cfg.SLACK_BOT_TOKEN || '').trim();
  if (!value) {
    const err = new Error('Add the Slack bot token in Settings (an organisation admin can do this).');
    err.status = 400;
    throw err;
  }
  return value;
}

export async function slackApi(method, params = {}) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    body.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  }
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    const code = data.error || `http_${res.status}`;
    let message = ERRORS[code] || `Slack said: ${code}.`;
    if (code === 'missing_scope') {
      message = `The Slack app is missing the ${data.needed || 'required'} permission. Add it under OAuth & Permissions, reinstall the app, and paste the new token.`;
    }
    const err = new Error(message);
    err.code = code;
    err.status = res.status >= 500 ? 502 : 400;
    throw err;
  }
  return data;
}

export function slackText(value) {
  const tokens = [];
  const kept = String(value || '').replace(/<(?:https?:\/\/[^>\s]+|mailto:[^>\s]+|[@#!][^>\s]+)>/g, (match) => {
    tokens.push(match);
    return `\u0000${tokens.length - 1}\u0000`;
  });
  return kept
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)]);
}

export function parseSlackLink(value) {
  const raw = String(value || '').trim();
  const link = raw.match(/\/archives\/([A-Z0-9]+)\/p(\d{10})(\d{6})/);
  if (link) {
    const thread = raw.match(/[?&]thread_ts=(\d+\.\d+)/);
    return { channel: link[1], ts: thread ? thread[1] : `${link[2]}.${link[3]}` };
  }
  const pair = raw.match(/^([A-Z0-9]{8,}):(\d+\.\d+)$/);
  if (pair) return { channel: pair[1], ts: pair[2] };
  throw new Error('Give the Slack message link (Copy link in Slack).');
}

export async function connectSlack() {
  const auth = await slackApi('auth.test');
  let team = { name: auth.team || '', icon: '' };
  try {
    const info = await slackApi('team.info');
    const icon = info.team?.icon?.image_132 || info.team?.icon?.image_88 || '';
    team = { name: info.team?.name || team.name, icon: typeof icon === 'string' && icon.startsWith('https:') ? icon : '' };
  } catch {
    // team.info needs team:read; the name from auth.test is enough.
  }
  const account = {
    id: auth.team_id,
    title: team.name || 'Slack workspace',
    picture: team.icon,
    url: auth.url || '',
    botUserId: auth.user_id || '',
    botName: auth.user || '',
  };
  await writeNetworkToken('slack', { account, connectedAt: new Date().toISOString() });
  channelCache = null;
  return account;
}

export async function slackStatus() {
  const stored = await readNetworkToken('slack');
  return { connected: Boolean(cfg.SLACK_BOT_TOKEN && stored?.account?.id), account: stored?.account || null };
}

export async function disconnectSlack() {
  channelCache = null;
  await clearNetworkToken('slack');
}

async function requireConnected() {
  const status = await slackStatus();
  if (!status.connected) {
    const err = new Error('Connect Slack on the Connectors page first.');
    err.status = 400;
    throw err;
  }
  return status.account;
}

let channelCache = null;

export async function listSlackChannels({ fresh = false } = {}) {
  await requireConnected();
  if (!fresh && channelCache && channelCache.at > Date.now() - 60_000) return channelCache.list;
  const list = [];
  let cursor = '';
  for (let page = 0; page < 10; page += 1) {
    const data = await slackApi('conversations.list', {
      types: 'public_channel,private_channel',
      exclude_archived: true,
      limit: 200,
      cursor,
    });
    for (const channel of data.channels || []) {
      list.push({
        id: channel.id,
        name: channel.name || '',
        isPrivate: Boolean(channel.is_private),
        isMember: Boolean(channel.is_member),
        members: Number.isFinite(channel.num_members) ? channel.num_members : null,
      });
    }
    cursor = data.response_metadata?.next_cursor || '';
    if (!cursor) break;
  }
  list.sort((a, b) => Number(b.isMember) - Number(a.isMember) || a.name.localeCompare(b.name));
  channelCache = { at: Date.now(), list };
  return list;
}

export async function resolveSlackChannel(value) {
  const wanted = String(value || cfg.SLACK_DEFAULT_CHANNEL || '').trim();
  if (!wanted) throw new Error('Pick a Slack channel, or set a default channel in Settings.');
  const channels = await listSlackChannels();
  const id = wanted.match(/^[CG][A-Z0-9]{6,}$/) ? wanted : '';
  const name = wanted.replace(/^#/, '').toLowerCase();
  const found = channels.find((channel) => (id ? channel.id === id : channel.name.toLowerCase() === name));
  if (found) return found;
  if (id) return { id, name: '', isPrivate: false, isMember: false, members: null };
  const err = new Error(`Slack has no channel named #${name} that the app can see. Private channels need /invite @Socialbrewery first.`);
  err.status = 400;
  throw err;
}

async function ensureMember(channel) {
  if (channel.isMember || channel.isPrivate) return;
  await slackApi('conversations.join', { channel: channel.id });
  channel.isMember = true;
}

async function permalink(channel, ts) {
  try {
    const data = await slackApi('chat.getPermalink', { channel, message_ts: ts });
    return typeof data.permalink === 'string' && data.permalink.startsWith('https:') ? data.permalink : '';
  } catch {
    return '';
  }
}

async function uploadSlackFile({ channel, filePath, name, title, comment, threadTs }) {
  const size = await blobSize(filePath);
  if (!size) throw new Error('That video file is missing from storage.');
  const filename = path.basename(name || filePath).replace(/[\r\n"]/g, '') || 'clip.mp4';
  const ticket = await slackApi('files.getUploadURLExternal', { filename, length: size });
  const upload = await fetch(ticket.upload_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: await readBlobRange(filePath, 0, size - 1),
  });
  if (!upload.ok) throw new Error(`Slack did not accept the file upload (${upload.status}).`);
  const done = await slackApi('files.completeUploadExternal', {
    files: [{ id: ticket.file_id, title: String(title || filename).slice(0, 250) }],
    channel_id: channel,
    initial_comment: comment,
    thread_ts: threadTs,
  });
  const file = done.files?.[0] || {};
  const shares = { ...(file.shares?.public || {}), ...(file.shares?.private || {}) };
  const ts = shares[channel]?.[0]?.ts || '';
  const fileLink = typeof file.permalink === 'string' && file.permalink.startsWith('https:') ? file.permalink : '';
  return { ts, fileId: ticket.file_id, fileLink };
}

export async function postSlack({ channel, text, title, mediaId, threadTs, source, record = true }) {
  await requireConnected();
  const message = String(text || title || '').trim();
  if (!message && !mediaId) throw new Error('Slack needs message text or a video.');
  const target = await resolveSlackChannel(channel);
  await ensureMember(target);
  const body = slackText(message).slice(0, 39000);

  let ts = '';
  let url = '';
  if (mediaId) {
    const media = await getMedia(mediaId);
    if (!media) throw new Error('That video is not in the library.');
    const sent = await uploadSlackFile({
      channel: target.id,
      filePath: mediaPath(media),
      name: media.name,
      title: title || media.name,
      comment: body,
      threadTs,
    });
    ts = sent.ts;
    url = ts ? await permalink(target.id, ts) : sent.fileLink;
  } else {
    const sent = await slackApi('chat.postMessage', {
      channel: target.id,
      text: body,
      thread_ts: threadTs,
      unfurl_links: true,
      unfurl_media: true,
    });
    ts = sent.ts || '';
    url = ts ? await permalink(target.id, ts) : '';
  }

  const post = {
    id: randomBytes(8).toString('hex'),
    network: 'slack',
    mediaId: mediaId || '',
    title: String(title || message).slice(0, 200),
    description: message,
    slackChannel: target.id,
    slackChannelName: target.name,
    slackTs: ts,
    threadTs: threadTs || '',
    url,
    createdAt: new Date().toISOString(),
    source: source || 'manual',
  };
  if (record) await addPost(post);
  return post;
}

export async function replySlack({ post, text, mediaId }) {
  const { channel, ts } = parseSlackLink(post);
  const reply = await postSlack({ channel, text, mediaId, threadTs: ts, source: 'reply', record: false });
  return { slackTs: reply.slackTs, url: reply.url, channel: reply.slackChannelName || channel };
}

export async function slackStats(limit = 20) {
  await requireConnected();
  const posts = (await listPosts()).filter((p) => p.network === 'slack' && p.slackTs && p.slackChannel).slice(0, limit);
  const results = [];
  for (const post of posts) {
    const row = {
      id: post.id,
      title: post.title,
      url: post.url || '',
      channel: post.slackChannelName || post.slackChannel,
      createdAt: post.createdAt,
      reactions: null,
      replies: null,
      top: [],
    };
    try {
      const data = await slackApi('reactions.get', { channel: post.slackChannel, timestamp: post.slackTs, full: true });
      const reactions = data.message?.reactions || [];
      row.reactions = reactions.reduce((sum, r) => sum + (r.count || 0), 0);
      row.replies = Number(data.message?.reply_count || 0);
      row.top = reactions
        .sort((a, b) => (b.count || 0) - (a.count || 0))
        .slice(0, 3)
        .map((r) => ({ name: r.name, count: r.count || 0 }));
    } catch (err) {
      if (err.code === 'missing_scope' || err.code === 'invalid_auth') throw err;
    }
    results.push(row);
  }
  return results;
}
