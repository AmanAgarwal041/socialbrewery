import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function waitFor(fn, timeout, label) {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < timeout) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (err) {
      last = err.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${label}. ${last}`);
}

test('sessions, organisation roles, and the connector scope every request', { timeout: 25000 }, async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'socialbrewery-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  await fs.writeFile(path.join(temp, '.env'), `HOST=127.0.0.1\nPORT=${port}\nAPP_URL=${base}\n`);

  process.env.SOCIALBREWERY_HOME = temp;
  const accounts = await import('../src/accounts.js');
  const { ensureData } = await import('../src/store.js');
  await ensureData();
  const owner = await accounts.upsertUser({ provider: 'github', subject: '1', email: 'ada@example.com', name: 'Ada' });
  const member = await accounts.upsertUser({ provider: 'github', subject: '2', email: 'grace@example.com', name: 'Grace' });
  const org = await accounts.createOrg({ name: 'Brewery', ownerId: owner.id, config: { XAI_API_KEY: 'xai-secret-value', INSTAGRAM_APP_SECRET: 'ig-app-secret' } });
  const other = await accounts.createOrg({ name: 'Other', ownerId: member.id });
  const { token: invite } = await accounts.createInvite({ orgId: org.id, email: 'grace@example.com', role: 'member', invitedBy: owner.id, actorRole: 'owner' });
  await accounts.acceptInvites(member, invite);
  const ownerCookie = `sb_session=${(await accounts.createSession(owner.id, org.id)).token}`;
  const memberCookie = `sb_session=${(await accounts.createSession(member.id, org.id)).token}`;
  const connectorToken = (await accounts.loadOrgConfig(org.id)).CONNECTOR_TOKEN;
  const { instagramVerifyToken } = await import('../src/instagram-webhooks.js');
  const { createHmac } = await import('node:crypto');
  const verifyToken = instagramVerifyToken(org.id);

  let logs = '';
  const proc = spawn(process.execPath, ['src/server.js'], {
    cwd: root,
    env: { ...process.env, SOCIALBREWERY_HOME: temp },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  proc.stdout.on('data', (chunk) => {
    logs += chunk;
  });
  proc.stderr.on('data', (chunk) => {
    logs += chunk;
  });

  const as = (cookie, init = {}) => ({ ...init, headers: { Origin: base, 'Content-Type': 'application/json', ...(init.headers || {}), Cookie: cookie } });

  try {
    const health = await waitFor(async () => {
      const res = await fetch(`${base}/api/health`);
      return res.ok ? res.json() : null;
    }, 10000, `health\n${logs}`);
    assert.equal(health.authenticated, false);
    assert.equal(health.xai, undefined);

    const anon = await fetch(`${base}/api/session`).then((res) => res.json());
    assert.equal(anon.authenticated, false);
    assert.equal(anon.providers.github.enabled, false);
    assert.equal((await fetch(`${base}/api/posts`)).status, 401);
    assert.equal((await fetch(`${base}/api/settings`)).status, 401);

    const session = await fetch(`${base}/api/session`, as(ownerCookie)).then((res) => res.json());
    assert.equal(session.authenticated, true);
    assert.equal(session.org.id, org.id);
    assert.equal(session.orgs.length, 1);

    const signedIn = await fetch(`${base}/api/health`, as(ownerCookie)).then((res) => res.json());
    assert.equal(signedIn.xai, true);

    const settings = await fetch(`${base}/api/settings`, as(ownerCookie)).then((res) => res.json());
    const xai = settings.managed.find((field) => field.key === 'XAI_API_KEY');
    assert.equal(xai.value, '');
    assert.equal(xai.set, true);
    assert.equal(JSON.stringify(settings).includes('xai-secret-value'), false);

    const crossSite = await fetch(`${base}/api/settings`, as(ownerCookie, {
      method: 'POST',
      headers: { Origin: 'https://evil.example' },
      body: JSON.stringify({ values: { XAI_MODEL: 'evil' } }),
    }));
    assert.equal(crossSite.status, 403);

    const saved = await fetch(`${base}/api/settings`, as(ownerCookie, {
      method: 'POST',
      body: JSON.stringify({ values: { XAI_MODEL: 'grok-org-test' } }),
    }));
    assert.equal(saved.status, 200);
    const after = await fetch(`${base}/api/settings`, as(ownerCookie)).then((res) => res.json());
    assert.equal(after.managed.find((field) => field.key === 'XAI_MODEL').value, 'grok-org-test');
    assert.equal(after.managed.find((field) => field.key === 'XAI_API_KEY').set, true);
    const config = await fs.readFile(path.join(temp, 'data', 'orgs', org.id, 'config.json'), 'utf8');
    assert.equal(config.includes('grok-org-test'), false);

    assert.equal((await fetch(`${base}/api/settings`, as(memberCookie))).status, 403);
    const memberSave = await fetch(`${base}/api/settings`, as(memberCookie, { method: 'POST', body: '{"values":{}}' }));
    assert.equal(memberSave.status, 403);
    const memberConnect = await fetch(`${base}/api/youtube/connect`, { ...as(memberCookie), redirect: 'manual' });
    assert.equal(memberConnect.status, 302);
    assert.match(decodeURIComponent(memberConnect.headers.get('location')), /owner or admin/);
    assert.equal((await fetch(`${base}/api/posts`, as(memberCookie))).status, 200);
    const memberConnectors = await fetch(`${base}/api/connectors`, as(memberCookie)).then((res) => res.json());
    assert.equal(memberConnectors.grok.mcpUrl, '');

    const switched = await fetch(`${base}/api/session/org`, as(ownerCookie, { method: 'POST', body: JSON.stringify({ orgId: other.id }) }));
    assert.equal(switched.status, 403);

    const orgInfo = await fetch(`${base}/api/org`, as(ownerCookie)).then((res) => res.json());
    assert.equal(orgInfo.members.length, 2);
    const created = await fetch(`${base}/api/org/invites`, as(ownerCookie, {
      method: 'POST',
      body: JSON.stringify({ email: 'new@example.com', role: 'admin' }),
    })).then((res) => res.json());
    assert.match(created.link, new RegExp(`^${base}/invite/`));
    const lookup = await fetch(`${base}/api/invites/lookup?token=${created.link.split('/').pop()}`).then((res) => res.json());
    assert.equal(lookup.invite.orgName, 'Brewery');

    const rpc = (token) => fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    assert.equal((await rpc('nope')).status, 401);
    const tools = await rpc(connectorToken).then((res) => res.json());
    assert.ok(tools.result.tools.length > 5);

    const media = await fetch(`${base}/api/media`, as(ownerCookie, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'X-Filename': 'notes.txt' },
      body: 'hello',
    }));
    assert.equal(media.status, 400);
    assert.equal((await fetch(`${base}/public/media/${org.id}/00000000-0000-0000-0000-000000000000?exp=9999999999&sig=x`)).status, 403);

    const hook = `${base}/webhooks/instagram/${org.id}`;
    const challenge = await fetch(`${hook}?hub.mode=subscribe&hub.challenge=1158201444&hub.verify_token=${verifyToken}`);
    assert.equal(challenge.status, 200);
    assert.equal(await challenge.text(), '1158201444');
    assert.equal((await fetch(`${hook}?hub.mode=subscribe&hub.challenge=1&hub.verify_token=wrong`)).status, 403);
    assert.equal((await fetch(`${base}/webhooks/instagram/${other.id}?hub.mode=subscribe&hub.challenge=1&hub.verify_token=${verifyToken}`)).status, 403);

    const event = JSON.stringify({
      object: 'instagram',
      entry: [{ id: '1789', time: 1700000000, changes: [{ field: 'comments', value: { id: 'c1', text: 'Love this', from: { id: '9', username: 'fan' }, media: { id: 'm1' } } }] }],
    });
    const deliver = (body, secret) => fetch(hook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}` },
      body,
    });
    assert.equal((await deliver(event, 'not-the-secret')).status, 401);
    assert.equal((await deliver(event, 'ig-app-secret')).status, 200);
    assert.equal((await deliver(event, 'ig-app-secret')).status, 200);
    const events = await fetch(`${base}/api/instagram/events`, as(memberCookie)).then((res) => res.json());
    assert.equal(events.events.length, 1);
    assert.equal(events.events[0].text, 'Love this');
    assert.equal(events.events[0].from, 'fan');
    const ownerView = await fetch(`${base}/api/connectors`, as(ownerCookie)).then((res) => res.json());
    assert.equal(ownerView.instagram.webhook.verifyToken, verifyToken);
    assert.equal(memberConnectors.instagram.webhook, null);
    const memberSubscribe = await fetch(`${base}/api/instagram/webhooks/subscribe`, as(memberCookie, { method: 'POST', body: '{}' }));
    assert.equal(memberSubscribe.status, 403);

    const deepLink = await fetch(`${base}/connectors/youtube/analysis`);
    assert.equal(deepLink.status, 200);
    assert.match(deepLink.headers.get('content-type'), /text\/html/);
    const html = await deepLink.text();
    assert.match(html, /<div id="root">/);
    const asset = html.match(/\/assets\/[^"]+\.js/)?.[0];
    if (asset) {
      const js = await fetch(`${base}${asset}`);
      assert.equal(js.status, 200);
      assert.match(js.headers.get('cache-control'), /immutable/);
    }
    assert.notEqual((await fetch(`${base}/assets/..%2f..%2f.env`)).status, 200);
    assert.equal((await fetch(`${base}/api/nope`, as(ownerCookie))).status, 404);

    const logout = await fetch(`${base}/auth/logout`, as(ownerCookie, { method: 'POST' }));
    assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal((await fetch(`${base}/api/posts`, as(ownerCookie))).status, 401);
    assert.equal(logs.includes('xai-secret-value'), false);
  } finally {
    try {
      process.kill(-proc.pid, 'SIGTERM');
    } catch {
      proc.kill('SIGTERM');
    }
    await fs.rm(temp, { recursive: true, force: true });
  }
});
