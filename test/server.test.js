import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { clerkEnv, sessionToken } from './clerk-helper.js';

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

test('Clerk sessions, organisation roles, and the connector scope every request', { timeout: 25000 }, async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'socialbrewery-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  await fs.writeFile(path.join(temp, '.env'), `HOST=127.0.0.1\nPORT=${port}\nAPP_URL=${base}\n`);

  process.env.SOCIALBREWERY_HOME = temp;
  const accounts = await import('../src/accounts.js');
  const { ensureData } = await import('../src/store.js');
  await ensureData();
  const org = await accounts.createOrg({ name: 'Brewery', clerkId: 'org_brew', config: { XAI_API_KEY: 'xai-secret-value', INSTAGRAM_APP_SECRET: 'ig-app-secret' } });
  const other = await accounts.createOrg({ name: 'Other', clerkId: 'org_other' });
  const adminToken = sessionToken({ sub: 'user_ada', o: { id: 'org_brew', rol: 'admin' }, azp: base });
  const memberToken = sessionToken({ sub: 'user_grace', o: { id: 'org_brew', rol: 'member' }, azp: base });
  const noOrgToken = sessionToken({ sub: 'user_new', azp: base });
  const connectorToken = (await accounts.loadOrgConfig(org.id)).CONNECTOR_TOKEN;
  const { instagramVerifyToken } = await import('../src/instagram-webhooks.js');
  const { createHmac } = await import('node:crypto');
  const verifyToken = instagramVerifyToken(org.id);

  let logs = '';
  const proc = spawn(process.execPath, ['src/server.js'], {
    cwd: root,
    env: { ...process.env, ...clerkEnv, CLERK_SECRET_KEY: '', CLERK_AUTHORIZED_PARTIES: 'chrome-extension://testextension', SOCIALBREWERY_HOME: temp },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  proc.stdout.on('data', (chunk) => {
    logs += chunk;
  });
  proc.stderr.on('data', (chunk) => {
    logs += chunk;
  });

  const as = (token, init = {}) => ({ ...init, headers: { Origin: base, 'Content-Type': 'application/json', ...(init.headers || {}), Authorization: `Bearer ${token}` } });

  try {
    const health = await waitFor(async () => {
      const res = await fetch(`${base}/api/health`);
      return res.ok ? res.json() : null;
    }, 10000, `health\n${logs}`);
    assert.equal(health.authenticated, false);
    assert.equal(health.xai, undefined);

    const anon = await fetch(`${base}/api/session`).then((res) => res.json());
    assert.equal(anon.authenticated, false);
    assert.equal(anon.clerk.publishableKey, clerkEnv.CLERK_PUBLISHABLE_KEY);
    assert.equal(anon.clerk.configured, true);
    assert.equal((await fetch(`${base}/api/posts`)).status, 401);
    const guestSettings = await fetch(`${base}/api/settings`).then((res) => res.json());
    assert.equal(guestSettings.guest, true);
    assert.equal(guestSettings.managed.find((field) => field.key === 'XAI_API_KEY').set, false);
    assert.equal(JSON.stringify(guestSettings).includes('xai-secret-value'), false);
    assert.equal((await fetch(`${base}/api/settings`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: '{"values":{}}' })).status, 401);
    assert.equal((await fetch(`${base}/api/posts`, as('garbage'))).status, 401);
    assert.equal((await fetch(`${base}/api/posts`, as(sessionToken({ o: { id: 'org_brew', rol: 'admin' }, exp: 1 })))).status, 401);

    const session = await fetch(`${base}/api/session`, as(adminToken)).then((res) => res.json());
    assert.equal(session.authenticated, true);
    assert.deepEqual(session.org, { id: org.id, name: 'Brewery', role: 'admin' });
    const noOrg = await fetch(`${base}/api/session`, as(noOrgToken)).then((res) => res.json());
    assert.equal(noOrg.authenticated, true);
    assert.equal(noOrg.org, null);
    assert.equal((await fetch(`${base}/api/posts`, as(noOrgToken))).status, 409);

    // The __session cookie Clerk sets works for navigations, like the Bearer header does for fetches.
    const byCookie = await fetch(`${base}/api/session`, { headers: { Cookie: `__session=${adminToken}` } }).then((res) => res.json());
    assert.equal(byCookie.org.id, org.id);

    const signedIn = await fetch(`${base}/api/health`, as(adminToken)).then((res) => res.json());
    assert.equal(signedIn.xai, true);

    const settings = await fetch(`${base}/api/settings`, as(adminToken)).then((res) => res.json());
    const xai = settings.managed.find((field) => field.key === 'XAI_API_KEY');
    assert.equal(xai.value, '');
    assert.equal(xai.set, true);
    assert.equal(JSON.stringify(settings).includes('xai-secret-value'), false);

    const crossSite = await fetch(`${base}/api/settings`, as(adminToken, {
      method: 'POST',
      headers: { Origin: 'https://evil.example' },
      body: JSON.stringify({ values: { XAI_MODEL: 'evil' } }),
    }));
    assert.equal(crossSite.status, 403);

    const saved = await fetch(`${base}/api/settings`, as(adminToken, {
      method: 'POST',
      body: JSON.stringify({ values: { XAI_MODEL: 'grok-org-test' } }),
    }));
    assert.equal(saved.status, 200);
    const after = await fetch(`${base}/api/settings`, as(adminToken)).then((res) => res.json());
    assert.equal(after.managed.find((field) => field.key === 'XAI_MODEL').value, 'grok-org-test');
    assert.equal(after.managed.find((field) => field.key === 'XAI_API_KEY').set, true);
    const config = await fs.readFile(path.join(temp, 'data', 'orgs', org.id, 'config.json'), 'utf8');
    assert.equal(config.includes('grok-org-test'), false);

    assert.equal((await fetch(`${base}/api/settings`, as(memberToken))).status, 403);
    const memberSave = await fetch(`${base}/api/settings`, as(memberToken, { method: 'POST', body: '{"values":{}}' }));
    assert.equal(memberSave.status, 403);
    const memberConnect = await fetch(`${base}/api/youtube/connect`, { ...as(memberToken), redirect: 'manual' });
    assert.equal(memberConnect.status, 302);
    assert.match(decodeURIComponent(memberConnect.headers.get('location')), /owner or admin/);
    assert.equal((await fetch(`${base}/api/posts`, as(memberToken))).status, 200);
    const memberConnectors = await fetch(`${base}/api/connectors`, as(memberToken)).then((res) => res.json());
    assert.equal(memberConnectors.grok.mcpUrl, '');
    assert.equal(memberConnectors.grok.claudeUrl, '');
    const adminConnectors = await fetch(`${base}/api/connectors`, as(adminToken)).then((res) => res.json());
    assert.equal(adminConnectors.grok.claudeUrl, `${adminConnectors.grok.mcpUrl}&client=claude`);

    // A Clerk organisation seen for the first time gets its own empty Socialbrewery organisation.
    const fresh = sessionToken({ sub: 'user_new', o: { id: 'org_fresh', rol: 'admin' }, azp: base });
    const freshSession = await fetch(`${base}/api/session`, as(fresh)).then((res) => res.json());
    assert.match(freshSession.org.id, /^[a-f0-9]{24}$/);
    assert.notEqual(freshSession.org.id, org.id);
    const freshSettings = await fetch(`${base}/api/settings`, as(fresh)).then((res) => res.json());
    assert.equal(freshSettings.managed.find((field) => field.key === 'XAI_API_KEY').set, false);

    const orgInfo = await fetch(`${base}/api/org`, as(adminToken)).then((res) => res.json());
    assert.deepEqual(orgInfo, { org: { id: org.id, name: 'Brewery' }, role: 'admin' });
    assert.equal((await fetch(`${base}/api/org/invites`, as(adminToken, { method: 'POST', body: '{}' }))).status, 404);

    // The Chrome extension saves runs per person, and posts it records show up in the organisation's Posts.
    const ext = 'chrome-extension://testextension';
    const extToken = sessionToken({ sub: 'user_ada', o: { id: 'org_brew', rol: 'admin' }, azp: ext });
    const fromExtension = (body, token = extToken, origin = ext) =>
      fetch(`${base}/api/extension/runs`, { method: 'PUT', headers: { Origin: origin, 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    const run = { id: 'run-1', title: 'LinkedIn launch', provider: 'claude', status: 'done', createdAt: 1, updatedAt: 10, steps: [{ kind: 'user', text: 'Post it', at: 1 }], posts: [{ network: 'LinkedIn', url: 'https://www.linkedin.com/feed/update/urn:li:share:1', title: 'Launch post', at: 5 }] };
    assert.equal((await fromExtension({ runs: [run] })).status, 200);
    assert.equal((await fromExtension({ runs: [{ ...run, title: 'older copy', updatedAt: 5 }] })).status, 200);
    const savedRuns = await fetch(`${base}/api/extension/runs`, { headers: { Authorization: `Bearer ${extToken}` } }).then((res) => res.json());
    assert.equal(savedRuns.runs.length, 1);
    assert.equal(savedRuns.runs[0].title, 'LinkedIn launch');
    const orgPosts = await fetch(`${base}/api/posts`, as(adminToken)).then((res) => res.json());
    assert.equal(orgPosts.posts.filter((p) => p.source === 'extension').length, 1);
    assert.equal(orgPosts.posts.find((p) => p.source === 'extension').network, 'linkedin');
    const others = await fetch(`${base}/api/extension/runs`, as(memberToken)).then((res) => res.json());
    assert.deepEqual(others.runs, []);
    assert.equal((await fromExtension({ runs: [], deleted: ['run-1'] })).status, 200);
    assert.equal((await fromExtension({ runs: [run] })).status, 200);
    assert.deepEqual((await fetch(`${base}/api/extension/runs`, { headers: { Authorization: `Bearer ${extToken}` } }).then((res) => res.json())).runs, []);
    const strangerExt = sessionToken({ sub: 'user_ada', o: { id: 'org_brew', rol: 'admin' }, azp: 'chrome-extension://someoneelse' });
    assert.equal((await fromExtension({ runs: [run] }, strangerExt, 'chrome-extension://someoneelse')).status, 403);

    // Connecting a network: the callback can arrive after the Clerk token expired, so the connect step
    // leaves a signed ticket for that organisation. Without it, a callback is not signed in.
    const connect = await fetch(`${base}/api/youtube/connect`, { headers: { Cookie: `__session=${adminToken}` }, redirect: 'manual' });
    assert.equal(connect.status, 302);
    const ticket = connect.headers.get('set-cookie');
    assert.match(ticket, /^sb_connect=[a-f0-9]{24}\.admin\.\d+\.[\w-]+; Path=\/api; HttpOnly; SameSite=Lax; Max-Age=1200/);
    const callback = (cookie) => fetch(`${base}/api/youtube/callback?code=c&state=s`, { headers: cookie ? { Cookie: cookie } : {}, redirect: 'manual' });
    assert.equal((await callback('')).status, 401);
    assert.equal((await callback(`sb_connect=${ticket.split(';')[0].split('=')[1].replace('admin', 'owner')}`)).status, 401);
    const landed = await callback(ticket.split(';')[0]);
    assert.equal(landed.status, 302);
    assert.match(decodeURIComponent(landed.headers.get('location')), /notice=/);
    assert.match(landed.headers.get('set-cookie'), /sb_connect=; .*Max-Age=0/);

    const rpc = (token) => fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    assert.equal((await rpc('nope')).status, 401);
    const tools = await rpc(connectorToken).then((res) => res.json());
    assert.ok(tools.result.tools.length > 5);
    // Claude connects to the same endpoint: it negotiates its protocol version, and OAuth discovery is a plain 404.
    const claudeInit = await fetch(`${base}/mcp?token=${encodeURIComponent(connectorToken)}&client=claude`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-ai', version: '1' } } }),
    }).then((res) => res.json());
    assert.equal(claudeInit.result.protocolVersion, '2025-06-18');
    const wellKnown = await fetch(`${base}/.well-known/oauth-protected-resource`);
    assert.equal(wellKnown.status, 404);
    assert.match(wellKnown.headers.get('content-type'), /json/);

    const media = await fetch(`${base}/api/media`, as(adminToken, {
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
    const events = await fetch(`${base}/api/instagram/events`, as(memberToken)).then((res) => res.json());
    assert.equal(events.events.length, 1);
    assert.equal(events.events[0].text, 'Love this');
    assert.equal(events.events[0].from, 'fan');
    const ownerView = await fetch(`${base}/api/connectors`, as(adminToken)).then((res) => res.json());
    assert.equal(ownerView.instagram.webhook.verifyToken, verifyToken);
    assert.equal(memberConnectors.instagram.webhook, null);
    const memberSubscribe = await fetch(`${base}/api/instagram/webhooks/subscribe`, as(memberToken, { method: 'POST', body: '{}' }));
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
    assert.equal((await fetch(`${base}/api/nope`, as(adminToken))).status, 404);

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
