// Headless end-to-end smoke for the desktop stack — everything the Electron
// main process does, minus the BrowserWindow. Proves the full app runs on
// PGlite-over-socket: migrate → serve → spawn Next standalone → auth → DB reads.
import { migrateAndServe } from '../electron/db-bootstrap.mjs';
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STANDALONE = path.join(REPO, '.next', 'standalone');
const DATA_DIR = '/private/tmp/claude-503/-Users-bharath-Desktop-pfd-saas/2db5f0dc-3524-4f66-9f4b-fbeeea0e9cb0/scratchpad/desktop-pgdata';

const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Standalone needs static + public copied next to server.js (Dockerfile does this).
function stageStandalone() {
  const staticSrc = path.join(REPO, '.next', 'static');
  const staticDst = path.join(STANDALONE, '.next', 'static');
  fs.rmSync(staticDst, { recursive: true, force: true });
  fs.cpSync(staticSrc, staticDst, { recursive: true });
  const pubSrc = path.join(REPO, 'public');
  if (fs.existsSync(pubSrc)) fs.cpSync(pubSrc, path.join(STANDALONE, 'public'), { recursive: true });
}

async function waitHealth(url, ms = 90000) {
  const t = Date.now();
  while (Date.now() - t < ms) { try { const r = await fetch(url); if (r.ok) return true; } catch {} await sleep(500); }
  return false;
}

let db, child, failed = false;
try {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  stageStandalone();
  const socketPort = await freePort();
  const nextPort = await freePort();
  const base = `http://127.0.0.1:${nextPort}`;

  console.log('== migrate + serve PGlite over socket ==');
  db = await migrateAndServe({ dataDir: DATA_DIR, migrationsDir: path.join(REPO, 'drizzle'), socketPort });
  console.log(`   migrations applied: ${db.migrations.applied}/${db.migrations.total}, socket :${socketPort}`);

  console.log('== spawn Next standalone against the socket ==');
  child = spawn(process.execPath, [path.join(STANDALONE, 'server.js')], {
    cwd: STANDALONE,
    env: { ...process.env, NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: String(nextPort),
      DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${socketPort}/postgres`,
      AUTH_SECRET: 'smoke-secret-smoke-secret-smoke-secret==', AUTH_URL: base, NEXTAUTH_URL: base,
      DEMO_PERSONAL_SWITCH: 'true', MAGIC_LINK_DISPLAY: 'ui', DISABLE_CRON: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => process.stdout.write(`   [next] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`   [next!] ${d}`));

  if (!(await waitHealth(`${base}/api/health`))) throw new Error('health never came up');
  const health = await (await fetch(`${base}/api/health`)).json();
  console.log('== /api/health ==', JSON.stringify(health));

  console.log('== switch to Demo account (seeds demo data through PGlite) ==');
  const sw = await fetch(`${base}/api/auth/switch-account?to=demo`, { method: 'POST', redirect: 'manual' });
  const cookie = (sw.headers.getSetCookie?.() || []).find((c) => c.startsWith('authjs.session-token')) || '';
  console.log(`   switch status ${sw.status}, session cookie: ${cookie ? 'set' : 'MISSING'}`);
  const jar = cookie.split(';')[0];

  console.log('== authed DB reads over PGlite ==');
  const gold = await (await fetch(`${base}/api/investments/gold`, { headers: { cookie: jar } })).json();
  const stocks = await (await fetch(`${base}/api/investments/stocks`, { headers: { cookie: jar } })).json();
  console.log(`   gold rows: ${(gold.gold || []).length}, stock holdings: ${(stocks.holdings || []).length}`);
  const login = await fetch(`${base}/login`, { headers: { cookie: jar } });
  console.log(`   GET /login -> ${login.status}`);

  const pass = health.ok && cookie && Array.isArray(gold.gold);
  console.log(pass ? '\n✅ DESKTOP SMOKE PASSED: full app runs on PGlite-over-socket (migrate, auth, seed, DB reads).'
                   : '\n❌ smoke incomplete — see above.');
  failed = !pass;
} catch (e) {
  failed = true;
  console.error('❌ smoke error:', e.message);
} finally {
  try { child && child.kill(); } catch {}
  try { db && (await db.stop()); } catch {}
  await sleep(300);
  process.exit(failed ? 1 : 0);
}
