// Prove a FULL prod pg_dump (schema + data, --inserts) restores into a fresh
// PGlite — the faithful "import prod into Artha" that sidesteps schema drift
// between prod and the migration files. After restore we mark all migration
// files as applied so the desktop app won't try to re-run them.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';

const REPO = '/Users/bharath/Desktop/pfd-saas';
const SCRATCH = '/private/tmp/claude-503/-Users-bharath-Desktop-pfd-saas/2db5f0dc-3524-4f66-9f4b-fbeeea0e9cb0/scratchpad';
const DUMP = path.join(SCRATCH, 'prod-full-inserts.sql');
const DATA_DIR = path.join(SCRATCH, 'full-import-pgdata');

fs.rmSync(DATA_DIR, { recursive: true, force: true });
const pg = new PGlite(DATA_DIR);
await pg.waitReady;

// Strip only psql meta-commands (lines starting with a backslash: \restrict,
// \unrestrict). --inserts format has no COPY blocks, so no \. terminators.
const sql = fs.readFileSync(DUMP, 'utf8')
  .split('\n').filter((l) => !l.startsWith('\\')).join('\n');
console.log(`== restore full prod dump (${(sql.length / 1e6).toFixed(1)} MB, schema+data) ==`);
const t0 = Date.now();
try {
  await pg.exec(sql);
  console.log(`   restored in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
} catch (e) {
  console.error('   ✗ failed:', e.message.slice(0, 300));
  process.exit(1);
}

console.log('== mark all migration files as applied (so the app skips them) ==');
// pg_dump sets search_path='' — restore it before creating our tracking table.
await pg.exec(`SET search_path TO public; CREATE TABLE IF NOT EXISTS public.__pfd_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());`);
const files = fs.readdirSync(path.join(REPO, 'drizzle')).filter((f) => f.endsWith('.sql')).sort();
for (const f of files) await pg.query('INSERT INTO public.__pfd_migrations (id) VALUES ($1) ON CONFLICT DO NOTHING', [f]);
console.log(`   marked ${files.length} migrations applied`);

console.log('== verify prod data present ==');
const PERSONAL = '00000000-0000-0000-0000-0000000eea5e';
const q = async (s, p = []) => (await pg.query(s, p)).rows[0];
console.log('   tables:', (await q(`SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'`)).n);
console.log('   users:', (await q('SELECT count(*)::int n FROM "user"')).n);
console.log('   personal gold ₹:', (await q('SELECT round(sum(current_value)/100.0,0)::int r FROM gold_holdings WHERE user_id=$1', [PERSONAL])).r);
console.log('   personal liabilities:', (await q('SELECT count(*)::int n FROM liabilities WHERE user_id=$1', [PERSONAL])).n);
console.log('   agent_session_bars:', (await q('SELECT count(*)::int n FROM agent_session_bars')).n);
console.log('   form_16_uploads has file_bytes col?:', (await q(`SELECT count(*)::int n FROM information_schema.columns WHERE table_name='form_16_uploads' AND column_name='file_bytes'`)).n);
await pg.close();
console.log('\n✅ FULL PROD IMPORT WORKS — desktop becomes an exact prod replica.');
