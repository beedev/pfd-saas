/**
 * POST /api/desktop/import-db — restore a full pg_dump into the desktop's
 * embedded PGlite, replacing everything (schema + data). Used to seed Artha
 * from a production backup:
 *
 *   docker exec vaspar-pfd pg_dump "$DATABASE_URL" --no-owner --no-privileges \
 *     --inserts > artha-backup.sql        # then upload it here
 *
 * Desktop-only: it needs the raw in-process PGlite handle, which only exists
 * when PFD_DB_DRIVER=pglite. On SaaS/Docker (`pglite` is null) it 400s.
 *
 * The prod schema can drift from the migration files, so we restore prod's
 * OWN schema (full dump) rather than importing data into the migrated schema,
 * then mark every migration file as applied so the launcher won't re-run them.
 */
import { NextRequest, NextResponse } from 'next/server';
import { readdirSync } from 'node:fs';
import zlib from 'node:zlib';
import { pglite } from '@/db';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';

export const runtime = 'nodejs';
export const maxDuration = 600;

export async function POST(req: NextRequest) {
  if (!pglite) {
    return NextResponse.json(
      { error: 'Import is only available in the desktop app.' },
      { status: 400 },
    );
  }
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();

  const form = await req.formData().catch(() => null);
  const file = form?.get('backup');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No backup file uploaded (field "backup").' }, { status: 400 });
  }

  // Accept either a plain .sql (prod pg_dump) or a gzipped self-backup (.sql.gz).
  let bytes = Buffer.from(await file.arrayBuffer());
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = zlib.gunzipSync(bytes);
  // PG17 pg_dump emits psql meta-commands (\restrict / \unrestrict) PGlite can't
  // parse. --inserts has no COPY blocks, so dropping every backslash line is safe.
  const sql = bytes.toString('utf8')
    .split('\n')
    .filter((l) => !l.startsWith('\\'))
    .join('\n');

  if (!/INSERT INTO|CREATE TABLE/i.test(sql)) {
    return NextResponse.json({ error: 'That file does not look like a pg_dump backup.' }, { status: 400 });
  }

  try {
    // Replace everything. pg_dump sets search_path='' at the top, so restore it
    // before creating our own tracking table afterwards.
    await pglite.exec('DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    await pglite.exec(sql);
    await pglite.exec(
      'SET search_path TO public; CREATE TABLE IF NOT EXISTS public.__pfd_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());',
    );

    // Mark every migration as applied so the next launch skips them (the
    // restored schema is prod's, complete and possibly drifted from the files).
    const migDir = process.env.PFD_MIGRATIONS_DIR;
    if (migDir) {
      const files = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
      for (const f of files) {
        await pglite.query('INSERT INTO public.__pfd_migrations (id) VALUES ($1) ON CONFLICT DO NOTHING', [f]);
      }
    }

    const tables = (await pglite.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'`,
    )).rows[0].n;
    const users = (await pglite.query<{ n: number }>('SELECT count(*)::int AS n FROM "user"')).rows[0].n;

    // The restore replaced the session table too, so the caller's cookie is now
    // stale — the UI should send the user back to /login to re-pick an account.
    return NextResponse.json({ ok: true, tables, users, reloginRequired: true });
  } catch (err) {
    console.error('[import-db] restore failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'restore failed' },
      { status: 500 },
    );
  }
}
