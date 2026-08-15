// Desktop DB migrator. The desktop build embeds PGlite *in-process* inside the
// Next server (src/db/index.ts, PFD_DB_DRIVER=pglite) — no socket, no pool, so
// nothing to reset under concurrency. Since PGlite is single-process, the
// launcher applies migrations here (open → migrate → close) BEFORE spawning the
// Next server, which then opens the same data dir.
//
// Migrations run via PGlite.exec() (simple query protocol — multiple statements
// per file), because the repo's hand-authored migrations lack drizzle's
// `--> statement-breakpoint` markers. Applied files are tracked in
// __pfd_migrations so each boot only runs new ones.
import { PGlite } from '@electric-sql/pglite';
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

/** Open PGlite at dataDir, apply any pending migrations, close. Returns counts. */
export async function runMigrations({ dataDir, migrationsDir }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const pg = new PGlite(dataDir);
  await pg.waitReady;
  try {
    return await applyMigrations(pg, migrationsDir);
  } finally {
    await pg.close();
  }
}
