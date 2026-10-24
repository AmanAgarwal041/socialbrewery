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
/** Per-stage I/O budget (connect, greeting, EHLO, STARTTLS, AUTH, MAIL, RCPT, DATA). */
let TIMEOUT = 20_000;

/** For tests: shorten (or restore) the SMTP I/O timeout. */
export function setSmtpTimeoutMs(ms) {
  TIMEOUT = Number(ms) > 0 ? Number(ms) : 20_000;
}

export class SmtpError extends Error {
  constructor(message, code = 0, { permanent = false } = {}) {
    super(message);
    this.code = code;
    this.permanent = permanent;
  }
}

function timeoutError(stage) {
  return new SmtpError(stage ? `The SMTP server did not answer in time (${stage}).` : 'The SMTP server did not answer in time.');
}

function withTimeout(promise, stage) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(timeoutError(stage)), TIMEOUT);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
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
  let stage = '';
  socket.setTimeout?.(TIMEOUT, () => {
    onEnd(timeoutError(stage));
    socket.destroy();
  });
  const detach = () => {
    socket.off('data', onData);
    socket.off('error', onError);
    socket.off('close', onClose);
    socket.setTimeout?.(0);
  };
  return {
    closed: false,
    write: async (text) => void socket.write(text),
    read: (nextStage = '') => {
      stage = nextStage || stage;
      // Activity resets the idle timer; re-arm so a slow next stage still times out.
      socket.setTimeout?.(TIMEOUT);
      return chunks.length
        ? Promise.resolve(chunks.shift())
        : ended
          ? ended === 'end'
            ? Promise.resolve(null)
            : Promise.reject(ended)
          : new Promise((resolve, reject) => waiters.push({ resolve, reject }));
    },
    async startTls(host, extra = {}) {
      detach();
      const secured = await new Promise((resolve, reject) => {
        const t = tlsModule.connect({ socket, servername: isIp(host) ? undefined : host, ...extra }, () => resolve(t));
        t.once('error', (err) => reject(new SmtpError(`TLS upgrade failed: ${err.message}`)));
      });
      return nodeSocketTransport(secured, tlsModule);
    },
    async close() {
      this.closed = true;
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
  let closed = false;
  // Unlock without destroying: required before socket.startTls(), which reuses the connection.
  const unlock = () => {
    if (released) return;
    released = true;
    try {
      reader.releaseLock();
    } catch {}
    try {
      writer.releaseLock();
    } catch {}
  };
  // Abort any pending reader.read() and drop the socket so a timed-out request cannot leave the
  // stream locked (Promise.race alone would orphan the read and break the next I/O / close).
  const destroy = async (err) => {
    if (closed) return;
    closed = true;
    await reader.cancel(err?.message || 'error').catch(() => {});
    await writer.abort(err?.message || 'error').catch(() => {});
    unlock();
    await socket.close().catch(() => {});
  };
  const transport = {
    get closed() {
      return closed;
    },
    async write(text, stage = '') {
      if (closed) throw new SmtpError('The SMTP connection is closed.');
      try {
        await withTimeout(writer.write(encoder.encode(text)), stage);
      } catch (err) {
        const e = err instanceof SmtpError ? err : new SmtpError(`SMTP connection failed: ${err.message}`);
        await destroy(e);
        throw e;
      }
    },
    async read(stage = '') {
      if (closed) throw new SmtpError('The SMTP connection is closed.');
      // Hold the read promise so a losing race still gets a .catch (avoids unhandled rejection when
      // destroy() cancels the reader after our timeout wins).
      const pending = reader.read();
      pending.catch(() => {});
      try {
        const { value, done } = await withTimeout(pending, stage);
        return done ? null : decoder.decode(value, { stream: true });
      } catch (err) {
        const e = err instanceof SmtpError ? err : new SmtpError(`SMTP connection failed: ${err.message}`);
        await destroy(e);
        throw e;
      }
    },
    async startTls(host) {
      if (closed) throw new SmtpError('The SMTP connection is closed.');
      // This plain transport is finished; startTls() closes it and returns a new TLS socket.
      closed = true;
      unlock();
      const opts = host && !isIp(host) ? { expectedServerHostname: host } : {};
      return workersSocketTransport(socket.startTls(opts));
    },
    async close() {
      if (closed) return;
      closed = true;
      unlock();
      await socket.close().catch(() => {});
    },
  };
  return transport;
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
      // Workers' socket.opened has no built-in deadline (Node connect does); bound it so a hung SYN
      // cannot burn the whole request before the first SMTP read timeout.
      await withTimeout(socket.opened, 'connect');
    } catch (err) {
      await socket.close().catch(() => {});
      if (err instanceof SmtpError) {
        throw err.message.includes('did not answer in time')
          ? new SmtpError(`Timed out connecting to ${where}.`)
          : err;
      }
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
  async read(stage = '') {
    for (;;) {
      const end = this.lines.findIndex((l) => /^\d{3}(?: |$)/.test(l));
      if (end >= 0) {
        const block = this.lines.splice(0, end + 1);
        const code = Number(block[block.length - 1].slice(0, 3));
        const lines = block.map((l) => l.slice(4));
        return { code, lines, text: lines.join(' ') };
      }
      const chunk = await this.t.read(stage);
      if (chunk == null) throw new SmtpError('The SMTP server closed the connection.');
      this.buffer += chunk;
      let i;
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        this.lines.push(this.buffer.slice(0, i).replace(/\r$/, ''));
        this.buffer = this.buffer.slice(i + 1);
      }
    }
  }
  async cmd(line, expect, label = line == null ? '' : line.split(' ')[0]) {
    if (line != null) await this.t.write(`${line}\r\n`, label);
    const reply = await this.read(label);
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
    let ehlo = await conn.cmd(`EHLO ${name}`, [250], 'EHLO');
    if (security === 'starttls') {
      if (!ehlo.lines.some((l) => /^STARTTLS\b/i.test(l))) throw new SmtpError('The SMTP server does not offer STARTTLS. Try security "tls" on port 465.');
      await conn.cmd('STARTTLS', [220], 'STARTTLS');
      conn.use(await conn.t.startTls(options.host, options.tls));
      ehlo = await conn.cmd(`EHLO ${name}`, [250], 'EHLO');
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
        await conn.cmd('DATA', [354], 'DATA');
        // Flush the full MIME (plus terminating ".") as one write with a DATA-stage timeout, then
        // wait for 250. Avoids stuffing a multi-kilobyte campaign body through cmd()'s line helper.
        const body = buildMime({ ...msg, fromName: options.fromName, fromEmail: options.fromEmail, replyTo: msg.replyTo ?? options.replyTo }, domain)
          .replace(/\r\n\./g, '\r\n..');
        const payload = body.endsWith('\r\n') ? `${body}.\r\n` : `${body}\r\n.\r\n`;
        await conn.t.write(payload, 'DATA');
        const reply = await conn.cmd(null, [250], 'DATA');
        return { id: (/queued as\s+(\S+)/i.exec(reply.text) || [])[1] || '' };
      } catch (err) {
        // A refused recipient leaves the transaction open; reset so the next message can go.
        // Skip RSET when the transport is already dead (timeout/cancel) — that path closed the socket.
        if (err instanceof SmtpError && err.code && !conn.t.closed) await conn.cmd('RSET', [250], 'RSET').catch(() => {});
        throw err;
      }
    },
    async close() {
      // After a read/write timeout the Workers transport has already destroyed the socket; skip QUIT
      // so we do not start another reader.read() on a locked or canceled stream.
      if (!conn.t.closed) await conn.cmd('QUIT', [221], 'QUIT').catch(() => {});
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
