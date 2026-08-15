/**
 * Database connection for pfd-saas — one `db`, two drivers, same Drizzle schema
 * and query layer:
 *
 *  - default: postgres-js against DATABASE_URL (SaaS / Docker / dev Postgres).
 *  - PFD_DB_DRIVER=pglite: in-process PGlite at PFD_PGLITE_DIR — the desktop
 *    build. No Docker, no server, no connection pool: PGlite runs inside this
 *    Node process and serialises queries, so there is nothing to reset. The
 *    launcher (electron/main.js) applies migrations before this process starts,
 *    then opens the same data dir here.
 *
 * The pglite path is only taken when the env flag is set; every other
 * deployment behaves exactly as before.
 */

import { drizzle as drizzlePg, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import * as schema from './schema';

let dbInstance: PostgresJsDatabase<typeof schema>;
let pgliteInstance: PGlite | null = null;

if (process.env.PFD_DB_DRIVER === 'pglite') {
  const dir = process.env.PFD_PGLITE_DIR;
  if (!dir) {
    throw new Error('PFD_PGLITE_DIR is required when PFD_DB_DRIVER=pglite');
  }
  pgliteInstance = new PGlite(dir);
  // Both drivers are PgDatabase subclasses with an identical query API; the
  // cast keeps the app's existing postgres-js-typed call sites happy while the
  // runtime object is the pglite one.
  dbInstance = drizzlePglite(pgliteInstance, { schema }) as unknown as PostgresJsDatabase<typeof schema>;
} else {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Expected a postgresql:// URL — see .env.local.',
    );
  }
  const client = postgres(url, {
    // PFD_DB_MAX pins the pool size when set; otherwise the normal default.
    max: process.env.PFD_DB_MAX
      ? Number(process.env.PFD_DB_MAX)
      : process.env.NODE_ENV === 'production'
        ? 10
        : 5,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false, // pgbouncer-friendly; safe to drop later if not behind one
  });
  dbInstance = drizzlePg(client, { schema });
}

export const db = dbInstance;
// Raw PGlite handle (desktop only) — used by the backup route to dump the DB.
export const pglite = pgliteInstance;

export * from './schema';
