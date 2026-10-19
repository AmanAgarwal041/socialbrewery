// Zips extension/dist into web/public/downloads so the dashboard's Chrome extension page can offer it.
// Run through `npm run ext:package` (which builds the extension first), then `npm run web:build`.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'extension', 'dist');
const out = path.join(root, 'web', 'public', 'downloads');
const name = 'socialbrewery-extension';

if (!fs.existsSync(path.join(dist, 'manifest.json'))) throw new Error('Build the extension first: npm --prefix extension run build');
const { version } = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8'));

// Inside the zip everything sits in one folder, which is what "Load unpacked" asks for.
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-ext-'));
fs.cpSync(dist, path.join(stage, name), { recursive: true });
fs.mkdirSync(out, { recursive: true });
const zip = path.join(out, `${name}.zip`);
fs.rmSync(zip, { force: true });
execFileSync('zip', ['-qrX', zip, name], { cwd: stage });
fs.rmSync(stage, { recursive: true, force: true });

const bytes = fs.statSync(zip).size;
fs.writeFileSync(path.join(out, `${name}.json`), `${JSON.stringify({ version, bytes, builtAt: new Date().toISOString() }, null, 2)}\n`);
console.log(`${path.relative(root, zip)}: v${version}, ${(bytes / 1024 / 1024).toFixed(1)} MB`);
