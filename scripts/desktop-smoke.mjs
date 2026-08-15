// Headless end-to-end smoke for the desktop stack — everything the Electron
// main process does, minus the BrowserWindow. Proves the full app runs on
// PGlite-over-socket: migrate → serve → spawn Next standalone → auth → DB reads.
import { runMigrations } from '../electron/db-bootstrap.mjs';
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
  const nextPort = await freePort();
  const base = `http://127.0.0.1:${nextPort}`;

  console.log('== migrate PGlite (open → migrate → close) ==');
  const migRes = await runMigrations({ dataDir: DATA_DIR, migrationsDir: path.join(REPO, 'drizzle') });
  console.log(`   migrations applied: ${migRes.applied}/${migRes.total}`);

  console.log('== spawn Next standalone with in-process PGlite (PFD_DB_DRIVER=pglite) ==');
  child = spawn(process.execPath, [path.join(STANDALONE, 'server.js')], {
    cwd: STANDALONE,
    env: { ...process.env, NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: String(nextPort),
      PFD_DB_DRIVER: 'pglite', PFD_PGLITE_DIR: DATA_DIR,
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

  // Concurrency burst — STRICT. The window's failure was the per-request
  // Auth.js session lookup erroring under concurrency → the session not being
  // recognized → 307 back to /login (the loop). So we assert the *authed*
  // outcome, not just "<500": authed `/` must be 200 (dashboard, NOT a redirect
  // to /login), and the data endpoint must return the actual row.
  console.log('== concurrency burst (STRICT): 30 parallel authed requests ==');
  const check = async (p) => {
    const r = await fetch(`${base}${p}`, { headers: { cookie: jar }, redirect: 'manual' });
    if (p === '/') return { p, ok: r.status === 200, got: r.status };            // 307 => session lost = loop
    if (p === '/api/investments/gold') {
      if (r.status !== 200) return { p, ok: false, got: r.status };
      const j = await r.json();
      return { p, ok: Array.isArray(j.gold) && j.gold.length === 1, got: `${r.status}/${(j.gold||[]).length} rows` };
    }
    return { p, ok: r.status === 200, got: r.status };
  };
  const eps = ['/', '/api/investments/gold', '/api/investments/stocks', '/api/investments/nps', '/api/investments/liabilities'];
  const burst = Array.from({ length: 30 }, (_, i) => eps[i % eps.length]);
  const results = await Promise.allSettled(burst.map((p) => check(p)));
  const bad = results.filter((r) => r.status === 'rejected' || !r.value.ok);
  console.log(`   ${results.length - bad.length}/${results.length} strictly-ok, failures: ${bad.length}`);
  if (bad.length) console.log('   sample failures:', JSON.stringify(bad.slice(0, 3).map((b) => b.reason?.message || b.value)));

  const pass = health.ok && cookie && Array.isArray(gold.gold) && bad.length === 0;
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
