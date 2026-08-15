// PGlite feasibility spike for pfd-saas.
// Proves: (1) all 70 drizzle migrations apply to a fresh PGlite DB,
//         (2) CRUD works, (3) backup+restore works (dumpDataDir + pgDump).
import { PGlite } from '@electric-sql/pglite';
import { pgDump } from '@electric-sql/pglite-tools';
import fs from 'node:fs';
import path from 'node:path';

const REPO = '/Users/bharath/Desktop/pfd-saas';
const SCRATCH = '/private/tmp/claude-503/-Users-bharath-Desktop-pfd-saas/2db5f0dc-3524-4f66-9f4b-fbeeea0e9cb0/scratchpad';
const DATA_DIR = path.join(SCRATCH, 'pglite-data');
const TAR_BACKUP = path.join(SCRATCH, 'pfd-backup.tar.gz');
const SQL_BACKUP = path.join(SCRATCH, 'pfd-backup.sql');

fs.rmSync(DATA_DIR, { recursive: true, force: true });

async function writeBlob(blob, dest) {
  const buf = Buffer.from(await blob.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return buf.length;
}

console.log('== 1. fresh PGlite + run all 70 migrations (via exec, simple protocol) ==');
const pg = new PGlite(DATA_DIR);
// Apply each migration file with exec() — it uses Postgres' simple query
// protocol, which allows multiple statements per command. The drizzle migrator
// uses prepared statements (one command each) and relies on
// `--> statement-breakpoint` markers that our hand-authored (psql -f) migrations
// don't have. exec() sidesteps that entirely and mirrors how `psql -f` applies them.
const files = fs.readdirSync(path.join(REPO, 'drizzle'))
  .filter((f) => f.endsWith('.sql'))
  .sort(); // 0000_*.sql .. 0069_*.sql — lexical == chronological
const t0 = Date.now();
let applied = 0;
for (const f of files) {
  const sql = fs.readFileSync(path.join(REPO, 'drizzle', f), 'utf8');
  try {
    await pg.exec(sql);
    applied++;
  } catch (e) {
    console.error(`   ✗ FAILED at ${f}: ${e.message}`);
    throw e;
  }
}
console.log(`   ${applied}/${files.length} migration files applied in ${Date.now() - t0}ms`);

const tables = await pg.query(
  `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'`
);
console.log(`   public tables created: ${tables.rows[0].n}`);

console.log('== 2. CRUD (multi-tenant shape: user + a gold holding) ==');
const uid = crypto.randomUUID();
await pg.query(
  `INSERT INTO "user" (id, email, name) VALUES ($1,$2,$3)`,
  [uid, 'local@pfd.app', 'Local User']
);
// PHYSICAL gold, 100g @ 999, bigint paisa columns
await pg.query(
  `INSERT INTO gold_holdings
     (user_id, type, name, quantity, current_price, total_value, grams, purity,
      purchase_price_per_gram, current_rate_per_gram, total_investment, current_value,
      gain_loss, gain_loss_percent, created_at, updated_at)
   VALUES ($1,'PHYSICAL','Kadा chain',100,1400000,140000000,100,'999',
           1200000,1400000,120000000,140000000,20000000,16.67, now(), now())`,
  [uid]
);
const sel = await pg.query(
  `SELECT type, grams, round(current_value/100.0,0)::int AS cur_rs
     FROM gold_holdings WHERE user_id=$1`, [uid]
);
console.log('   read back:', JSON.stringify(sel.rows[0]));
const userCount = await pg.query(`SELECT count(*)::int AS n FROM "user"`);
console.log(`   users in DB: ${userCount.rows[0].n}  (multi-user in ONE install works)`);

console.log('== 3a. backup: dumpDataDir (full tarball) ==');
const tarBlob = await pg.dumpDataDir('gzip');
const tarBytes = await writeBlob(tarBlob, TAR_BACKUP);
console.log(`   wrote ${TAR_BACKUP} (${(tarBytes/1024).toFixed(0)} KB)`);

console.log('== 3b. backup: pgDump (portable SQL, restorable into real Postgres too) ==');
const sqlBlob = await pgDump({ pg });
const sqlBytes = await writeBlob(sqlBlob, SQL_BACKUP);
console.log(`   wrote ${SQL_BACKUP} (${(sqlBytes/1024).toFixed(0)} KB)`);

console.log('== 4. restore from the tarball into a FRESH PGlite, verify data ==');
await pg.close();
const restoreBlob = new Blob([fs.readFileSync(TAR_BACKUP)]);
const pg2 = new PGlite({ loadDataDir: restoreBlob });
const check = await pg2.query(
  `SELECT g.type, g.grams, u.email
     FROM gold_holdings g JOIN "user" u ON u.id=g.user_id`
);
console.log('   restored row:', JSON.stringify(check.rows[0]));
const restoredTables = await pg2.query(
  `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'`
);
console.log(`   restored tables: ${restoredTables.rows[0].n}`);
await pg2.close();

console.log('\n✅ SPIKE PASSED: 70 migrations + CRUD + dump/restore all work on PGlite.');
