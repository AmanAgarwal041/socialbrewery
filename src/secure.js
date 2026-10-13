import fs from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { home } from './paths.js';

const keyFile = path.join(home, '.master.key');
let cached = null;

// Everything an organisation stores (settings, account tokens) is encrypted with keys derived from this one.
// Losing it makes stored settings unreadable, so it lives outside data/ and can come from the environment.
export function masterKey() {
  if (cached) return cached;
  const fromEnv = process.env.SOCIALBREWERY_MASTER_KEY;
  if (fromEnv) {
    const key = Buffer.from(fromEnv.trim(), 'base64');
    if (key.length !== 32) throw new Error('SOCIALBREWERY_MASTER_KEY must be 32 random bytes, base64 encoded.');
    cached = key;
    return key;
  }
  try {
    const key = Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'base64');
    if (key.length !== 32) throw new Error(`${keyFile} is not a valid master key.`);
    cached = key;
    return key;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const key = randomBytes(32);
  fs.mkdirSync(home, { recursive: true });
  try {
    fs.writeFileSync(keyFile, `${key.toString('base64')}\n`, { mode: 0o600, flag: 'wx' });
  } catch (err) {
    if (err.code === 'EEXIST') return masterKey();
    throw err;
  }
  cached = key;
  return key;
}

function subkey(purpose) {
  return createHmac('sha256', masterKey()).update(`socialbrewery:${purpose}`).digest();
}

export function encryptJson(value, context) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', subkey('encrypt'), iv);
  cipher.setAAD(Buffer.from(String(context)));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

export function decryptJson(box, context) {
  const decipher = createDecipheriv('aes-256-gcm', subkey('encrypt'), Buffer.from(box.iv, 'base64'));
  decipher.setAAD(Buffer.from(String(context)));
  decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
  const text = Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]).toString('utf8');
  return JSON.parse(text);
}

export function isEncrypted(value) {
  return Boolean(value && value.v === 1 && typeof value.iv === 'string' && typeof value.tag === 'string' && typeof value.data === 'string');
}

export function sign(text) {
  return createHmac('sha256', subkey('sign')).update(String(text)).digest('base64url');
}

export function verifySignature(text, signature) {
  return safeEqual(sign(text), String(signature || ''));
}

export function sha256(text) {
  return createHash('sha256').update(String(text)).digest('hex');
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (!a.length || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
