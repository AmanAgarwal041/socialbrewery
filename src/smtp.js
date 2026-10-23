import net from 'node:net';
import tls from 'node:tls';
import os from 'node:os';
import { randomBytes } from 'node:crypto';

// A small SMTP client (RFC 5321) for sending campaign email through an organisation's own mail
// server: implicit TLS (usually port 465) or STARTTLS (usually 587), AUTH PLAIN or LOGIN, and one
// connection reused for a whole batch. No dependencies, so the Worker bundle stays the same.

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

// Reads SMTP replies (possibly multi-line, "250-..." until "250 ...") from a socket.
class Conn {
  constructor(socket) {
    this.attach(socket);
  }
  attach(socket) {
    this.socket = socket;
    this.buffer = '';
    this.waiters = [];
    this.lines = [];
    this.error = null;
    socket.setEncoding?.('utf8');
    socket.on('data', (chunk) => {
      this.buffer += chunk;
      let i;
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        this.lines.push(this.buffer.slice(0, i).replace(/\r$/, ''));
        this.buffer = this.buffer.slice(i + 1);
      }
      this.flush();
    });
    const failAll = (err) => {
      this.error = err;
      this.flush();
    };
    socket.on('error', (err) => failAll(new SmtpError(`SMTP connection failed: ${err.message}`)));
    socket.on('close', () => failAll(new SmtpError('The SMTP server closed the connection.')));
    socket.setTimeout?.(TIMEOUT, () => {
      failAll(new SmtpError('The SMTP server did not answer in time.'));
      socket.destroy();
    });
  }
  flush() {
    while (this.waiters.length) {
      const end = this.lines.findIndex((l) => /^\d{3}(?: |$)/.test(l));
      if (end >= 0) {
        const block = this.lines.splice(0, end + 1);
        const code = Number(block[block.length - 1].slice(0, 3));
        this.waiters.shift().resolve({ code, lines: block.map((l) => l.slice(4)), text: block.map((l) => l.slice(4)).join(' ') });
      } else if (this.error) {
        this.waiters.shift().reject(this.error);
      } else return;
    }
  }
  read() {
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      this.flush();
    });
  }
  async cmd(line, expect, label = line.split(' ')[0]) {
    if (line != null) this.socket.write(`${line}\r\n`);
    const reply = await this.read();
    if (!expect.includes(reply.code)) {
      throw new SmtpError(`SMTP ${label} failed: ${reply.code} ${reply.text}`.trim(), reply.code, { permanent: reply.code >= 500 });
    }
    return reply;
  }
}

function open(options, secure) {
  return new Promise((resolve, reject) => {
    const socket = secure
      ? tls.connect({ host: options.host, port: options.port, servername: net.isIP(options.host) ? undefined : options.host, ...(options.tls || {}) })
      : net.connect({ host: options.host, port: options.port });
    const ready = secure ? 'secureConnect' : 'connect';
    const onError = (err) => reject(new SmtpError(`Could not reach ${options.host}:${options.port}: ${err.message}`));
    socket.once('error', onError);
    socket.setTimeout(TIMEOUT, () => {
      socket.destroy();
      reject(new SmtpError(`Timed out connecting to ${options.host}:${options.port}.`));
    });
    socket.once(ready, () => {
      socket.off('error', onError);
      resolve(socket);
    });
  });
}

/** Opens an authenticated SMTP session. Call send() for each message, then close(). */
export async function connectSmtp(options) {
  const security = String(options.security || 'starttls').toLowerCase();
  const name = options.clientName || os.hostname() || 'localhost';
  const socket = await open(options, security === 'tls');
  const conn = new Conn(socket);
  await conn.cmd(null, [220], 'greeting');
  let ehlo = await conn.cmd(`EHLO ${name}`, [250]);
  if (security === 'starttls') {
    if (!ehlo.lines.some((l) => /^STARTTLS\b/i.test(l))) throw new SmtpError('The SMTP server does not offer STARTTLS. Try security "tls" on port 465.');
    await conn.cmd('STARTTLS', [220]);
    socket.removeAllListeners('data');
    socket.removeAllListeners('close');
    socket.removeAllListeners('error');
    socket.setTimeout(0);
    const secured = await new Promise((resolve, reject) => {
      const s = tls.connect({ socket, servername: net.isIP(options.host) ? undefined : options.host, ...(options.tls || {}) }, () => resolve(s));
      s.once('error', (err) => reject(new SmtpError(`TLS upgrade failed: ${err.message}`)));
    });
    conn.attach(secured);
    ehlo = await conn.cmd(`EHLO ${name}`, [250]);
  }
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
      conn.socket.destroy();
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
      conn.socket.destroy();
    },
  };
}

/** Connects and authenticates, then disconnects: for the "Verify connection" button. */
export async function verifySmtp(options) {
  const session = await connectSmtp(options);
  await session.close();
  return { ok: true };
}
