import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'socialbrewery-smtp-'));
process.env.SOCIALBREWERY_HOME = temp;
process.env.APP_URL = 'https://brew.example.com';

const smtp = await import('../src/smtp.js');
const email = await import('../src/email.js');
const env = await import('../src/env.js');
const accounts = await import('../src/accounts.js');
const { runWithOrg } = await import('../src/context.js');
const { ensureData } = await import('../src/store.js');
await ensureData();

const SMTP = {
  EMAIL_PROVIDER: 'smtp',
  SMTP_HOST: 'smtp.acme.com',
  SMTP_PORT: '587',
  SMTP_SECURITY: 'starttls',
  SMTP_USERNAME: 'ada@acme.com',
  SMTP_PASSWORD: 'app-password',
  SMTP_FROM_NAME: 'Ada at Acme',
  SMTP_FROM_EMAIL: 'ada@acme.com',
  EMAIL_POSTAL_ADDRESS: '1 Main St, Springfield',
};

async function inNewOrg(config, fn) {
  const org = await accounts.createOrg({ name: 'Acme', config });
  return runWithOrg({ org: { id: org.id, name: org.name }, config: await accounts.loadOrgConfig(org.id), user: null, role: 'admin' }, () => fn(org));
}

function mockSmtp({ refuse = new Set(), authFails = false } = {}) {
  const sent = [];
  const sessions = [];
  email.setSmtpConnector(async (options) => {
    sessions.push(options);
    if (authFails) throw new smtp.SmtpError('The SMTP server rejected the username or password (535).', 535, { permanent: true });
    return {
      async send(msg) {
        if (refuse.has(msg.to)) throw new smtp.SmtpError(`SMTP RCPT TO failed: 550 no such user`, 550, { permanent: true });
        sent.push(msg);
        return { id: `q${sent.length}` };
      },
      async close() {},
    };
  });
  return { sent, sessions };
}

test('SMTP settings validation catches missing host, bad port, bad security, and plain text off-box', () => {
  assert.deepEqual(smtp.validateSmtp({ host: 'smtp.acme.com', port: 587, security: 'starttls', username: 'a', password: 'b' }), []);
  assert.deepEqual(smtp.validateSmtp({ host: 'smtp.acme.com', port: '465', security: 'tls' }), []);
  const errors = smtp.validateSmtp({ host: '', port: 70000, security: 'ssl3', username: 'a' });
  assert.ok(errors.some((e) => /host is required/.test(e)));
  assert.ok(errors.some((e) => /port/.test(e)));
  assert.ok(errors.some((e) => /security/.test(e)));
  assert.ok(errors.some((e) => /password/.test(e)));
  assert.ok(smtp.validateSmtp({ host: 'mail.acme.com', port: 25, security: 'none' }).some((e) => /Unencrypted/.test(e)));
  assert.deepEqual(smtp.validateSmtp({ host: '127.0.0.1', port: 2525, security: 'none' }), []);
});

test('org settings: provider choice and SMTP fields are validated, and the password stays secret', () => {
  const ok = env.normalizeOrgSettings({ ...SMTP, SMTP_PASSWORD: 'pw' }, {});
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.values.EMAIL_PROVIDER, 'smtp');
  const bad = env.normalizeOrgSettings({ EMAIL_PROVIDER: 'smtp', SMTP_HOST: '', SMTP_FROM_EMAIL: 'nope' }, {});
  assert.ok(bad.errors.some((e) => /host is required/.test(e)));
  assert.ok(bad.errors.some((e) => /from email/.test(e)));
  assert.ok(env.normalizeOrgSettings({ EMAIL_PROVIDER: 'carrier-pigeon' }, {}).errors.some((e) => /resend or smtp/.test(e)));
  // Resend users are not nagged about an empty SMTP section.
  assert.deepEqual(env.normalizeOrgSettings({ EMAIL_PROVIDER: 'resend' }, {}).errors, []);
  // A blank password keeps the saved one.
  const kept = env.normalizeOrgSettings({ ...SMTP, SMTP_PASSWORD: '' }, { SMTP_PASSWORD: 'saved' });
  assert.equal(kept.values.SMTP_PASSWORD, 'saved');
  const view = env.orgSettingsView({ ...env.orgDefaults(), SMTP_PASSWORD: 'saved' }).find((f) => f.key === 'SMTP_PASSWORD');
  assert.equal(view.value, '');
  assert.equal(view.set, true);
});

test('MIME messages encode non-ASCII subjects and names, and keep unsubscribe headers', () => {
  const mime = smtp.buildMime(
    { fromName: 'Zoë', fromEmail: 'z@acme.com', to: 'a@b.com', subject: 'Héllo', text: 'hi', html: '<p>hi</p>', headers: { 'List-Unsubscribe': '<https://x/u>' } },
    'acme.com',
  );
  assert.match(mime, /^From: =\?UTF-8\?B\?/m);
  assert.match(mime, /^Subject: =\?UTF-8\?B\?/m);
  assert.match(mime, /^List-Unsubscribe: <https:\/\/x\/u>$/m);
  assert.match(mime, /multipart\/alternative/);
});

