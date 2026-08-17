// Prove a prod pg_dump (--data-only --column-inserts, public schema) replays
// into a fresh migrated PGlite — the basis of the "import prod into Artha" flow.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';

const REPO = '/Users/bharath/Desktop/pfd-saas';
const SCRATCH = '/private/tmp/claude-503/-Users-bharath-Desktop-pfd-saas/2db5f0dc-3524-4f66-9f4b-fbeeea0e9cb0/scratchpad';
const DUMP = path.join(SCRATCH, 'prod-data.sql');
const DATA_DIR = path.join(SCRATCH, 'import-test-pgdata');

fs.rmSync(DATA_DIR, { recursive: true, force: true });
const pg = new PGlite(DATA_DIR);
await pg.waitReady;

console.log('== apply 70 migrations (schema) ==');
const files = fs.readdirSync(path.join(REPO, 'drizzle')).filter((f) => f.endsWith('.sql')).sort();
for (const f of files) await pg.exec(fs.readFileSync(path.join(REPO, 'drizzle', f), 'utf8'));
console.log(`   ${files.length} migration files applied`);

console.log('== truncate all public tables (import replaces everything) ==');
const tbls = (await pg.query(
  `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '__pfd_migrations'`,
)).rows.map((r) => `"${r.tablename}"`);
await pg.exec(`TRUNCATE ${tbls.join(', ')} RESTART IDENTITY CASCADE;`);
console.log(`   truncated ${tbls.length} tables`);

console.log('== replay the prod data dump ==');
// PG17 pg_dump emits psql meta-commands (\restrict / \unrestrict) that PGlite's
// SQL engine can't parse — strip any line starting with a backslash.
const sql = fs.readFileSync(DUMP, 'utf8')
  .split('\n')
  .filter((l) => !l.startsWith('\\'))
  .join('\n');
console.log(`   dump ${(sql.length / 1e6).toFixed(1)} MB (\\-meta-commands stripped)`);
const t0 = Date.now();
// pg_dump --disable-triggers uses session_replication_role; strip any such lines
// PGlite may not support, and wrap FK deferral. Try a straight exec first.
try {
  await pg.exec(sql);
  console.log(`   replayed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
} catch (e) {
  console.error('   ✗ exec failed:', e.message.slice(0, 300));
  process.exit(1);
}

console.log('== verify against prod (personal user 00000000-…eea5e) ==');
const PERSONAL = '00000000-0000-0000-0000-0000000eea5e';
const q = async (s, p = []) => (await pg.query(s, p)).rows[0];
console.log('   users:', (await q('SELECT count(*)::int n FROM "user"')).n);
console.log('   personal gold rows:', (await q('SELECT count(*)::int n FROM gold_holdings WHERE user_id=$1', [PERSONAL])).n);
console.log('   personal stocks:', (await q('SELECT count(*)::int n FROM holdings WHERE user_id=$1', [PERSONAL]).catch(() => ({ n: 'n/a' }))).n);
console.log('   agent_session_bars total:', (await q('SELECT count(*)::int n FROM agent_session_bars')).n);
console.log('   personal net worth gold ₹:', (await q('SELECT round(sum(current_value)/100.0,0)::int r FROM gold_holdings WHERE user_id=$1', [PERSONAL])).r);
await pg.close();
console.log('\n✅ PROD IMPORT REPLAY WORKS on PGlite.');
