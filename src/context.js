import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { dataDir } from './paths.js';
import { LOOPBACK, appUrl } from './env.js';

const storage = new AsyncLocalStorage();

// Every request, connector call, and agent run happens inside one organisation.
// ctx: { org: { id, name }, config, user, role }
export function runWithOrg(ctx, fn) {
  return storage.run(ctx, fn);
}

export function currentContext() {
  return storage.getStore() || null;
}

export function currentOrgId() {
  const id = storage.getStore()?.org?.id;
  if (!id) {
    const err = new Error('Sign in and choose an organisation first.');
    err.status = 401;
    throw err;
  }
  return id;
}

export function isOrgId(value) {
  return /^[a-f0-9]{24}$/.test(String(value || ''));
}

export function orgDataDir(orgId = currentOrgId()) {
  if (!isOrgId(orgId)) throw new Error('Bad organisation id.');
  return path.join(dataDir, 'orgs', orgId);
}

// The active organisation's decrypted settings. Empty values read as undefined, and there is
// deliberately no fallback to process.env: posting only works with the organisation's own keys.
export const cfg = new Proxy(Object.create(null), {
  get(_, key) {
    if (typeof key !== 'string') return undefined;
    const value = storage.getStore()?.config?.[key];
    return value === '' || value == null ? undefined : value;
  },
  set() {
    throw new Error('Organisation settings change through Settings, not at runtime.');
  },
});

// Origin that outside services (grok.com, Instagram) can reach: the organisation's tunnel if set,
// otherwise the app itself when it is served publicly. Empty when only localhost is available.
export function publicOrigin() {
  const tunnel = String(cfg.MCP_PUBLIC_URL || '').replace(/\/$/, '');
  if (tunnel) return tunnel;
  const app = appUrl();
  try {
    const url = new URL(app);
    if (url.protocol === 'https:' && !LOOPBACK.has(url.hostname)) return url.origin;
  } catch {
    // Fall through to "local only".
  }
  return '';
}
