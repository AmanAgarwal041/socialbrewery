import path from 'node:path';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { cfg, currentOrgId, orgDataDir, publicOrigin } from './context.js';
import { sha256, sign } from './secure.js';
import { readJson, readNetworkToken, updateJson } from './store.js';

export const WEBHOOK_FIELDS = ['comments', 'live_comments', 'messages', 'message_reactions', 'messaging_seen'];
const KEEP = 500;

function eventsFile() {
  return path.join(orgDataDir(), 'instagram-events.json');
}

// Derived instead of stored: it only has to match what the admin pasted into the Meta dashboard.
export function instagramVerifyToken(orgId = currentOrgId()) {
  return sign(`instagram-webhook:${orgId}`).slice(0, 32);
}

export function instagramWebhookUrl(orgId = currentOrgId()) {
  const origin = publicOrigin();
  return origin ? `${origin}/webhooks/instagram/${orgId}` : '';
}

export function verifyChallenge(params, orgId = currentOrgId()) {
  if (params.get('hub.mode') !== 'subscribe') return null;
  const given = Buffer.from(String(params.get('hub.verify_token') || ''));
  const expected = Buffer.from(instagramVerifyToken(orgId));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const challenge = String(params.get('hub.challenge') || '');
  return /^[\w-]{1,200}$/.test(challenge) ? challenge : null;
}

// Meta signs the exact bytes it sent with the app secret: X-Hub-Signature-256: sha256=<hex>.
export function validSignature(raw, header, secret = cfg.INSTAGRAM_APP_SECRET) {
  if (!secret) return false;
  const match = /^sha256=([a-f0-9]{64})$/i.exec(String(header || ''));
  if (!match) return false;
  const expected = createHmac('sha256', secret).update(raw).digest();
  const given = Buffer.from(match[1], 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function clip(value, max = 2000) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

export function summarizeEvents(payload) {
  const out = [];
  for (const entry of Array.isArray(payload?.entry) ? payload.entry : []) {
    const accountId = String(entry.id || '');
    const time = Number(entry.time) || 0;
    for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
      const value = change.value || {};
      out.push({
        field: clip(change.field, 60),
        accountId,
        time,
        from: clip(value.from?.username, 100) || clip(value.from?.id, 100),
        text: clip(value.text),
        mediaId: clip(value.media?.id, 100),
        commentId: clip(value.id, 100),
      });
    }
    for (const message of Array.isArray(entry.messaging) ? entry.messaging : []) {
      const field = message.reaction ? 'message_reactions' : message.read ? 'messaging_seen' : 'messages';
      out.push({
        field,
        accountId,
        time: Number(message.timestamp) || time,
        from: clip(message.sender?.id, 100),
        text: clip(message.message?.text) || clip(message.reaction?.emoji, 20),
        echo: Boolean(message.message?.is_echo),
        messageId: clip(message.message?.mid, 200),
      });
    }
  }
  return out.map((event) => ({ ...event, id: sha256(JSON.stringify(event)).slice(0, 24) }));
}

// Meta retries failed deliveries for 36 hours, so the same event can arrive more than once.
export async function recordInstagramEvents(payload) {
  const events = summarizeEvents(payload);
  if (!events.length) return 0;
  let added = 0;
  await updateJson(eventsFile(), [], (stored) => {
    const list = Array.isArray(stored) ? stored : [];
    const seen = new Set(list.map((event) => event.id));
    const receivedAt = new Date().toISOString();
    for (const event of events) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      list.unshift({ ...event, receivedAt });
      added += 1;
    }
    return list.slice(0, KEEP);
  });
  return added;
}

export async function listInstagramEvents(limit = 50) {
  const list = await readJson(eventsFile(), []);
  return Array.isArray(list) ? list.slice(0, limit) : [];
}

export async function subscribeInstagramWebhooks(fields = ['comments', 'messages']) {
  const token = await readNetworkToken('instagram');
  if (!token?.access_token) throw Object.assign(new Error('Connect Instagram first.'), { status: 400 });
  const wanted = fields.filter((field) => WEBHOOK_FIELDS.includes(field));
  if (!wanted.length) throw Object.assign(new Error('Pick at least one webhook field.'), { status: 400 });
  const url = new URL('https://graph.instagram.com/v25.0/me/subscribed_apps');
  url.searchParams.set('subscribed_fields', wanted.join(','));
  url.searchParams.set('access_token', token.access_token);
  const res = await fetch(url, { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success !== true) {
    const message = data.error?.message || `Instagram returned ${res.status}.`;
    const hint = /permission|scope/i.test(message)
      ? ' Reconnect Instagram so it grants comment and message access, and check the app has those permissions.'
      : '';
    throw Object.assign(new Error(`Instagram did not enable notifications: ${message}${hint}`), { status: 502 });
  }
  return wanted;
}
