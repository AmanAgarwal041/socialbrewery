import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const home = process.env.SOCIALBREWERY_HOME
  ? path.resolve(process.env.SOCIALBREWERY_HOME)
  : root;
export const envFile = path.join(home, '.env');
export const dataDir = path.join(home, 'data');
export const publicDir = path.join(root, 'public');