test('SMTP client speaks EHLO, AUTH, MAIL, RCPT, DATA with dot-stuffing to a real socket', async () => {
  const transcript = [];
  let data = '';
  const server = net.createServer((sock) => {
    sock.setEncoding('utf8');
    sock.write('220 test ESMTP\r\n');
    let inData = false;
    let buf = '';
    sock.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            sock.write('250 OK queued as ABC123\r\n');
          } else data += `${line}\n`;
          continue;
        }
        transcript.push(line);
        if (/^EHLO/.test(line)) sock.write('250-test\r\n250-AUTH LOGIN PLAIN\r\n250 OK\r\n');
        else if (/^AUTH PLAIN/.test(line)) sock.write('235 ok\r\n');
        else if (/^(MAIL|RCPT|RSET)/.test(line)) sock.write('250 ok\r\n');
        else if (line === 'DATA') {
          inData = true;
          sock.write('354 go\r\n');
        } else if (line === 'QUIT') sock.end('221 bye\r\n');
      }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    const session = await smtp.connectSmtp({ host: '127.0.0.1', port, security: 'none', username: 'u', password: 'p', fromEmail: 'from@acme.com', fromName: 'Acme' });
    const result = await session.send({ to: 'lead@x.com', subject: 'Hi', text: 'line\n.dot', html: '<p>x</p>' });
    await session.close();
    assert.equal(result.id, 'ABC123');
    assert.ok(transcript.includes(`AUTH PLAIN ${Buffer.from('\0u\0p').toString('base64')}`));
    assert.ok(transcript.includes('MAIL FROM:<from@acme.com>'));
    assert.ok(transcript.includes('RCPT TO:<lead@x.com>'));
    assert.match(data, /^Subject: Hi$/m);
  } finally {
    server.close();
  }
});

test('campaigns route through SMTP: same footer, unsubscribe headers, suppression, and per-address failures', async () => {
  const { sent, sessions } = mockSmtp({ refuse: new Set(['bob@x.com']) });
  globalThis.fetch = async () => assert.fail('Resend must not be called when SMTP is chosen');
  await inNewOrg(SMTP, async () => {
    assert.equal(email.emailStatus().provider, 'smtp');
    assert.equal(email.emailStatus().ready, true);
    assert.equal(email.emailStatus().from, 'Ada at Acme <ada@acme.com>');
    await email.addLead({ email: 'ada@x.com', firstName: 'Ada' });
    await email.addLead({ email: 'bob@x.com' });
    const gone = await email.addLead({ email: 'gone@x.com' });
    await email.unsubscribeLead(gone.id);
    const campaign = await email.saveCampaign('', { name: 'Launch', subject: 'Hi {{first_name|there}}', body: 'Hello' });
    const result = await email.sendCampaignChunk(campaign.id);
    assert.equal(result.stats.sent, 1);
    assert.equal(result.stats.failed, 1);
    assert.equal(sessions.length, 1, 'one SMTP connection per batch');
    assert.equal(sessions[0].host, 'smtp.acme.com');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'ada@x.com');
    assert.equal(sent[0].subject, 'Hi Ada');
    assert.match(sent[0].headers['List-Unsubscribe'], /unsubscribe/);
    assert.match(sent[0].text, /1 Main St/);
    const details = await email.campaignDetails(campaign.id);
    assert.ok(JSON.stringify(details).includes('550'));
  });
});

test('a rejected SMTP login pauses the campaign instead of failing every address', async () => {
  mockSmtp({ authFails: true });
  await inNewOrg(SMTP, async () => {
    await email.addLead({ email: 'ada@x.com' });
    const campaign = await email.saveCampaign('', { name: 'Launch', subject: 'Hi', body: 'Hello' });
    await assert.rejects(email.sendCampaignChunk(campaign.id), /username or password/);
    const list = await email.listCampaigns();
    assert.equal(list.find((c) => c.id === campaign.id).status, 'paused');
  });
});

test('settings test email and verify use the chosen provider', async () => {
  const { sent } = mockSmtp();
  await inNewOrg(SMTP, async () => {
    const result = await email.sendSettingsTest('me@acme.com');
    assert.equal(result.provider, 'smtp');
    assert.equal(sent[0].to, 'me@acme.com');
    assert.equal((await email.verifyEmailConnection()).ok, true);
  });
  email.setSmtpConnector(null);
});

test('Resend stays the default provider', async () => {
  await inNewOrg({ RESEND_API_KEY: 're_x', EMAIL_FROM: 'A <a@acme.com>', EMAIL_POSTAL_ADDRESS: '1 Main St' }, async () => {
    assert.equal(email.emailProvider(), 'resend');
    assert.equal(email.emailStatus().ready, true);
  });
});
