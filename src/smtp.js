import { randomBytes } from 'node:crypto';
import { onWorkers } from './storage.js';

// A small SMTP client (RFC 5321) for sending campaign email through an organisation's own mail
// server: implicit TLS (usually port 465) or STARTTLS (usually 587), AUTH PLAIN or LOGIN, and one
// connection reused for a whole batch. No dependencies.
//
// The protocol is shared; only the byte transport differs. On Node it is node:net / node:tls; on
// Cloudflare Workers it is connect() from cloudflare:sockets (secureTransport 'on' for 465,
// 'starttls' plus socket.startTls() for 587). Both are loaded with dynamic import(), so the Node
// server never loads cloudflare:sockets and the Worker never runs node:net / node:tls.

export const SMTP_SECURITY = ['tls', 'starttls', 'none'];
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);
const TIMEOUT = 20_000;

export class SmtpError extends Error {
  constructor(message, code = 0, { permanent = false } = {}) {
    super(message);
    this.code = code;
    this.permanent = permanent;
  }
}

/** Checks SMTP settings and returns a list of readable problems (empty when fine). */
export function validateSmtp(s) {
  const errors = [];
  const host = String(s.host || '').trim();
  if (!host) errors.push('SMTP host is required.');
  else if (!/^[A-Za-z0-9.-]+$|^\[?[0-9a-fA-F:.]+\]?$/.test(host)) errors.push('SMTP host must be a host name like smtp.example.com.');
  const port = Number(s.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push('SMTP port must be a number from 1 to 65535.');
  const security = String(s.security || '').toLowerCase();
  if (!SMTP_SECURITY.includes(security)) errors.push('SMTP security must be tls (SSL) or starttls.');
  else if (security === 'none' && host && !LOOPBACK.has(host)) errors.push('Unencrypted SMTP is only allowed for a server on this computer. Use tls or starttls.');
  if (Number(s.port) === 25 && (s.workers ?? onWorkers())) errors.push('Cloudflare blocks outgoing port 25. Use port 465 (tls) or 587 (starttls).');
  if (s.username && !s.password) errors.push('Add the SMTP password for that username.');
  return errors;
}

function encodeWord(value) {
  const v = String(value || '');
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, 'utf8').toString('base64')}?=`;
}

function formatAddress(name, email) {
  if (!name) return `<${email}>`;
  const safe = /^[\x20-\x7e]*$/.test(name) ? `"${name.replace(/["\\]/g, '\\$&')}"` : encodeWord(name);
  return `${safe} <${email}>`;
}

function base64Lines(text) {
  return (Buffer.from(String(text), 'utf8').toString('base64').match(/.{1,76}/g) || []).join('\r\n');
}

const clean = (v) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim();

/** Builds an RFC 5322 message (multipart/alternative with text and HTML parts). */
export function buildMime({ fromName, fromEmail, to, replyTo, subject, text, html, headers = {} }, domain) {
  const boundary = `sb_${randomBytes(12).toString('hex')}`;
  const lines = [
    `From: ${formatAddress(clean(fromName), clean(fromEmail))}`,
    `To: <${clean(to)}>`,
    ...(replyTo ? [`Reply-To: <${clean(replyTo)}>`] : []),
    `Subject: ${encodeWord(clean(subject))}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${randomBytes(16).toString('hex')}@${domain}>`,
    'MIME-Version: 1.0',
    ...Object.entries(headers).map(([k, v]) => `${clean(k)}: ${clean(v)}`),
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(text || ''),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(html || ''),
    `--${boundary}--`,
    '',
  ];
  return lines.join('\r\n');
}

// ---------- transports ----------
// A transport moves bytes: write(text), read() -> next text chunk (null at end), startTls() ->
// a new transport over TLS, close().

function isIp(host) {
  return /^[0-9.]+$/.test(host) || host.includes(':');
}

