import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'socialbrewery-accounts-'));
process.env.SOCIALBREWERY_HOME = temp;
process.env.APP_URL = 'http://127.0.0.1:3847';
process.env.CLERK_SECRET_KEY = 'sk_test_accounts';
const { clerkEnv, otherKey, sessionToken } = await import('./clerk-helper.js');
Object.assign(process.env, clerkEnv);

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
const { verifySessionToken } = await import('../src/clerk.js');
const { runWithOrg, cfg } = await import('../src/context.js');
const { listPosts, readNetworkToken, writeJson, systemDir } = await import('../src/store.js');
const { ensureData } = await import('../src/store.js');
await ensureData();

// Clerk's Backend API, as the server sees it when it links a new Clerk organisation.
const clerkUsers = {
  user_ada: { id: 'user_ada', email_addresses: [{ email_address: 'Ada@Example.com', verification: { status: 'verified' } }] },
  user_eve: { id: 'user_eve', email_addresses: [{ email_address: 'ada@example.com', verification: { status: 'unverified' } }] },
};
const clerkOrgs = { org_ada: { name: 'Ada & Co' }, org_side: { name: 'Side project' }, org_old: { name: 'Old team in Clerk' }, org_eve: { name: 'Eve' } };
async function withClerk(fn) {
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    assert.equal(u.origin, 'https://api.clerk.com');
    assert.equal(init.headers.Authorization, 'Bearer sk_test_accounts');
    const [, , kind, id] = u.pathname.split('/');
    const data = kind === 'users' ? clerkUsers[id] : clerkOrgs[id];
    return new Response(JSON.stringify(data || {}), { status: data ? 200 : 404 });
  };
  try {
    return await fn();
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

let adaOrg;

test('the first Clerk organisation on a fresh server takes the old single-user keys, encrypted', async () => {
  const org = await withClerk(() => accounts.orgForClerk({ clerkOrgId: 'org_ada', clerkUserId: 'user_ada', role: 'admin' }));
  adaOrg = org.id;
  assert.match(org.id, /^[a-f0-9]{24}$/);
  assert.equal(org.clerkId, 'org_ada');
  assert.equal(org.name, 'Ada & Co');
  assert.equal((await withClerk(() => accounts.orgForClerk({ clerkOrgId: 'org_ada', clerkUserId: 'user_x', role: 'member' }))).id, org.id);

  const env = await fs.readFile(path.join(temp, '.env'), 'utf8');
  assert.equal(env.includes('xai-legacy-secret'), false);
  assert.equal(env.includes('xoxb-legacy'), false);

  const orgDir = path.join(temp, 'data', 'orgs', adaOrg);
  const rawConfig = await fs.readFile(path.join(orgDir, 'config.json'), 'utf8');
  assert.equal(rawConfig.includes('xai-legacy-secret'), false);
  const rawToken = await fs.readFile(path.join(orgDir, 'token-youtube.json'), 'utf8');
  assert.equal(rawToken.includes('ya29.legacy'), false);

  await runWithOrg(await ctxFor(adaOrg), async () => {
    assert.equal(cfg.XAI_API_KEY, 'xai-legacy-secret');
    assert.equal(cfg.SLACK_BOT_TOKEN, 'xoxb-legacy');
    assert.equal((await readNetworkToken('youtube')).access_token, 'ya29.legacy');
    assert.equal((await listPosts())[0].title, 'Old post');
  });
});

test('an admin\'s organisation from before Clerk moves to their first Clerk organisation; nobody else can take it', async () => {
  // As the old sign-in left it: a user, their membership, and an organisation with keys.
  const old = await accounts.createOrg({ name: 'Old team', config: { XAI_API_KEY: 'xai-old-team' } });
  await writeJson(path.join(systemDir, 'users.json'), [{ id: 'u1', email: 'ada@example.com', emails: ['ada@example.com'] }]);
  await writeJson(path.join(systemDir, 'members.json'), [{ orgId: old.id, userId: 'u1', role: 'owner' }]);

  // An unverified address is not enough, and neither is being a member of the Clerk organisation.
  const eve = await withClerk(() => accounts.orgForClerk({ clerkOrgId: 'org_eve', clerkUserId: 'user_eve', role: 'admin' }));
  assert.notEqual(eve.id, old.id);
  const asMember = await withClerk(() => accounts.orgForClerk({ clerkOrgId: 'org_side', clerkUserId: 'user_ada', role: 'member' }));
  assert.notEqual(asMember.id, old.id);
  await runWithOrg(await ctxFor(eve.id), async () => {
    assert.equal(cfg.XAI_API_KEY, undefined);
    assert.equal(await readNetworkToken('youtube'), null);
    assert.deepEqual(await listPosts(), []);
  });

  const claimed = await withClerk(() => accounts.orgForClerk({ clerkOrgId: 'org_old', clerkUserId: 'user_ada', role: 'admin' }));
  assert.equal(claimed.id, old.id);
  assert.equal(claimed.name, 'Old team in Clerk');
  assert.equal((await accounts.loadOrgConfig(claimed.id)).XAI_API_KEY, 'xai-old-team');
});

test('connector tokens find one organisation', async () => {
  const before = (await accounts.loadOrgConfig(adaOrg)).CONNECTOR_TOKEN;
  assert.equal((await accounts.findOrgByConnectorToken(before)).id, adaOrg);
  const rotated = await accounts.rotateConnectorToken(adaOrg);
  assert.notEqual(rotated.CONNECTOR_TOKEN, before);
  assert.equal(await accounts.findOrgByConnectorToken(before), null);
  assert.equal((await accounts.findOrgByConnectorToken(rotated.CONNECTOR_TOKEN)).id, adaOrg);
});

test('Clerk session tokens are verified before anything trusts them', async () => {
  const ok = await verifySessionToken(sessionToken({ sub: 'user_ada', o: { id: 'org_ada', rol: 'admin' }, azp: 'http://127.0.0.1:3847' }));
  assert.deepEqual(ok, { userId: 'user_ada', sessionId: 'sess_test', orgId: 'org_ada', role: 'admin' });
  // Older v1 tokens name the organisation and role differently; unknown custom roles count as member.
  const v1 = await verifySessionToken(sessionToken({ v: undefined, org_id: 'org_ada', org_role: 'org:billing' }));
  assert.equal(v1.orgId, 'org_ada');
  assert.equal(v1.role, 'member');
  assert.equal((await verifySessionToken(sessionToken())).role, null);

  const now = Math.floor(Date.now() / 1000);
  await assert.rejects(verifySessionToken(''), /Sign in/);
  await assert.rejects(verifySessionToken('not.a.token'), (err) => err.status === 401);
  await assert.rejects(verifySessionToken(sessionToken({}, { key: otherKey })), (err) => err.status === 401);
  await assert.rejects(verifySessionToken(sessionToken({ exp: now - 30 })), /expired/);
  await assert.rejects(verifySessionToken(sessionToken({ nbf: now + 60 })), (err) => err.status === 401);
  await assert.rejects(verifySessionToken(sessionToken({ iss: 'https://evil.clerk.accounts.dev' })), /different Clerk application/);
  await assert.rejects(verifySessionToken(sessionToken({ azp: 'https://evil.example' })), /different site/);
  await assert.rejects(verifySessionToken(sessionToken({ sts: 'pending' })), /Finish signing in/);
  const [head, body] = sessionToken().split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), o: { id: 'org_ada', rol: 'admin' } })).toString('base64url');
  await assert.rejects(verifySessionToken(`${head}.${forged}.${sessionToken().split('.')[2]}`), (err) => err.status === 401);
});

test.after(() => fs.rm(temp, { recursive: true, force: true }));
