#!/usr/bin/env node
/**
 * Sprint 6.4a — sanity-check the table manifest at build time without
 * spinning up Next.js. Parses the TypeScript source as text and verifies:
 *   • MANIFEST contains 72 entries (matches live DB count)
 *   • every referenced parent appears earlier in the list
 *   • no EXCLUDED_TABLES are present in MANIFEST
 *
 * Independent of TypeScript / tsx — string-scan only.
 */

import { readFileSync } from 'node:fs';

const ROOT = process.cwd();
const MANIFEST_PATH = `${ROOT}/src/lib/portability/table-manifest.ts`;
const CONSTANTS_PATH = `${ROOT}/src/lib/portability/constants.ts`;

const manifestSrc = readFileSync(MANIFEST_PATH, 'utf8');
const constantsSrc = readFileSync(CONSTANTS_PATH, 'utf8');

const excluded = new Set();
{
  const block = constantsSrc.match(/EXCLUDED_TABLES\s*=\s*\[([\s\S]*?)\]/);
  if (!block) {
    console.error('FAIL: could not parse EXCLUDED_TABLES from constants.ts');
    process.exit(1);
  }
  const rx = /'([\w]+)'/g;
  let m;
  while ((m = rx.exec(block[1])) !== null) excluded.add(m[1]);
}

const entries = [];
{
  const rx = /\{\s*tableName:\s*'(\w+)'[^}]*?parents:\s*\[([^\]]*)\][^}]*?\}/g;
  let m;
  while ((m = rx.exec(manifestSrc)) !== null) {
    const tableName = m[1];
    const parentsRaw = m[2];
    const parents = [...parentsRaw.matchAll(/'([\w]+)'/g)].map((mm) => mm[1]);
    entries.push({ tableName, parents });
  }
}

const EXPECTED = 72;
let failures = 0;
function fail(msg) {
  console.error(`FAIL: ${msg}`);
  failures += 1;
}

if (entries.length !== EXPECTED) {
  fail(`manifest has ${entries.length} entries, expected ${EXPECTED}`);
}

const seen = new Set();
for (const e of entries) {
  if (seen.has(e.tableName)) fail(`duplicate entry '${e.tableName}'`);
  for (const p of e.parents) {
    if (!seen.has(p)) {
      fail(`'${e.tableName}' references parent '${p}' which has not appeared yet`);
    }
  }
  if (excluded.has(e.tableName)) {
    fail(`'${e.tableName}' appears in MANIFEST but is also in EXCLUDED_TABLES`);
  }
  seen.add(e.tableName);
}

if (failures === 0) {
  console.log(`OK: manifest has ${entries.length} entries, all parents resolve, no excluded leaks.`);
  process.exit(0);
}
console.error(`FAIL: ${failures} problem(s) in MANIFEST.`);
process.exit(1);