/** Wraps a Node socket (net or tls) as a transport. */
export function nodeSocketTransport(socket, tlsModule) {
  const chunks = [];
  const waiters = [];
  let ended = null;
  const push = (v) => (waiters.length ? waiters.shift().resolve(v) : chunks.push(v));
  const onData = (c) => push(String(c));
  const onEnd = (err) => {
    ended = err || 'end';
    while (waiters.length) {
      const w = waiters.shift();
      err ? w.reject(err) : w.resolve(null);
    }
  };
  const onError = (e) => onEnd(new SmtpError(`SMTP connection failed: ${e.message}`));
  const onClose = () => onEnd(null);
  socket.setEncoding?.('utf8');
  socket.on('data', onData);
  socket.on('error', onError);
  socket.on('close', onClose);
  socket.setTimeout?.(TIMEOUT, () => {
    onEnd(new SmtpError('The SMTP server did not answer in time.'));
    socket.destroy();
  });
  const detach = () => {
    socket.off('data', onData);
    socket.off('error', onError);
    socket.off('close', onClose);
    socket.setTimeout?.(0);
  };
  return {
    write: async (text) => void socket.write(text),
    read: () =>
      chunks.length
        ? Promise.resolve(chunks.shift())
        : ended
          ? ended === 'end'
            ? Promise.resolve(null)
            : Promise.reject(ended)
          : new Promise((resolve, reject) => waiters.push({ resolve, reject })),
    async startTls(host, extra = {}) {
      detach();
      const secured = await new Promise((resolve, reject) => {
        const t = tlsModule.connect({ socket, servername: isIp(host) ? undefined : host, ...extra }, () => resolve(t));
        t.once('error', (err) => reject(new SmtpError(`TLS upgrade failed: ${err.message}`)));
      });
      return nodeSocketTransport(secured, tlsModule);
    },
    async close() {
      detach();
      socket.destroy();
    },
  };
}

/** Wraps a Cloudflare Workers socket (cloudflare:sockets) as a transport. */
export function workersSocketTransport(socket) {
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      reader.releaseLock();
    } catch {}
    try {
      writer.releaseLock();
    } catch {}
  };
  return {
    write: (text) => writer.write(encoder.encode(text)),
    async read() {
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new SmtpError('The SMTP server did not answer in time.')), TIMEOUT);
      });
      try {
        const { value, done } = await Promise.race([reader.read(), timeout]);
        return done ? null : decoder.decode(value, { stream: true });
      } catch (err) {
        throw err instanceof SmtpError ? err : new SmtpError(`SMTP connection failed: ${err.message}`);
      } finally {
        clearTimeout(timer);
      }
    },
    async startTls() {
      // startTls() needs the plain streams unlocked; it returns a new socket over TLS.
      release();
      return workersSocketTransport(socket.startTls());
    },
    async close() {
      release();
      await socket.close().catch(() => {});
    },
  };
}

let transportFactory = null;
/** For tests: replace how connections are opened. fn(options) -> transport. */
export function setSmtpTransportFactory(fn) {
  transportFactory = fn;
}

/** Opens a transport for the runtime: cloudflare:sockets on Workers, node:net/tls on Node. */
// Literal specifiers so bundlers see them; each runtime only ever loads its own.
function loadModule(name) {
  if (name === 'cloudflare:sockets') return import('cloudflare:sockets');
  if (name === 'node:net') return import('node:net');
  if (name === 'node:tls') return import('node:tls');
  throw new Error(`Unknown module ${name}`);
}

export async function openTransport(options, { workers = onWorkers(), loader = loadModule } = {}) {
  const security = String(options.security || 'starttls').toLowerCase();
  const where = `${options.host}:${options.port}`;
  if (workers) {
    if (Number(options.port) === 25) throw new SmtpError('Cloudflare blocks outgoing port 25. Use port 465 (tls) or 587 (starttls).', 0, { permanent: true });
    const { connect } = await loader('cloudflare:sockets');
    const secureTransport = security === 'tls' ? 'on' : security === 'starttls' ? 'starttls' : 'off';
    const socket = connect({ hostname: options.host, port: Number(options.port) }, { secureTransport, allowHalfOpen: false });
    try {
      await socket.opened;
    } catch (err) {
      throw new SmtpError(`Could not reach ${where}: ${err.message}`);
    }
    return workersSocketTransport(socket);
  }
  const [net, tls] = await Promise.all([loader('node:net'), loader('node:tls')]);
  const secure = security === 'tls';
  const socket = await new Promise((resolve, reject) => {
    const s = secure
      ? tls.connect({ host: options.host, port: options.port, servername: isIp(options.host) ? undefined : options.host, ...(options.tls || {}) })
      : net.connect({ host: options.host, port: options.port });
    const onError = (err) => reject(new SmtpError(`Could not reach ${where}: ${err.message}`));
    s.once('error', onError);
    s.setTimeout(TIMEOUT, () => {
      s.destroy();
      reject(new SmtpError(`Timed out connecting to ${where}.`));
    });
    s.once(secure ? 'secureConnect' : 'connect', () => {
      s.off('error', onError);
      s.setTimeout(0);
      resolve(s);
    });
  });
  return nodeSocketTransport(socket, tls);
}

