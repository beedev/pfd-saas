#!/usr/bin/env node
/**
 * Canary for the AMFI NAVAll.txt feed.
 *
 * Why this exists: on 2026-09 AMFI changed NAVAll.txt from 6 columns to 8 by
 * splitting the scheme name into Scheme Name / Plan / Option. Our parser read
 * the NAV from a fixed front offset (cols[4]), which silently became the string
 * "Direct Plan". parseFloat returned NaN, every line was dropped, and the whole
 * MF surface — SIP auto-execution, NAV refresh, fund search, redemption pricing
 * — returned nothing for three weeks with no error logged anywhere.
 *
 * src/lib/services/amfi.ts now anchors to the END of the row: NAV is the
 * second-to-last field, date is the last. This script asserts that ASSUMPTION
 * still holds against the live feed. It deliberately does NOT re-implement the
 * parser — a copy would drift. It checks the property the parser depends on.
 *
 *   node scripts/check-amfi-nav-feed.mjs
 *
 * Exits 0 if the feed still looks the way the parser expects, 1 otherwise.
 */

const ENDPOINT = 'https://portal.amfiindia.com/spages/NAVAll.txt';
const UA = 'Mozilla/5.0 (compatible; PersonalFinanceDashboard/1.0)';
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const failures = [];
const check = (ok, label, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

const res = await fetch(ENDPOINT, { headers: { 'User-Agent': UA }, cache: 'no-store' });
check(res.ok, `GET ${ENDPOINT}`, `HTTP ${res.status}`);
if (!res.ok) process.exit(1);

const text = await res.text();
check(text.length > 100_000, 'feed is a plausible size', `${text.length} bytes`);

const dataLines = text.split(/\r?\n/).map((l) => l.trim()).filter(
  (l) => l && !l.startsWith('Scheme Code') && l.includes(';') && l.split(';').length >= 6,
);
check(dataLines.length > 1000, 'feed contains data rows', `${dataLines.length} rows`);
if (dataLines.length === 0) process.exit(1);

// The two invariants the end-anchored parser rests on.
let navOk = 0;
let dateOk = 0;
let isinOk = 0;
for (const line of dataLines) {
  const cols = line.split(';');
  const nav = parseFloat(cols[cols.length - 2]);
  if (Number.isFinite(nav) && nav > 0) navOk++;
  const d = cols[cols.length - 1].trim().split('-');
  if (d.length === 3 && MONTHS.includes(d[1]) && /^\d{4}$/.test(d[2])) dateOk++;
  if (/^INF/.test(cols[1]) || /^INF/.test(cols[2])) isinOk++;
}

const pct = (n) => ((n / dataLines.length) * 100).toFixed(1) + '%';
check(navOk / dataLines.length > 0.98, 'NAV is the second-to-last column', pct(navOk));
check(dateOk / dataLines.length > 0.98, 'Date is the last column', pct(dateOk));
check(isinOk / dataLines.length > 0.95, 'ISIN is in column 2 or 3', pct(isinOk));

const widths = [...new Set(dataLines.map((l) => l.split(';').length))].sort((a, b) => a - b);
console.log(`\n  observed column widths: ${widths.join(', ')}`);
console.log(`  sample row: ${dataLines[0]}`);

if (failures.length > 0) {
  console.error(
    `\nAMFI feed no longer matches the parser's assumptions (${failures.length} failed).\n` +
    `Update parseNavAll() in src/lib/services/amfi.ts BEFORE the next SIP run.`,
  );
  process.exit(1);
}
console.log('\nAMFI feed matches parseNavAll() assumptions.');
