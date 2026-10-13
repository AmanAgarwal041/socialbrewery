import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'socialbrewery-accounts-'));
process.env.SOCIALBREWERY_HOME = temp;
process.env.GITHUB_AUTH_CLIENT_ID = 'gh-client';
process.env.GITHUB_AUTH_CLIENT_SECRET = 'gh-secret';
process.env.APP_URL = 'http://127.0.0.1:3847';

// The single-user setup from before organisations: keys in .env, files straight in data/.
await fs.mkdir(path.join(temp, 'data'), { recursive: true });
await fs.writeFile(
  path.join(temp, '.env'),
  'HOST=127.0.0.1\nPORT=3847\nAPP_URL=http://127.0.0.1:3847\nXAI_API_KEY=xai-legacy-secret\nSLACK_BOT_TOKEN=xoxb-legacy\n',
);
await fs.writeFile(path.join(temp, 'data', 'posts.json'), JSON.stringify([{ id: 'p1', title: 'Old post' }]));
await fs.writeFile(path.join(temp, 'data', 'youtube.json'), JSON.stringify({ access_token: 'ya29.legacy', refresh_token: 'rt' }));

const { decryptJson, encryptJson, sign, verifySignature } = await import('../src/secure.js');
const accounts = await import('../src/accounts.js');
const { beginSignIn, finishSignIn } = await import('../src/auth.js');
const { runWithOrg, cfg } = await import('../src/context.js');
const { listPosts, readNetworkToken } = await import('../src/store.js');
const { ensureData } = await import('../src/store.js');
await ensureData();

function githubFetch(profile) {
  return async (url) => {
    const u = String(url);
    const json = (data) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (u === 'https://github.com/login/oauth/access_token') return json({ access_token: `gho_${profile.id}` });
    if (u === 'https://api.github.com/user') return json({ id: profile.id, login: profile.login, name: profile.name });
    if (u === 'https://api.github.com/user/emails') return json([{ email: profile.email, verified: true, primary: true }]);
    throw new Error(`Unexpected fetch ${u}`);
  };
}

async function signIn(profile, invite = '') {
  const previous = globalThis.fetch;
  globalThis.fetch = githubFetch(profile);
  try {
    const url = new URL(await beginSignIn('github', { invite }));
    assert.equal(url.origin, 'https://github.com');
    assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:3847/auth/github/callback');
    return await finishSignIn('github', 'code', url.searchParams.get('state'));
  } finally {
    globalThis.fetch = previous;
  }
}

const ctxFor = async (orgId) => ({ org: await accounts.getOrg(orgId), config: await accounts.loadOrgConfig(orgId), user: null, role: 'owner' });

test('encryption is bound to its organisation', () => {
  const box = encryptJson({ key: 'value' }, 'aaaa:config');
  assert.deepEqual(decryptJson(box, 'aaaa:config'), { key: 'value' });
  assert.throws(() => decryptJson(box, 'bbbb:config'));
  const sig = sign('media:x');
  assert.equal(verifySignature('media:x', sig), true);
  assert.equal(verifySignature('media:y', sig), false);
});

let owner;
let ownerOrg;

test('first sign-in creates an organisation and moves the old keys into it, encrypted', async () => {
  const result = await signIn({ id: 1, login: 'ada', name: 'Ada Lovelace', email: 'ada@example.com' });
  owner = result.user;
  ownerOrg = result.orgId;
  assert.match(result.notice, /moved into this organisation/);
  assert.equal((await accounts.membership(ownerOrg, owner.id)).role, 'owner');

  const env = await fs.readFile(path.join(temp, '.env'), 'utf8');
  assert.equal(env.includes('xai-legacy-secret'), false);
  assert.equal(env.includes('xoxb-legacy'), false);

  const orgDir = path.join(temp, 'data', 'orgs', ownerOrg);
  const rawConfig = await fs.readFile(path.join(orgDir, 'config.json'), 'utf8');
  assert.equal(rawConfig.includes('xai-legacy-secret'), false);
  const rawToken = await fs.readFile(path.join(orgDir, 'token-youtube.json'), 'utf8');
  assert.equal(rawToken.includes('ya29.legacy'), false);

  await runWithOrg(await ctxFor(ownerOrg), async () => {
    assert.equal(cfg.XAI_API_KEY, 'xai-legacy-secret');
    assert.equal(cfg.SLACK_BOT_TOKEN, 'xoxb-legacy');
    assert.equal((await readNetworkToken('youtube')).access_token, 'ya29.legacy');
    assert.equal((await listPosts())[0].title, 'Old post');
  });
  assert.ok(await accounts.getSession(result.session.token));
});

test('invites join the inviting organisation; strangers get their own', async () => {
  const { token } = await accounts.createInvite({ orgId: ownerOrg, email: 'Grace@Example.com', role: 'member', invitedBy: owner.id, actorRole: 'owner' });
  await assert.rejects(
    accounts.createInvite({ orgId: ownerOrg, email: 'x@example.com', role: 'owner', invitedBy: owner.id, actorRole: 'admin' }),
    /admin or member/,
  );
  assert.equal((await accounts.inviteByToken(token)).email, 'grace@example.com');

  const wrong = await signIn({ id: 3, login: 'eve', name: 'Eve', email: 'eve@example.com' }, token);
  assert.match(wrong.notice, /sent to grace@example.com/);
  assert.notEqual(wrong.orgId, ownerOrg);
  assert.equal(await accounts.membership(ownerOrg, wrong.user.id), null);

  const grace = await signIn({ id: 2, login: 'grace', name: 'Grace Hopper', email: 'grace@example.com' }, token);
  assert.equal(grace.orgId, ownerOrg);
  assert.equal((await accounts.membership(ownerOrg, grace.user.id)).role, 'member');
  assert.equal(await accounts.inviteByToken(token), null);

  // Eve's organisation is empty: none of Ada's keys, tokens, or posts are visible there.
  await runWithOrg(await ctxFor(wrong.orgId), async () => {
    assert.equal(cfg.XAI_API_KEY, undefined);
    assert.equal(await readNetworkToken('youtube'), null);
    assert.deepEqual(await listPosts(), []);
  });
});

test('roles protect owners and connector tokens find one organisation', async () => {
  await assert.rejects(accounts.removeMember({ orgId: ownerOrg, actorRole: 'owner', userId: owner.id }), /at least one owner/);
  const members = await accounts.listMembers(ownerOrg);
  const grace = members.find((m) => m.email === 'grace@example.com');
  await assert.rejects(accounts.setMemberRole({ orgId: ownerOrg, actorRole: 'admin', userId: grace.id, role: 'owner' }), /Only an owner/);
  await accounts.setMemberRole({ orgId: ownerOrg, actorRole: 'owner', userId: grace.id, role: 'admin' });
  assert.equal((await accounts.membership(ownerOrg, grace.id)).role, 'admin');

  const before = (await accounts.loadOrgConfig(ownerOrg)).CONNECTOR_TOKEN;
  assert.equal((await accounts.findOrgByConnectorToken(before)).id, ownerOrg);
  const rotated = await accounts.rotateConnectorToken(ownerOrg);
  assert.notEqual(rotated.CONNECTOR_TOKEN, before);
  assert.equal(await accounts.findOrgByConnectorToken(before), null);
  assert.equal((await accounts.findOrgByConnectorToken(rotated.CONNECTOR_TOKEN)).id, ownerOrg);
});

test.after(() => fs.rm(temp, { recursive: true, force: true }));