// ---------- protocol ----------
// Reads SMTP replies (possibly multi-line, "250-..." until "250 ...") from a transport.
class Conn {
  constructor(transport) {
    this.use(transport);
  }
  use(transport) {
    this.t = transport;
    this.buffer = '';
    this.lines = [];
  }
  async read() {
    for (;;) {
      const end = this.lines.findIndex((l) => /^\d{3}(?: |$)/.test(l));
      if (end >= 0) {
        const block = this.lines.splice(0, end + 1);
        const code = Number(block[block.length - 1].slice(0, 3));
        const lines = block.map((l) => l.slice(4));
        return { code, lines, text: lines.join(' ') };
      }
      const chunk = await this.t.read();
      if (chunk == null) throw new SmtpError('The SMTP server closed the connection.');
      this.buffer += chunk;
      let i;
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        this.lines.push(this.buffer.slice(0, i).replace(/\r$/, ''));
        this.buffer = this.buffer.slice(i + 1);
      }
    }
  }
  async cmd(line, expect, label = line.split(' ')[0]) {
    if (line != null) await this.t.write(`${line}\r\n`);
    const reply = await this.read();
    if (!expect.includes(reply.code)) {
      throw new SmtpError(`SMTP ${label} failed: ${reply.code} ${reply.text}`.trim(), reply.code, { permanent: reply.code >= 500 });
    }
    return reply;
  }
}

/** Opens an authenticated SMTP session. Call send() for each message, then close(). */
export async function connectSmtp(options) {
  const security = String(options.security || 'starttls').toLowerCase();
  const name = options.clientName || 'socialbrewery.local';
  const conn = new Conn(await (transportFactory ? transportFactory(options) : openTransport(options)));
  const close = () => conn.t.close().catch(() => {});
  try {
    await conn.cmd(null, [220], 'greeting');
    let ehlo = await conn.cmd(`EHLO ${name}`, [250]);
    if (security === 'starttls') {
      if (!ehlo.lines.some((l) => /^STARTTLS\b/i.test(l))) throw new SmtpError('The SMTP server does not offer STARTTLS. Try security "tls" on port 465.');
      await conn.cmd('STARTTLS', [220]);
      conn.use(await conn.t.startTls(options.host, options.tls));
      ehlo = await conn.cmd(`EHLO ${name}`, [250]);
    }
    var ehloReply = ehlo;
  } catch (err) {
    await close();
    throw err;
  }
  const ehlo = ehloReply;
  if (options.username) {
    const auth = ehlo.lines.find((l) => /^AUTH\b/i.test(l)) || '';
    const user = String(options.username);
    const pass = String(options.password || '');
    try {
      if (/\bPLAIN\b/i.test(auth) || !/\bLOGIN\b/i.test(auth)) {
        await conn.cmd(`AUTH PLAIN ${Buffer.from(`\0${user}\0${pass}`).toString('base64')}`, [235], 'AUTH');
      } else {
        await conn.cmd('AUTH LOGIN', [334], 'AUTH');
        await conn.cmd(Buffer.from(user).toString('base64'), [334], 'AUTH');
        await conn.cmd(Buffer.from(pass).toString('base64'), [235], 'AUTH');
      }
    } catch (err) {
      await close();
      throw new SmtpError(`The SMTP server rejected the username or password (${err.code || 'error'}).`, err.code, { permanent: true });
    }
  }
  const domain = String(options.fromEmail || '').split('@')[1] || name;
  return {
    async send(msg) {
      try {
        await conn.cmd(`MAIL FROM:<${clean(options.fromEmail)}>`, [250], 'MAIL FROM');
        await conn.cmd(`RCPT TO:<${clean(msg.to)}>`, [250, 251], 'RCPT TO');
        await conn.cmd('DATA', [354]);
        const body = buildMime({ ...msg, fromName: options.fromName, fromEmail: options.fromEmail, replyTo: msg.replyTo ?? options.replyTo }, domain)
          .replace(/\r\n\./g, '\r\n..');
        const reply = await conn.cmd(`${body}\r\n.`, [250], 'DATA');
        return { id: (/queued as\s+(\S+)/i.exec(reply.text) || [])[1] || '' };
      } catch (err) {
        // A refused recipient leaves the transaction open; reset so the next message can go.
        if (err instanceof SmtpError && err.code) await conn.cmd('RSET', [250]).catch(() => {});
        throw err;
      }
    },
    async close() {
      await conn.cmd('QUIT', [221]).catch(() => {});
      await close();
    },
  };
}

/** Connects and authenticates, then disconnects: for the "Verify connection" button. */
export async function verifySmtp(options) {
  const session = await connectSmtp(options);
  await session.close();
  return { ok: true };
}
