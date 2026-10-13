#!/usr/bin/env node
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  console.error('Socialbrewery needs Node.js 20 or newer.');
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = path.join(root, 'src', 'server.js');

let child = null;
let shuttingDown = false;

function start() {
  child = fork(serverPath, [], {
    env: { ...process.env, SOCIALBREWERY_SUPERVISED: '1' },
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  });
  child.on('error', (err) => {
    console.error(err.message);
    process.exit(1);
  });
  child.on('exit', (code) => {
    child = null;
    if (shuttingDown) {
      process.exit(0);
      return;
    }
    if (code === 75) {
      console.log('Reloading settings…');
      start();
      return;
    }
    if (code === 0) {
      console.log('Socialbrewery stopped.');
      process.exit(0);
    }
    console.error(`Socialbrewery stopped (${code ?? 'signal'}).`);
    process.exit(code || 1);
  });
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (child) child.kill('SIGTERM');
  else process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
start();
