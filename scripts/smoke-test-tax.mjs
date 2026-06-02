#!/usr/bin/env node
/**
 * Tax endpoint smoke test.
 *
 * Hits every tax-related API as a specific user, asserts HTTP 200 (or
 * an expected non-200 with a documented reason). Uses the dev-only
 * auth bypass in src/auth.ts:
 *
 *   - Requires NODE_ENV !== 'production'
 *   - Requires DEV_AUTH_BYPASS=true in the dev server's env
 *   - Sends `x-dev-as-user: <USER_ID>` header per request
 *
 * Run order:
 *   1. In one terminal: DEV_AUTH_BYPASS=true npm run dev
 *   2. In another:      node scripts/smoke-test-tax.mjs <user_id>
 *
 * Exits non-zero on any unexpected status. Prints response bodies
 * for failing endpoints so the cause is visible without tailing the
 * dev server log.
 */

const BASE = process.env.PFDSAAS_BASE || 'http://localhost:3000';
const USER_ID = process.argv[2];
const FY = process.argv[3] || '2025-26';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

if (!USER_ID) {
  console.error('Usage: node scripts/smoke-test-tax.mjs <user_id> [fy]');
  console.error('Example: node scripts/smoke-test-tax.mjs 4b8c1fef-... 2025-26');
  process.exit(2);
}

/** Endpoint, expected status set. Order roughly mirrors the /tax page
 *  rendering order — cards from top to bottom — so a failure cluster
 *  pinpoints where the cascade started. */
const probes = [
  { path: `/api/tax/summary?fy=${FY}`,             expect: [200, 422] },
  { path: `/api/tax/regime-compare?fy=${FY}`,      expect: [200, 404, 422] },
  { path: `/api/tax/tax-paid?fy=${FY}`,            expect: [200] },
  { path: `/api/tax/advance-tax?fy=${FY}`,         expect: [200, 404] },
  { path: `/api/tax/itr1/summary?fy=${FY}`,        expect: [200, 422] },
  { path: `/api/tax/itr2/summary?fy=${FY}`,        expect: [200, 422] },
  { path: `/api/tax/itr4/summary?fy=${FY}`,        expect: [200, 422] },
  { path: `/api/tax/itr-form-selection?fy=${FY}`,  expect: [200, 404] },
  { path: `/api/tax/itr-form-selection/detect?fy=${FY}`, expect: [200] },
  { path: `/api/tax/itr4/presumptive?fy=${FY}`,    expect: [200] },
  { path: `/api/tax/form-26as?fy=${FY}`,           expect: [200] },
  { path: `/api/tax/deductions?fy=${FY}`,          expect: [200] },
  { path: `/api/tax/capital-gains?fy=${FY}`,       expect: [200] },
  { path: `/api/tax/ltcg-stcg?fy=${FY}`,           expect: [200] },
  { path: `/api/tax/documents?fy=${FY}`,           expect: [200] },
  { path: `/api/tax/itr3/summary?fy=${FY}`,        expect: [200] },
  { path: `/api/tax/itr3/salary?fy=${FY}`,         expect: [200] },
  { path: `/api/tax/itr3/tds?fy=${FY}`,            expect: [200] },
  { path: `/api/tax/itr3/other-income?fy=${FY}`,   expect: [200] },
  // Sprint 5.3 — historical rental track. Smoke covers the list endpoint
  // (filtered to one FY) from phase 2 onward so a route-level regression
  // surfaces before it reaches /income.
  { path: `/api/finance/rental-history?fy=${FY}`,  expect: [200] },
];

const results = [];

for (const p of probes) {
  const url = BASE + p.path;
  let status = 0;
  let body = '';
  let durationMs = 0;
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      redirect: 'manual',
      headers: { 'x-dev-as-user': USER_ID, accept: 'application/json' },
    });
    status = r.status;
    body = await r.text();
    durationMs = Date.now() - t0;
  } catch (err) {
    status = -1;
    body = err.message;
    durationMs = Date.now() - t0;
  }

  const ok = p.expect.includes(status);
  results.push({ ...p, status, body, durationMs, ok });
}

let failedCount = 0;
console.log('');
console.log(`Smoke test against ${BASE}`);
console.log(`User: ${USER_ID}  ·  FY: ${FY}`);
console.log('─'.repeat(80));

for (const r of results) {
  const marker = r.ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
  const statusStr = r.status === -1 ? `${RED}ERR${RESET}` : String(r.status);
  const expectedStr = r.ok ? '' : ` ${YELLOW}(expected ${r.expect.join('|')})${RESET}`;
  console.log(`${marker} ${statusStr.padEnd(4)} ${r.durationMs.toString().padStart(5)}ms  ${r.path}${expectedStr}`);
  if (!r.ok) {
    failedCount++;
    const preview = r.body.length > 400 ? r.body.slice(0, 400) + '…' : r.body;
    console.log(`    ${RED}body:${RESET} ${preview}`);
  }
}

console.log('─'.repeat(80));
if (failedCount === 0) {
  console.log(`${GREEN}✓ all ${results.length} endpoints OK${RESET}`);
  process.exit(0);
} else {
  console.log(`${RED}✗ ${failedCount} of ${results.length} endpoints failed${RESET}`);
  process.exit(1);
}
