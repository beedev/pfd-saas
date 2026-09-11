// Electron main process for the pfd desktop app.
//
// Boot sequence:
//   1. Embed PGlite at <userData>/pgdata, apply migrations, serve it over a
//      localhost Postgres-wire socket (electron/db-bootstrap.mjs).
//   2. Spawn the Next.js standalone server (Electron's own Node via
//      ELECTRON_RUN_AS_NODE) pointed at that socket through DATABASE_URL — the
//      app is byte-identical to the SaaS/Docker build; PGlite is invisible.
//   3. Wait for /api/health, then open the window on the local server.
//
// No Docker, no external Postgres. Cross-platform (Win/Mac/Linux) because
// PGlite is pure WASM/JS — nothing native per-OS to bundle.
const { app, BrowserWindow, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

let nextChild = null;
let cronTimer = null;
let backupTimer = null;
let telegramTimer = null;
let mainWindow = null;
let appBaseUrl = null;

// Runtime used to spawn the Next server. On macOS the electron-as-node child,
// if launched from the MAIN app binary, registers as a second foreground app
// and shows a duplicate Dock icon ("next-server"). Electron's base
// "<App> Helper.app" binary is marked LSUIElement (dockless), so spawn via that.
function nodeRunner() {
  if (process.platform !== 'darwin') return process.execPath;
  try {
    const fwDir = path.join(path.dirname(process.execPath), '..', 'Frameworks');
    const base = fs.readdirSync(fwDir).find((d) => /\bHelper\.app$/.test(d) && !d.includes('('));
    if (base) {
      const bin = path.join(fwDir, base, 'Contents', 'MacOS', base.replace(/\.app$/, ''));
      if (fs.existsSync(bin)) return bin;
    }
  } catch { /* fall through */ }
  return process.execPath;
}

function resourcePath(...p) {
  // Packaged: files live under process.resourcesPath (electron-builder
  // extraResources). Dev: straight from the repo root.
  return app.isPackaged
    ? path.join(process.resourcesPath, ...p)
    : path.join(__dirname, '..', ...p);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// Read KEY=VALUE pairs from a .env file. Dev reads the repo's .env.local; a
// packaged app reads <userData>/.env.local (the user drops their keys there).
// Used to forward the analyst's OPENAI_API_KEY (and friends) into the Next
// server, which npm/electron do not load automatically.
function loadDotEnv() {
  const base = app.isPackaged ? app.getPath('userData') : path.join(__dirname, '..');
  const out = {};
  for (const name of ['.env', '.env.local']) {
    const p = path.join(base, name);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (m) out[m[1]] = m[2].replace(/^\s*["']?|["']?\s*$/g, '');
    }
  }
  return out;
}

function ensureAuthSecret() {
  const f = path.join(app.getPath('userData'), 'auth-secret');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
  return fs.readFileSync(f, 'utf8').trim();
}

// Stable per-install secret the cron ticker sends as `Authorization: Bearer`,
// validated by /api/cron/tick against the same value in the child env.
function ensureCronSecret() {
  const f = path.join(app.getPath('userData'), 'cron-secret');
  if (!fs.existsSync(f)) {
    fs.writeFileSync(f, crypto.randomBytes(32).toString('hex').slice(0, 40), { mode: 0o600 });
  }
  return fs.readFileSync(f, 'utf8').trim();
}

// Desktop replacement for the container's in-entrypoint 60s ticker. A single
// POST /api/cron/tick self-seeds the per-user jobs (ensureDefaultJobsForAllUsers)
// and runs any whose next_run_at is due — the analyst (Artha) intraday/daily
// runs, news ingest, EOD review, self-tune, plus daily digest / alerts / SIPs.
// Only runs while the app is open (no always-on container here). Jobs that are
// time-anchored (IST) simply no-op until their window.
// Age (ms) of the newest self-backup in `dir`, or Infinity if none.
function newestBackupAgeMs(dir) {
  try {
    const files = fs.readdirSync(dir).filter((f) => /^artha-.*\.sql\.gz$/.test(f));
    if (!files.length) return Infinity;
    const newest = Math.max(...files.map((f) => fs.statSync(path.join(dir, f)).mtimeMs));
    return Date.now() - newest;
  } catch { return Infinity; }
}

// Periodic self-backup: dump Artha's DB to a .sql in the backups dir when the
// newest one is older than ~12h. Checks hourly + once at startup, so a daily
// user gets a roughly-daily backup without churning on quick relaunches. The
// container has an always-on backup LaunchAgent; the desktop backs up while
// it's open. Data itself always persists in pgdata — these are point-in-time
// snapshots, re-importable via the Import screen.
function startBackupTicker(baseUrl, cronSecret, backupDir) {
  const DUE_MS = 12 * 60 * 60 * 1000;
  const maybeBackup = async () => {
    if (newestBackupAgeMs(backupDir) < DUE_MS) return;
    try {
      const r = await fetch(`${baseUrl}/api/desktop/backup`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cronSecret}` },
      });
      const d = await r.json().catch(() => ({}));
      console.log(`[pfd] self-backup: ${r.ok ? d.file : 'failed ' + (d.error || r.status)}`);
    } catch (e) {
      console.error('[pfd] self-backup failed:', e.message);
    }
  };
  maybeBackup();
  backupTimer = setInterval(maybeBackup, 60 * 60 * 1000);
}

// Telegram two-way assistant ticker — POST /api/telegram/tick (poll inbound →
// process inbox → drain outbox) every ~5s, mirroring the container. No-ops when
// no bot token is set. Only the two-way assistant needs this; one-way alert/
// digest sends already ride the cron ticker.
function startTelegramTicker(baseUrl, cronSecret, intervalMs = 5_000) {
  const tick = async () => {
    try {
      await fetch(`${baseUrl}/api/telegram/tick`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cronSecret}` },
      });
    } catch { /* transient */ }
  };
  telegramTimer = setInterval(tick, intervalMs);
  console.log(`[pfd] telegram ticker on — POST /api/telegram/tick every ${intervalMs / 1000}s`);
}

