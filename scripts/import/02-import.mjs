#!/usr/bin/env node
/**
 * Sprint 1.5 Phase 2 — import personal v1 data into pfd_saas Postgres.
 *
 * Reads tmp/v1-export/*.json (produced by 01-export-v1.mjs) and inserts
 * each row into the matching pfd-saas table, stamped with the owner's
 * user.id. Type-aware: converts SQLite integer epochs to Date for
 * timestamp columns, and 0/1 to true/false for boolean columns.
 *
 * Per-table transactions: a failure in one table is logged but does not
 * abort the rest of the import. The smoke test in Phase 3 picks up any
 * pages affected by a partial import.
 *
 * After all data lands, every serial primary key sequence is bumped to
 * MAX(id) so the next app-driven INSERT doesn't collide.
 *
 * Usage:
 *   node scripts/import/02-import.mjs --owner-email=you@example.com
 *   node scripts/import/02-import.mjs --owner-email=... --only=table1,table2
 *
 * Loads DATABASE_URL from .env.local automatically. The optional --only
 * flag restricts the import to the listed tables (used in Sprint 1.5
 * Phase 2 to retry the three tables that failed first pass).
 */

import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import postgres from 'postgres';
import fs from 'node:fs';
import path from 'node:path';

// ─── args ───────────────────────────────────────────────────────────
const ownerEmailArg = process.argv.find((a) => a.startsWith('--owner-email='));
if (!ownerEmailArg) {
  console.error('ERROR: pass --owner-email=you@example.com');
  process.exit(2);
}
const OWNER_EMAIL = ownerEmailArg.split('=')[1];

const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const ONLY_TABLES = onlyArg
  ? new Set(onlyArg.split('=')[1].split(',').map((s) => s.trim()))
  : null;

const EXPORT_DIR = path.join(process.cwd(), 'tmp', 'v1-export');
if (!fs.existsSync(EXPORT_DIR)) {
  console.error(`ERROR: ${EXPORT_DIR} not found — run 01-export-v1.mjs first.`);
  process.exit(2);
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not set (check .env.local)');
  process.exit(2);
}

// Tables that intentionally do NOT have user_id (global / auth).
const NO_USER_ID_STAMP = new Set([
  'sac_codes', // global GST reference
]);

// ─── connect ────────────────────────────────────────────────────────
const sql = postgres(DATABASE_URL, { max: 4, prepare: false });

// ─── owner lookup ───────────────────────────────────────────────────
const owners = await sql`SELECT id, email FROM "user" WHERE email = ${OWNER_EMAIL}`;
if (owners.length === 0) {
  console.error(`ERROR: no user row with email=${OWNER_EMAIL}. Sign in first via /login.`);
  await sql.end();
  process.exit(2);
}
const ownerId = owners[0].id;
console.log(`Owner: ${OWNER_EMAIL} → user.id=${ownerId}\n`);

// ─── introspect schema: column types per table ──────────────────────
const colRows = await sql`
  SELECT table_name, column_name, data_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
`;
const colTypes = new Map(); // tableName -> { colName -> dataType }
for (const r of colRows) {
  if (!colTypes.has(r.table_name)) colTypes.set(r.table_name, {});
  colTypes.get(r.table_name)[r.column_name] = r.data_type;
}

// Identify columns with a 'nextval' default — these are serial PKs that
// need sequence reset after import.
const seqRows = await sql`
  SELECT table_name, column_name, pg_get_serial_sequence(table_name, column_name) AS seq
  FROM information_schema.columns
  WHERE table_schema = 'public' AND column_default LIKE 'nextval%'
`;
const serialPks = seqRows
  .filter((r) => r.seq)
  .map((r) => ({ table: r.table_name, column: r.column_name, seq: r.seq }));

// ─── FK graph + topological sort ───────────────────────────────────
const fkRows = await sql`
  SELECT
    tc.table_name AS child,
    ccu.table_name AS parent
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
  JOIN information_schema.constraint_column_usage ccu
    ON tc.constraint_name = ccu.constraint_name
  WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
`;

function topoSort(tables) {
  const deps = new Map(tables.map((t) => [t, new Set()]));
  for (const { child, parent } of fkRows) {
    if (deps.has(child) && deps.has(parent) && child !== parent) {
      // Don't follow FKs into "user" (it's not in the import set).
      if (parent === 'user') continue;
      deps.get(child).add(parent);
    }
  }
  const sorted = [];
  const remaining = new Set(tables);
  while (remaining.size > 0) {
    let progressed = false;
    for (const t of [...remaining]) {
      const blockedBy = [...deps.get(t)].filter((d) => remaining.has(d));
      if (blockedBy.length === 0) {
        sorted.push(t);
        remaining.delete(t);
        progressed = true;
      }
    }
    if (!progressed) {
      console.warn(`WARN: unsolved FK cycle, flushing remainder: ${[...remaining]}`);
      sorted.push(...remaining);
      break;
    }
  }
  return sorted;
}

