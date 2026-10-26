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
    const paused = list.find((c) => c.id === campaign.id);
    assert.equal(paused.status, 'paused');
    assert.equal(paused.pauseReason, 'config');
    assert.ok((paused.remaining ?? 0) >= 1, 'leftovers stay resumeable after a config pause');
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

// ---------- Workers transport (cloudflare:sockets), mocked ----------

function fakeWorkersServer({ authLines = 'AUTH PLAIN LOGIN' } = {}) {
  const log = { lines: [], connects: [], tlsUpgraded: false, closed: 0, data: '' };
  function makeSocket(secure) {
    let controller;
    let inData = false;
    let buf = '';
    const send = (t) => controller.enqueue(new TextEncoder().encode(t));
    const readable = new ReadableStream({
      start(c) {
        controller = c;
        if (!log.tlsUpgraded) send('220 fake ESMTP\r\n');
      },
    });
    const writable = new WritableStream({
      write(chunk) {
        buf += new TextDecoder().decode(chunk);
        let i;
        while ((i = buf.indexOf('\r\n')) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (inData) {
            if (line === '.') {
              inData = false;
              send('250 OK queued as W1\r\n');
            } else log.data += `${line}\n`;
            continue;
          }
          log.lines.push(`${secure ? 'tls' : 'plain'}:${line}`);
          if (/^EHLO/.test(line)) send(secure ? `250-fake\r\n250 ${authLines}\r\n` : '250-fake\r\n250 STARTTLS\r\n');
          else if (line === 'STARTTLS') send('220 go ahead\r\n');
          else if (/^AUTH PLAIN/.test(line)) send('235 ok\r\n');
          else if (/^(MAIL|RCPT|RSET)/.test(line)) send('250 ok\r\n');
          else if (line === 'DATA') {
            inData = true;
            send('354 go\r\n');
          } else if (line === 'QUIT') send('221 bye\r\n');
        }
      },
    });
    return {
      readable,
      writable,
      opened: Promise.resolve({}),
      startTls(opts = {}) {
        assert.equal(secure, false, 'startTls only on the plain socket');
        log.tlsUpgraded = true;
        log.startTlsOpts = opts;
        return makeSocket(true);
      },
      async close() {
        log.closed++;
      },
    };
  }
  const loader = async (mod) => {
    assert.equal(mod, 'cloudflare:sockets', 'Workers must not load node:net or node:tls');
    return {
      connect(address, opts) {
        log.connects.push({ address, opts });
        return makeSocket(opts.secureTransport === 'on');
      },
    };
  };
  return { log, loader };
}

test('transport selection: Workers use cloudflare:sockets (on / starttls), Node uses node:net and node:tls', async () => {
  const { log, loader } = fakeWorkersServer();
  const t1 = await smtp.openTransport({ host: 'smtp.acme.com', port: 465, security: 'tls' }, { workers: true, loader });
  await t1.close();
  const t2 = await smtp.openTransport({ host: 'smtp.acme.com', port: 587, security: 'starttls' }, { workers: true, loader });
  await t2.close();
  assert.deepEqual(log.connects.map((c) => [c.address.hostname, c.address.port, c.opts.secureTransport]), [
    ['smtp.acme.com', 465, 'on'],
    ['smtp.acme.com', 587, 'starttls'],
  ]);
  await assert.rejects(smtp.openTransport({ host: 'smtp.acme.com', port: 25, security: 'starttls' }, { workers: true, loader }), /port 25/);
  assert.ok(smtp.validateSmtp({ host: 'smtp.acme.com', port: 25, security: 'starttls', workers: true }).some((e) => /port 25/.test(e)));
  assert.deepEqual(smtp.validateSmtp({ host: 'smtp.acme.com', port: 25, security: 'starttls', workers: false }), []);

  const loaded = [];
  await assert.rejects(
    smtp.openTransport({ host: '127.0.0.1', port: 1, security: 'none' }, { workers: false, loader: async (m) => (loaded.push(m), import(m)) }),
    /Could not reach/,
  );
  assert.deepEqual(loaded.sort(), ['node:net', 'node:tls']);
});

test('Workers STARTTLS path: EHLO, STARTTLS, startTls(), EHLO again, AUTH and send over TLS, then close', async () => {
  const { log, loader } = fakeWorkersServer();
  smtp.setSmtpTransportFactory((options) => smtp.openTransport(options, { workers: true, loader }));
  try {
    const session = await smtp.connectSmtp({ host: 'smtp.acme.com', port: 587, security: 'starttls', username: 'u', password: 'p', fromEmail: 'ada@acme.com' });
    const r = await session.send({ to: 'lead@x.com', subject: 'Hi', text: '.leading dot', html: '<p>x</p>' });
    await session.close();
    assert.equal(r.id, 'W1');
    assert.equal(log.tlsUpgraded, true);
    const order = log.lines.map((l) => l.replace(/ .*/, ''));
    assert.deepEqual(order.slice(0, 4), ['plain:EHLO', 'plain:STARTTLS', 'tls:EHLO', 'tls:AUTH']);
    assert.ok(!log.lines.some((l) => l.startsWith('plain:AUTH')), 'credentials never go over plain text');
    assert.ok(log.lines.includes('tls:RCPT TO:<lead@x.com>'));
    assert.equal(log.closed, 1);
  } finally {
    smtp.setSmtpTransportFactory(null);
  }
});

