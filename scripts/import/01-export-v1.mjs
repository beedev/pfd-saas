#!/usr/bin/env node
/**
 * Sprint 1.5 Phase 1 — export personal v1 SQLite data as JSON.
 *
 * Read-only on the source DB. Personal v1 is never modified. For each
 * table present in BOTH v1 and the pfd-saas schema, we dump every row
 * to tmp/v1-export/<table>.json. The import script (02-import.mjs)
 * later reads these and stamps user_id on insert.
 *
 * Schema-aware skips:
 *  - transformation_*  →  dropped in pfd-saas Sprint 1 Phase 1; skip.
 *  - Auth.js tables (user, account, session, verification_token)
 *                      →  exist only in pfd-saas; nothing to export.
 *
 * Output: tmp/v1-export/<table>.json — one JSON array per table.
 * Plus tmp/v1-export/_manifest.json — table:rowcount summary.
 *
 * Run from /Users/bharath/Desktop/pfd-saas:
 *   node scripts/import/01-export-v1.mjs
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const V1_DB = '/Users/bharath/Desktop/personal-finance-dashboard/personal-finance.db';
const OUT_DIR = path.join(process.cwd(), 'tmp', 'v1-export');

// Tables pfd-saas intentionally does not have (Sprint 1 Phase 1 + 2 drops).
const SKIP_FROM_V1 = new Set([
  'transformation_plans',
  'transformation_sections',
  'transformation_items',
  'transformation_days',
  'transformation_checks',
]);

// Tables pfd-saas added (Auth.js) — no v1 counterpart; not in this script.
// Listed here for documentation only.
// const PFD_SAAS_ONLY = new Set(['user', 'account', 'session', 'verification_token']);

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(V1_DB)) fail(`personal v1 DB not found at ${V1_DB}`);

const db = new Database(V1_DB, { readonly: true, fileMustExist: true });

// Discover v1 tables (excluding sqlite_* internal tables).
const v1Tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all()
  .map((r) => r.name);

fs.mkdirSync(OUT_DIR, { recursive: true });

const manifest = {
  source: V1_DB,
  exportedAt: new Date().toISOString(),
  tables: {},
  skipped: [],
};

let totalRows = 0;
let totalTables = 0;

console.log(`Exporting from ${V1_DB}`);
console.log(`Output dir: ${OUT_DIR}`);
console.log(`Found ${v1Tables.length} tables in v1.\n`);

for (const tbl of v1Tables) {
  if (SKIP_FROM_V1.has(tbl)) {
    console.log(`  skip  ${tbl}   (intentionally dropped from pfd-saas)`);
    manifest.skipped.push({ table: tbl, reason: 'dropped from pfd-saas' });
    continue;
  }

  const rows = db.prepare(`SELECT * FROM ${tbl}`).all();
  const outFile = path.join(OUT_DIR, `${tbl}.json`);
  fs.writeFileSync(outFile, JSON.stringify(rows, null, 2));
  manifest.tables[tbl] = rows.length;
  totalRows += rows.length;
  totalTables += 1;
  console.log(`  ok    ${tbl.padEnd(34)}  ${String(rows.length).padStart(6)} rows`);
}

fs.writeFileSync(
  path.join(OUT_DIR, '_manifest.json'),
  JSON.stringify(manifest, null, 2),
);

db.close();

console.log(`\nExported ${totalTables} tables, ${totalRows} rows total.`);
console.log(`Manifest: ${path.join(OUT_DIR, '_manifest.json')}`);
