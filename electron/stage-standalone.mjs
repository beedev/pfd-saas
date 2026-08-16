// Next's standalone output ships server.js but NOT the static assets or public/
// files — they must be copied next to it (the Dockerfile does the same). Run
// this after `next build` so the Electron app can serve a complete site.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STANDALONE = path.join(REPO, '.next', 'standalone');

if (!fs.existsSync(path.join(STANDALONE, 'server.js'))) {
  console.error('No .next/standalone/server.js — run `next build` first (output: "standalone").');
  process.exit(1);
}

const staticDst = path.join(STANDALONE, '.next', 'static');
fs.rmSync(staticDst, { recursive: true, force: true });
fs.cpSync(path.join(REPO, '.next', 'static'), staticDst, { recursive: true });

const pubSrc = path.join(REPO, 'public');
if (fs.existsSync(pubSrc)) {
  fs.cpSync(pubSrc, path.join(STANDALONE, 'public'), { recursive: true });
}

console.log('Staged static + public into .next/standalone.');
