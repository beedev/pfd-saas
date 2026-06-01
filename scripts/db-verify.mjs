#!/usr/bin/env node
/**
 * Schema drift verifier — Sprint 5.1 follow-on.
 *
 * Cross-checks every column declared in src/db/schema.ts against
 * information_schema.columns in the live Postgres database. Exits
 * non-zero if any declared column is missing from the DB.
 *
 * Why this exists: during Sprint 5.1 we hit a case where Drizzle's
 * __drizzle_migrations journal claimed migrations had run but
 * statements were silently absent. Result: routes 500'd at runtime
 * with "column does not exist" because Drizzle's `db.select().from(t)`
 * generates `SELECT *` covering every schema-declared column.
 *
 * Wired into package.json's `predev` so `npm run dev` cannot start
 * with a hidden drift. Run manually: `node scripts/db-verify.mjs`.
 *
 * The check is column-only. Tables, indexes, constraints, types are
 * not validated — they tend to fail loudly rather than silently when
 * drifted. Column presence is the silent-failure surface.
 */

import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

// Read DATABASE_URL from .env.local if env var not already set.
if (!process.env.DATABASE_URL) {
  try {
    const env = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
    const match = env.match(/^DATABASE_URL\s*=\s*(.+)$/m);
    if (match) process.env.DATABASE_URL = match[1].replace(/^["']|["']$/g, '');
  } catch {
    // .env.local optional
  }
}

if (!process.env.DATABASE_URL) {
  console.error(`${RED}✗ DATABASE_URL not set${RESET}`);
  process.exit(2);
}

const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} });

// Pull the schema.ts source and extract declared columns. We parse
// Drizzle's pgTable definitions with a deliberately simple regex —
// any false positive will just produce a noisy "missing" alert,
// which is the safe failure mode.
const schemaSource = readFileSync(
  resolve(process.cwd(), 'src/db/schema.ts'),
  'utf8',
);

/** Map of table_name → Set<column_name>. */
const declared = new Map();

// Each `export const xxx = pgTable('table_name', { ... });` block.
const tableBlockRegex =
  /pgTable\(\s*['"]([a-z0-9_]+)['"]\s*,\s*\{([\s\S]*?)\n\s*\}(?:\s*,\s*\(\w+\)\s*=>\s*\[)?/g;

let block;
while ((block = tableBlockRegex.exec(schemaSource)) !== null) {
  const tableName = block[1];
  const body = block[2];
  // Each column: `someName: text('col_name'...)` or `serial('id')...`
  // The first string-literal arg to the type builder IS the SQL name.
  const colRegex =
    /^\s*[a-zA-Z_][a-zA-Z0-9_]*\s*:\s*(?:text|serial|integer|bigint|boolean|timestamp|date|real|doublePrecision|numeric|jsonb|json|uuid|bigserial|smallint|varchar)\s*\(\s*['"]([a-z0-9_]+)['"]/gm;
  const cols = new Set();
  let m;
  while ((m = colRegex.exec(body)) !== null) {
    cols.add(m[1]);
  }
  if (cols.size > 0) {
    declared.set(tableName, cols);
  }
}

// Pull actual columns from Postgres.
const rows = await sql`
  SELECT table_name, column_name
  FROM information_schema.columns
  WHERE table_schema = 'public'
`;
const actual = new Map();
for (const r of rows) {
  if (!actual.has(r.table_name)) actual.set(r.table_name, new Set());
  actual.get(r.table_name).add(r.column_name);
}

// Compare. We only flag declared-but-missing — extra DB columns are
// fine (could be NextAuth-managed, audit triggers, etc.).
const drifts = [];
for (const [table, cols] of declared) {
  const dbCols = actual.get(table);
  if (!dbCols) {
    drifts.push({ table, kind: 'TABLE_MISSING', column: null });
    continue;
  }
  for (const c of cols) {
    if (!dbCols.has(c)) {
      drifts.push({ table, kind: 'COLUMN_MISSING', column: c });
    }
  }
}

await sql.end();

if (drifts.length === 0) {
  console.log(`${GREEN}✓ Schema drift check: clean (${declared.size} tables verified)${RESET}`);
  process.exit(0);
}

console.error(`${RED}✗ Schema drift detected — ${drifts.length} issue(s):${RESET}`);
for (const d of drifts) {
  if (d.kind === 'TABLE_MISSING') {
    console.error(`  ${RED}TABLE${RESET} ${d.table} is declared in schema.ts but missing from DB`);
  } else {
    console.error(`  ${YELLOW}COL${RESET}   ${d.table}.${d.column} declared but missing`);
  }
}
console.error('');
console.error(`Fix: re-run \`npx drizzle-kit migrate\` and verify with this script. If the journal`);
console.error(`already claims the migration is applied but columns are still missing (the silent-drift`);
console.error(`failure mode), open the relevant drizzle/XXXX_*.sql and replay missing statements with:`);
console.error(`  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/XXXX_*.sql`);
process.exit(1);
