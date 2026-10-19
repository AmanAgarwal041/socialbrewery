import { createSign, generateKeyPairSync } from 'node:crypto';

// A stand-in Clerk instance: an RSA key whose public half the server reads from CLERK_JWT_KEY, and
// session tokens shaped like Clerk's (v2 claims, active organisation in `o`).
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

export const FRONTEND_API = 'clerk.test.example';
export const clerkEnv = {
  CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from(`${FRONTEND_API}$`).toString('base64')}`,
  CLERK_JWT_KEY: publicKey.export({ type: 'spki', format: 'pem' }),
};

export function sessionToken(claims = {}, { key = privateKey } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT', kid: 'ins_test' };
  const payload = { iss: `https://${FRONTEND_API}`, sub: 'user_test', sid: 'sess_test', iat: now, nbf: now - 1, exp: now + 60, v: 2, ...claims };
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const body = `${encode(header)}.${encode(payload)}`;
  return `${body}.${createSign('RSA-SHA256').update(body).sign(key).toString('base64url')}`;
}

export const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
