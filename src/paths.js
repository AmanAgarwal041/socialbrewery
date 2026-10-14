import path from 'node:path';
import { fileURLToPath } from 'node:url';

function projectRoot() {
  try {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  } catch {
    return '/socialbrewery';
  }
}

// Bundled Workers code has no real file location; storage keys stay relative to dataDir either way.
export const root = projectRoot();
export const home = process.env.SOCIALBREWERY_HOME
  ? path.resolve(process.env.SOCIALBREWERY_HOME)
  : root;
export const envFile = path.join(home, '.env');
export const dataDir = path.join(home, 'data');
export const publicDir = path.join(root, 'public');