function startCronTicker(baseUrl, cronSecret, intervalMs = 60_000) {
  const tick = async () => {
    try {
      await fetch(`${baseUrl}/api/cron/tick`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cronSecret}` },
      });
    } catch (e) {
      console.error('[pfd] cron tick failed:', e.message);
    }
  };
  tick(); // fire one immediately so due jobs don't wait a full interval
  cronTimer = setInterval(tick, intervalMs);
  console.log(`[pfd] cron ticker on — POST /api/cron/tick every ${intervalMs / 1000}s`);
}

async function waitForHealth(url, timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch { /* server not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function boot() {
  const userData = app.getPath('userData');
  const dataDir = path.join(userData, 'pgdata');
  const migrationsDir = resourcePath('drizzle');
  const standaloneDir = resourcePath('.next', 'standalone');
  const serverJs = path.join(standaloneDir, 'server.js');

  const nextPort = await freePort();

  // 0. Clear a stale postmaster.pid. A hard crash / force-kill / power loss
  // leaves this lock in pgdata, which can bring PGlite up READ-ONLY on the next
  // start (every UPDATE then fails with "read-only transaction" and health goes
  // db:down). Since always-on restarts Artha after a crash, recover here: if the
  // PID the lock names is no longer running, it's stale — remove it. If it IS
  // running, leave it (a real instance holds the DB).
  try {
    const pidFile = path.join(dataDir, 'postmaster.pid');
    if (fs.existsSync(pidFile)) {
      const pid = parseInt(fs.readFileSync(pidFile, 'utf8').split('\n')[0], 10);
      let alive = false;
      if (pid > 0) { try { process.kill(pid, 0); alive = true; } catch { alive = false; } }
      if (!alive) { fs.rmSync(pidFile, { force: true }); console.log('[pfd] cleared stale postmaster.pid (pid ' + pid + ' not running)'); }
    }
  } catch (e) { console.error('[pfd] postmaster.pid check failed:', e); }

  // 1. Apply migrations (open → migrate → close) before the server opens the DB.
  // db-bootstrap.mjs ships next to main.js (in the app), so resolve it from
  // __dirname — works in dev and in the packaged bundle. (The .next/standalone
  // and drizzle dirs are extraResources → resourcePath/process.resourcesPath.)
  const bootstrap = await import(pathToFileURL(path.join(__dirname, 'db-bootstrap.mjs')).href);
  const migRes = await bootstrap.runMigrations({ dataDir, migrationsDir });
  console.log(`[pfd] migrations applied: ${migRes.applied}/${migRes.total}`);

  // 2. Spawn Next standalone with PGlite in-process (PFD_DB_DRIVER=pglite).
  const authSecret = ensureAuthSecret();
  const cronSecret = ensureCronSecret();
  const fileEnv = loadDotEnv(); // .env.local fallback (dev) for OPENAI_API_KEY etc.
  const backupDir = path.join(app.getPath('documents'), 'Artha Backups');
  // OpenAI key: managed in-app via Settings → OpenAI key, which writes the raw
  // key to this file (OPENAI_KEY_FILE) and applies it live. On boot we load it
  // (so it persists across launches); a .env.local key is a dev-only fallback.
  // Never baked into the .dmg — each user sets their own.
  const openaiKeyFile = path.join(app.getPath('userData'), 'openai-api-key');
  let openaiKey = fileEnv.OPENAI_API_KEY || '';
  try {
    if (fs.existsSync(openaiKeyFile)) openaiKey = fs.readFileSync(openaiKeyFile, 'utf8').trim() || openaiKey;
  } catch { /* ignore */ }
  // Telegram bot token — same in-app pattern: Settings → Assistant → connect
  // Telegram writes the token to this file (TELEGRAM_TOKEN_FILE) and applies it
  // live; we load it on boot. TELEGRAM_CONNECT_MODE=getupdates enables the
  // in-app token/pairing flow (no public webhook on a desktop).
  const telegramTokenFile = path.join(app.getPath('userData'), 'telegram-bot-token');
  let telegramToken = fileEnv.TELEGRAM_BOT_TOKEN || '';
  try {
    if (fs.existsSync(telegramTokenFile)) telegramToken = fs.readFileSync(telegramTokenFile, 'utf8').trim() || telegramToken;
  } catch { /* ignore */ }
  const baseUrl = `http://localhost:${nextPort}`;
  const env = {
    // CURATED env — do NOT spread the Electron GUI process's full env. It
    // carries injected vars that break Next's RSC rendering (server-component
    // `auth()` returns null → every authed page 307s back to /login, while API
    // routes still work). A clean, node-like env fixes it (a node-parent spawn
    // works precisely because its env lacks those Electron additions).
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    LANG: process.env.LANG,
    // NOTE: we deliberately do NOT set TZ=UTC here. The DATABASE session is
    // pinned to UTC in src/db/index.ts (`SET TIME ZONE 'UTC'`) so naive
    // `timestamp` columns store UTC and the SQL `AT TIME ZONE` display
    // conversions on the jobs page are correct. Forcing the whole *process* to
    // UTC additionally broke server-side JavaScript date formatting (anything
    // not explicitly bound to Asia/Kolkata rendered 5:30 behind), so the process
    // keeps the host's local timezone while the DB stays UTC.
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
    HOSTNAME: 'localhost',
    PORT: String(nextPort),
    PFD_DB_DRIVER: 'pglite',
    PFD_PGLITE_DIR: dataDir,
    PFD_MIGRATIONS_DIR: migrationsDir, // import-db route marks these applied after a restore
    AUTH_SECRET: authSecret,
    AUTH_URL: baseUrl,
    NEXTAUTH_URL: baseUrl,
    // Auth.js v5 auto-trusts only `localhost`; on 127.0.0.1:<random-port> it
    // treats the host as untrusted and `auth()` silently returns null in RSC
    // (server components), so authed pages 307 to /login even with a valid
    // session cookie — while route handlers still resolve it. Trust the host
    // explicitly. (Docker prod worked only because it uses `localhost`.)
    AUTH_TRUST_HOST: 'true',
    DEMO_PERSONAL_SWITCH: 'true', // local account chooser, no email round-trip
    MAGIC_LINK_DISPLAY: 'ui',
    // The app validates /api/cron/tick + /api/desktop/backup against this.
    CRON_SECRET: cronSecret,
    PFD_BACKUP_DIR: backupDir, // where /api/desktop/backup writes self-backups
    // Analyst (Artha) LLM key + where Settings persists it (raw key file).
    OPENAI_KEY_FILE: openaiKeyFile,
    ...(openaiKey ? { OPENAI_API_KEY: openaiKey } : {}),
    // Telegram: in-app token management + getUpdates pairing (no webhook).
    TELEGRAM_TOKEN_FILE: telegramTokenFile,
    TELEGRAM_CONNECT_MODE: 'getupdates',
    ...(telegramToken ? { TELEGRAM_BOT_TOKEN: telegramToken } : {}),
  };
  // Spawn via nodeRunner() — the dockless LSUIElement Helper on macOS — so the
  // Next server child doesn't register as a second app in the Dock.
  const runner = nodeRunner();
  console.log(`[pfd] next server runner: ${runner}`);
  nextChild = spawn(runner, [serverJs], { env, cwd: standaloneDir, stdio: 'inherit' });
  nextChild.on('exit', (code) => console.log(`[pfd] next server exited: ${code}`));

  // 3. Window once healthy.
  const healthy = await waitForHealth(`${baseUrl}/api/health`);
  if (!healthy) {
    dialog.showErrorBox('pfd', 'The local server did not start in time. See logs.');
    app.quit();
    return;
  }
  appBaseUrl = baseUrl;
  createWindow();

  // Drive the scheduler (analyst runs, digest, alerts, SIPs) while the app is open.
  startCronTicker(baseUrl, cronSecret);
  // Telegram two-way assistant (no-op until a bot token is set in Settings).
  startTelegramTicker(baseUrl, cronSecret);
  // Periodic self-backup of Artha's own data (~/Documents/Artha Backups).
  startBackupTicker(baseUrl, cronSecret, backupDir);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    title: 'Personal Finance',
    backgroundColor: '#0b0b0c',
    webPreferences: { contextIsolation: true },
  });
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) =>
    console.error(`[pfd] window load failed: ${code} ${desc} ${url}`));
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadURL(appBaseUrl);
}

function cleanup() {
  if (cronTimer) { clearInterval(cronTimer); cronTimer = null; }
  if (backupTimer) { clearInterval(backupTimer); backupTimer = null; }
  if (telegramTimer) { clearInterval(telegramTimer); telegramTimer = null; }
  // Killing the Next child releases the in-process PGlite (it holds the DB).
  try { if (nextChild) nextChild.kill(); } catch { /* ignore */ }
  nextChild = null;
}

app.whenReady().then(boot).catch((e) => {
  dialog.showErrorBox('pfd — startup failed', String(e && e.stack ? e.stack : e));
  app.quit();
});

// Always-on: closing the window does NOT stop Artha — the server, cron, and
// analyst keep running in the background. Re-open the window from the Dock icon
// (the 'activate' handler). Only an explicit Quit (Cmd-Q) tears things down.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') { cleanup(); app.quit(); }
});
app.on('activate', () => {
  if (mainWindow === null && appBaseUrl) createWindow();
});
app.on('before-quit', cleanup);