test('Workers implicit TLS (465) needs no upgrade', async () => {
  const { log, loader } = fakeWorkersServer();
  smtp.setSmtpTransportFactory((options) => smtp.openTransport(options, { workers: true, loader }));
  try {
    await smtp.verifySmtp({ host: 'smtp.acme.com', port: 465, security: 'tls', username: 'u', password: 'p', fromEmail: 'a@acme.com' });
    assert.equal(log.tlsUpgraded, false);
    assert.equal(log.connects[0].opts.secureTransport, 'on');
    assert.ok(log.lines[0].startsWith('tls:EHLO'));
  } finally {
    smtp.setSmtpTransportFactory(null);
  }
});

test('Workers STARTTLS passes expectedServerHostname to startTls', async () => {
  const { log, loader } = fakeWorkersServer();
  smtp.setSmtpTransportFactory((options) => smtp.openTransport(options, { workers: true, loader }));
  try {
    await smtp.verifySmtp({ host: 'smtp.acme.com', port: 587, security: 'starttls', username: 'u', password: 'p', fromEmail: 'a@acme.com' });
    assert.deepEqual(log.startTlsOpts, { expectedServerHostname: 'smtp.acme.com' });
  } finally {
    smtp.setSmtpTransportFactory(null);
  }
});

test('Workers read timeout cancels the pending reader and closes the socket', async () => {
  smtp.setSmtpTimeoutMs(40);
  const log = { closed: 0, cancel: 0 };
  let controller;
  const socket = {
    readable: new ReadableStream({
      start(c) {
        controller = c;
        // Never enqueue — forces the read timeout path.
      },
      cancel() {
        log.cancel++;
      },
    }),
    writable: new WritableStream({
      write() {},
    }),
    opened: Promise.resolve({}),
    async close() {
      log.closed++;
      try {
        controller?.close();
      } catch {}
    },
  };
  const t = smtp.workersSocketTransport(socket);
  try {
    await assert.rejects(() => t.read('greeting'), /did not answer in time \(greeting\)/);
    assert.equal(t.closed, true);
    assert.ok(log.cancel >= 1, 'pending reader must be canceled so the stream is not left locked');
    assert.ok(log.closed >= 1, 'socket must close on timeout');
    // A follow-up close must be a no-op (no second hang / second read).
    await t.close();
    await assert.rejects(() => t.read('EHLO'), /closed/);
  } finally {
    smtp.setSmtpTimeoutMs(20_000);
  }
});

test('Workers connect times out when socket.opened never resolves', async () => {
  smtp.setSmtpTimeoutMs(40);
  const log = { closed: 0 };
  const loader = async (mod) => {
    assert.equal(mod, 'cloudflare:sockets');
    return {
      connect() {
        return {
          opened: new Promise(() => {}),
          async close() {
            log.closed++;
          },
        };
      },
    };
  };
  try {
    await assert.rejects(
      smtp.openTransport({ host: 'smtp.acme.com', port: 587, security: 'starttls' }, { workers: true, loader }),
      /Timed out connecting to smtp\.acme\.com:587/,
    );
    assert.equal(log.closed, 1);
  } finally {
    smtp.setSmtpTimeoutMs(20_000);
  }
});

test('Workers DATA timeout names the stage and still allows session.close', async () => {
  smtp.setSmtpTimeoutMs(50);
  const log = { closed: 0, lines: [] };
  function makeSocket(secure) {
    let controller;
    let buf = '';
    let afterData = false;
    const send = (t) => controller.enqueue(new TextEncoder().encode(t));
    return {
      readable: new ReadableStream({
        start(c) {
          controller = c;
          if (!secure) send('220 fake\r\n');
        },
      }),
      writable: new WritableStream({
        write(chunk) {
          buf += new TextDecoder().decode(chunk);
          let i;
          while ((i = buf.indexOf('\r\n')) >= 0) {
            const line = buf.slice(0, i);
            buf = buf.slice(i + 2);
            if (afterData) continue; // swallow MIME; never reply 250 — triggers DATA timeout
            log.lines.push(line);
            if (/^EHLO/.test(line)) send(secure ? '250-fake\r\n250 AUTH PLAIN\r\n' : '250-fake\r\n250 STARTTLS\r\n');
            else if (line === 'STARTTLS') send('220 go\r\n');
            else if (/^AUTH PLAIN/.test(line)) send('235 ok\r\n');
            else if (/^(MAIL|RCPT)/.test(line)) send('250 ok\r\n');
            else if (line === 'DATA') {
              afterData = true;
              send('354 go\r\n');
            } else if (line === 'QUIT') send('221 bye\r\n');
          }
        },
      }),
      opened: Promise.resolve({}),
      startTls() {
        return makeSocket(true);
      },
      async close() {
        log.closed++;
      },
    };
  }
  const loader = async () => ({
    connect() {
      return makeSocket(false);
    },
  });
  smtp.setSmtpTransportFactory((options) => smtp.openTransport(options, { workers: true, loader }));
  try {
    const session = await smtp.connectSmtp({
      host: 'smtp.acme.com',
      port: 587,
      security: 'starttls',
      username: 'u',
      password: 'p',
      fromEmail: 'ada@acme.com',
    });
    await assert.rejects(
      session.send({ to: 'lead@x.com', subject: 'Hi', text: 'hello', html: '<p>hello</p>', headers: { 'List-Unsubscribe': '<https://x/u>' } }),
      /did not answer in time \(DATA\)/,
    );
    await session.close();
    assert.ok(log.closed >= 1);
  } finally {
    smtp.setSmtpTransportFactory(null);
    smtp.setSmtpTimeoutMs(20_000);
  }
});
