#!/usr/bin/env node
/**
 * Sprint 6.4f — portability smoke test.
 *
 * End-to-end round trip against the local dev server:
 *
 *   1. GET /api/portability/export                    → baseline.json
 *   2. POST /api/portability/import  (multipart file) → importId
 *   3. POST /api/portability/import/confirm           → ok=true
 *   4. GET /api/portability/export                    → after.json
 *   5. Byte-compare baseline vs after, ignoring `exportedAt`.
 *
 * Exits 0 only when:
 *   - all four HTTP calls return 200
 *   - the JSON envelopes match byte-for-byte except for the timestamp
 *
 * Uses the same DEV_AUTH_BYPASS pattern as scripts/smoke-test-tax.mjs.
 * Requires the dev server to be running with that env var set.
 *
 * Usage:
 *   PFDSAAS_BASE=http://localhost:3000 \
 *     node scripts/smoke-portability.mjs <user_id>
 */

import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BASE = process.env.PFDSAAS_BASE || 'http://localhost:3000';
const USER_ID = process.argv[2];

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';

function pass(msg) {
  console.log(`${GREEN}✓${RESET} ${msg}`);
}
function fail(msg) {
  console.error(`${RED}✗${RESET} ${msg}`);
}

if (!USER_ID) {
  console.error('Usage: node scripts/smoke-portability.mjs <user_id>');
  process.exit(2);
}

const headers = { 'x-dev-as-user': USER_ID, accept: 'application/json' };

let stage = 'init';
try {
  // 1. Baseline export
  stage = 'export-1';
  const r1 = await fetch(`${BASE}/api/portability/export`, { headers });
  if (r1.status !== 200) throw new Error(`baseline export status ${r1.status}`);
  const baselineText = await r1.text();
  const baseline = JSON.parse(baselineText);
  pass(`baseline export: ${baseline.data.length} tables, ${countRows(baseline)} rows`);

  // 2. Upload for preview
  stage = 'preview';
  const blob = new Blob([baselineText], { type: 'application/json' });
  const fd = new FormData();
  fd.append('file', blob, 'baseline.json');
  const r2 = await fetch(`${BASE}/api/portability/import`, {
    method: 'POST',
    headers,
    body: fd,
  });
  if (r2.status !== 200) {
    throw new Error(`preview status ${r2.status}: ${await r2.text()}`);
  }
  const preview = await r2.json();
  if (!preview.importId) throw new Error('preview did not return importId');
  pass(
    `preview: importId=${preview.importId.slice(0, 8)}…, willDelete=${preview.totalWillDelete}, willInsert=${preview.totalWillInsert}`,
  );
  if (preview.totalWillInsert !== countRows(baseline)) {
    throw new Error(
      `preview totalWillInsert ${preview.totalWillInsert} != baseline rows ${countRows(baseline)}`,
    );
  }

  // 3. Confirm
  stage = 'confirm';
  const r3 = await fetch(`${BASE}/api/portability/import/confirm`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ importId: preview.importId }),
  });
  if (r3.status !== 200) {
    throw new Error(`confirm status ${r3.status}: ${await r3.text()}`);
  }
  const confirm = await r3.json();
  if (!confirm.ok) throw new Error(`confirm ok=false: ${JSON.stringify(confirm)}`);
  pass(`confirm: totalInserted=${confirm.totalInserted}`);

  // 4. Re-export
  stage = 'export-2';
  const r4 = await fetch(`${BASE}/api/portability/export`, { headers });
  if (r4.status !== 200) throw new Error(`re-export status ${r4.status}`);
  const after = await r4.json();
  pass(`re-export: ${after.data.length} tables, ${countRows(after)} rows`);

  // 5. Compare (ignore exportedAt only)
  stage = 'compare';
  baseline.exportedAt = 'IGNORED';
  after.exportedAt = 'IGNORED';
  const baseStr = JSON.stringify(baseline);
  const afterStr = JSON.stringify(after);
  if (baseStr === afterStr) {
    pass('byte-identical round trip (ignoring exportedAt)');
  } else {
    // Find first diff for diagnosis
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'pfd-portability-'));
    await fs.writeFile(path.join(dir, 'before.json'), JSON.stringify(baseline, null, 2));
    await fs.writeFile(path.join(dir, 'after.json'), JSON.stringify(after, null, 2));
    throw new Error(`round trip diverged. Dumped to ${dir}/{before,after}.json`);
  }

  console.log(`${GREEN}✓ portability smoke OK${RESET}`);
  process.exit(0);
} catch (err) {
  fail(`stage=${stage}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

function countRows(payload) {
  return payload.data.reduce((sum, t) => sum + t.rows.length, 0);
}