// ─── enumerate export files ────────────────────────────────────────
let files = fs.readdirSync(EXPORT_DIR)
  .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
  .map((f) => path.basename(f, '.json'));

if (ONLY_TABLES) {
  const missing = [...ONLY_TABLES].filter((t) => !files.includes(t));
  if (missing.length > 0) {
    console.error(`ERROR: --only includes tables not in export: ${missing.join(', ')}`);
    await sql.end();
    process.exit(2);
  }
  files = files.filter((t) => ONLY_TABLES.has(t));
  console.log(`--only filter: limiting to ${files.length} table(s): ${files.join(', ')}\n`);
}

const orderedTables = topoSort(files);
console.log(`Import order (${orderedTables.length} tables):`);
console.log(`  ${orderedTables.join(' → ')}\n`);

// ─── row transform ─────────────────────────────────────────────────
function transformRow(table, row) {
  const types = colTypes.get(table) ?? {};
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined) {
      out[k] = null;
      continue;
    }
    const t = types[k];
    if (!t) {
      // Column exists in v1 but not in pfd-saas — skip silently. Will surface
      // in row-count reconciliation if the schema actually drifted.
      continue;
    }
    if (t === 'boolean' && typeof v === 'number') {
      out[k] = v !== 0;
    } else if ((t === 'timestamp without time zone' || t === 'timestamp with time zone')
               && typeof v === 'number') {
      out[k] = new Date(v * 1000);
    } else {
      out[k] = v;
    }
  }
  if (!NO_USER_ID_STAMP.has(table) && colTypes.get(table)?.user_id) {
    out.user_id = ownerId;
  }
  return out;
}

// ─── insert per table ──────────────────────────────────────────────
const report = { ok: [], failed: [], skipped: [] };

for (const table of orderedTables) {
  const file = path.join(EXPORT_DIR, `${table}.json`);
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));

  if (rows.length === 0) {
    report.skipped.push({ table, reason: 'empty in v1' });
    console.log(`  empty   ${table}`);
    continue;
  }

  try {
    await sql.begin(async (tx) => {
      for (const raw of rows) {
        const row = transformRow(table, raw);
        await tx`INSERT INTO ${tx(table)} ${tx(row)}`;
      }
    });
    report.ok.push({ table, rows: rows.length });
    console.log(`  ok      ${table.padEnd(34)} ${String(rows.length).padStart(6)} rows`);
  } catch (err) {
    report.failed.push({ table, rows: rows.length, error: String(err.message ?? err) });
    console.error(`  FAIL    ${table.padEnd(34)} ${String(rows.length).padStart(6)} rows — ${err.message}`);
  }
}

// ─── bump serial sequences ─────────────────────────────────────────
console.log('\nResetting serial sequences...');
for (const { table, column, seq } of serialPks) {
  try {
    const max = await sql`SELECT COALESCE(MAX(${sql(column)}), 0) AS m FROM ${sql(table)}`;
    const m = Number(max[0].m);
    if (m > 0) {
      // setval needs a literal sequence name and a number. Use raw SQL.
      await sql`SELECT setval(${seq}, ${m})`;
      console.log(`  ${table}.${column} → ${m}`);
    }
  } catch (err) {
    console.error(`  WARN ${table}.${column}: ${err.message}`);
  }
}

// ─── reconciliation ────────────────────────────────────────────────
console.log('\nReconciliation:');
let totalOk = 0;
let totalFailed = 0;
for (const r of report.ok) totalOk += r.rows;
for (const r of report.failed) totalFailed += r.rows;
console.log(`  ok:      ${report.ok.length} tables, ${totalOk} rows`);
console.log(`  empty:   ${report.skipped.length} tables`);
console.log(`  failed:  ${report.failed.length} tables, ${totalFailed} rows would-be`);

if (report.failed.length > 0) {
  console.log('\nFailures:');
  for (const f of report.failed) {
    console.log(`  ${f.table}: ${f.error}`);
  }
}

fs.writeFileSync(
  path.join(EXPORT_DIR, '_import-report.json'),
  JSON.stringify({ ownerId, ownerEmail: OWNER_EMAIL, at: new Date().toISOString(), ...report }, null, 2),
);
console.log(`\nReport: ${path.join(EXPORT_DIR, '_import-report.json')}`);

await sql.end();
process.exit(report.failed.length > 0 ? 1 : 0);
