// Desktop DB bootstrap: embed PGlite, apply migrations, expose it over a local
// Postgres-wire socket so the unchanged Next server (postgres-js) connects via
// DATABASE_URL exactly as it does against real Postgres.
//
// Migrations are applied with PGlite.exec() (simple query protocol — allows
// multiple statements per file), because the repo's hand-authored migrations
// lack the `--> statement-breakpoint` markers drizzle's migrator needs. We track
// applied files in a __pfd_migrations table so every boot only runs new ones.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import fs from 'node:fs';
import path from 'node:path';

async function applyMigrations(pg, migrationsDir) {
  await pg.exec(`CREATE TABLE IF NOT EXISTS __pfd_migrations (
    id text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  );`);
  const done = new Set(
    (await pg.query('SELECT id FROM __pfd_migrations')).rows.map((r) => r.id),
  );
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // 0000_*.sql .. NNNN_*.sql — lexical == chronological
  let applied = 0;
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
    await pg.exec(sql);
    await pg.query('INSERT INTO __pfd_migrations (id) VALUES ($1)', [f]);
    applied += 1;
  }
  return { applied, total: files.length };
}

/**
 * Open PGlite at dataDir, apply any pending migrations, and start a
 * Postgres-wire socket server on socketPort. Returns a handle with stop().
 */
export async function migrateAndServe({ dataDir, migrationsDir, socketPort, host = '127.0.0.1' }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const pg = new PGlite(dataDir);
  await pg.waitReady;

  const migRes = await applyMigrations(pg, migrationsDir);

  const server = new PGLiteSocketServer({ db: pg, port: socketPort, host });
  await server.start();

  return {
    migrations: migRes,
    socketPort,
    async stop() {
      try { await server.stop(); } catch { /* ignore */ }
      try { await pg.close(); } catch { /* ignore */ }
    },
    // Consistent backup — a single .tar.gz blob of the whole DB.
    async dump() {
      return pg.dumpDataDir('gzip');
    },
  };
}
