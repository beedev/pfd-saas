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

function ensureAuthSecret() {
  const f = path.join(app.getPath('userData'), 'auth-secret');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
  return fs.readFileSync(f, 'utf8').trim();
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

  // 1. Apply migrations (open → migrate → close) before the server opens the DB.
  const bootstrap = await import(pathToFileURL(resourcePath('electron', 'db-bootstrap.mjs')).href);
  const migRes = await bootstrap.runMigrations({ dataDir, migrationsDir });
  console.log(`[pfd] migrations applied: ${migRes.applied}/${migRes.total}`);

  // 2. Spawn Next standalone with PGlite in-process (PFD_DB_DRIVER=pglite).
  const authSecret = ensureAuthSecret();
  const baseUrl = `http://127.0.0.1:${nextPort}`;
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
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
    HOSTNAME: '127.0.0.1',
    PORT: String(nextPort),
    PFD_DB_DRIVER: 'pglite',
    PFD_PGLITE_DIR: dataDir,
    AUTH_SECRET: authSecret,
    AUTH_URL: baseUrl,
    NEXTAUTH_URL: baseUrl,
    DEMO_PERSONAL_SWITCH: 'true', // local account chooser, no email round-trip
    MAGIC_LINK_DISPLAY: 'ui',
    DISABLE_CRON: 'true',         // no Telegram/scheduler in the desktop build
  };
  nextChild = spawn(process.execPath, [serverJs], { env, cwd: standaloneDir, stdio: 'inherit' });
  nextChild.on('exit', (code) => console.log(`[pfd] next server exited: ${code}`));

  // 3. Window once healthy.
  const healthy = await waitForHealth(`${baseUrl}/api/health`);
  if (!healthy) {
    dialog.showErrorBox('pfd', 'The local server did not start in time. See logs.');
    app.quit();
    return;
  }
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    title: 'Personal Finance',
    backgroundColor: '#0b0b0c',
    webPreferences: { contextIsolation: true },
  });

  win.webContents.on('did-fail-load', (_e, code, desc, url) =>
    console.error(`[pfd] window load failed: ${code} ${desc} ${url}`));
  win.loadURL(baseUrl);
}

function cleanup() {
  // Killing the Next child releases the in-process PGlite (it holds the DB).
  try { if (nextChild) nextChild.kill(); } catch { /* ignore */ }
  nextChild = null;
}

app.whenReady().then(boot).catch((e) => {
  dialog.showErrorBox('pfd — startup failed', String(e && e.stack ? e.stack : e));
  app.quit();
});

app.on('window-all-closed', () => { cleanup(); app.quit(); });
app.on('before-quit', cleanup);
