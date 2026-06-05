#!/usr/bin/env node
/**
 * Sprint A.2 (saas back-port) — one-shot backfill that walks every
 * FINAL B2B invoice with tds_deducted=true for every user and emits /
 * updates the corresponding tds_credits row. Idempotent, safe to
 * re-run.
 *
 * Usage:
 *   node scripts/backfill-invoice-tds.mjs
 *
 * Connects directly to Postgres via DATABASE_URL (read from .env.local
 * + .env in that order — matches drizzle.config.ts). Does NOT depend on
 * the Next.js server. Mirrors the logic in
 * src/lib/finance/derive-invoice-tds.ts.
 *
 * Multi-tenant: each row's userId is preserved end-to-end so the
 * resulting tds_credits rows land in the correct tenant scope. The
 * partial UNIQUE index on (user_id, source_kind, source_id) keeps
 * re-runs idempotent.
 *
 * Promotion guard: rows with auto_derived=false are preserved as-is
 * (the user has taken ownership).
 */

import 'dotenv/config';
import { config } from 'dotenv';
import postgres from 'postgres';

// Match drizzle.config.ts — .env.local first, then .env
config({ path: '.env.local' });
config();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL not set; aborting.');
  process.exit(2);
}

const sql = postgres(url, { max: 1, idle_timeout: 5 });

function fyFromDateIso(iso) {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const startYear = m >= 3 ? y : y - 1;
  const endShort = String((startYear + 1) % 100).padStart(2, '0');
  return `${startYear}-${endShort}`;
}

function sectionToCategory(section) {
  const s = (section || '').toUpperCase().trim();
  if (s === '194J' || s === '194JB' || s === '194C') return 'CONSULTING';
  if (s === '194A') return 'INTEREST';
  if (s === '194-IA' || s === '194IA') return 'PROPERTY';
  if (s === '194-IB' || s === '194IB') return 'RENT';
  return 'OTHER';
}

const eligible = await sql`
  SELECT i.id,
         i.user_id,
         i.invoice_number,
         i.invoice_date,
         i.taxable_amount,
         c.name AS cust_name,
         c.gstin AS cust_gstin,
         c.pan AS cust_pan,
         c.tds_rate_pct AS cust_rate,
         c.tds_section AS cust_section
    FROM invoices i
    JOIN customers c
      ON c.id = i.customer_id
     AND c.user_id = i.user_id
   WHERE i.status = 'FINAL'
     AND i.invoice_type = 'B2B'
     AND COALESCE(i.tds_deducted, true) = true
     AND COALESCE(c.tds_rate_pct, 0) > 0
`;

let createdOrUpdated = 0;
let preservedManual = 0;
const perUser = new Map();

for (const inv of eligible) {
  const rate = Number(inv.cust_rate ?? 0);
  if (!(rate > 0)) continue;
  const section = (inv.cust_section || '194J').toUpperCase();
  const tdsPaisa = Math.round((Number(inv.taxable_amount) * rate) / 100);
  const fy = fyFromDateIso(inv.invoice_date);
  const incomePaisa = Number(inv.taxable_amount);

  const existing = await sql`
    SELECT id, auto_derived
      FROM tds_credits
     WHERE user_id = ${inv.user_id}
       AND source_kind = 'GST_INVOICE'
       AND source_id = ${inv.id}
     LIMIT 1
  `;

  if (existing.length > 0) {
    if (!existing[0].auto_derived) {
      preservedManual++;
      continue;
    }
    await sql`
      UPDATE tds_credits SET
        financial_year = ${fy},
        category = ${sectionToCategory(section)},
        deductor_name = ${inv.cust_name},
        deductor_tan = ${inv.cust_gstin ?? null},
        deductor_pan = ${inv.cust_pan ?? null},
        section = ${section},
        income_paisa = ${incomePaisa},
        tds_paisa = ${tdsPaisa},
        notes = ${`Auto-derived from invoice #${inv.invoice_number}`},
        payment_date = ${String(inv.invoice_date).slice(0, 10)},
        updated_at = NOW()
      WHERE id = ${existing[0].id}
        AND user_id = ${inv.user_id}
    `;
  } else {
    await sql`
      INSERT INTO tds_credits (
        user_id, financial_year, category, deductor_name, deductor_tan,
        deductor_pan, section, income_paisa, tds_paisa, notes,
        is_reconciled, auto_derived, source_kind, source_id, payment_date,
        created_at, updated_at
      ) VALUES (
        ${inv.user_id}, ${fy}, ${sectionToCategory(section)}, ${inv.cust_name},
        ${inv.cust_gstin ?? null}, ${inv.cust_pan ?? null}, ${section},
        ${incomePaisa}, ${tdsPaisa},
        ${`Auto-derived from invoice #${inv.invoice_number}`},
        false, true, 'GST_INVOICE', ${inv.id},
        ${String(inv.invoice_date).slice(0, 10)},
        NOW(), NOW()
      )
    `;
  }
  createdOrUpdated++;

  const key = inv.user_id;
  const stats = perUser.get(key) || { count: 0, tdsPaisa: 0, fys: new Set() };
  stats.count++;
  stats.tdsPaisa += tdsPaisa;
  stats.fys.add(fy);
  perUser.set(key, stats);

  console.log(
    `  user ${inv.user_id.slice(0, 8)}… inv #${inv.invoice_number} → FY ${fy}  ` +
      `₹${(incomePaisa / 100).toLocaleString('en-IN')} × ${rate}% = ` +
      `₹${(tdsPaisa / 100).toLocaleString('en-IN')} ${section}`,
  );
}

console.log(`\n✓ Synced ${createdOrUpdated} invoice(s) → tds_credits`);
if (preservedManual > 0) {
  console.log(`  (${preservedManual} invoice(s) had manual rows — preserved as-is)`);
}

if (perUser.size > 0) {
  console.log('\nPer-user totals (auto-derived from invoices):');
  for (const [userId, stats] of perUser.entries()) {
    console.log(
      `  user ${userId}: ${stats.count} row(s), ` +
        `₹${(stats.tdsPaisa / 100).toLocaleString('en-IN')} ` +
        `across FY ${[...stats.fys].sort().join(', ')}`,
    );
  }
}

// Quick FY summary across all tenants
const fySummary = await sql`
  SELECT financial_year, COUNT(*)::int AS n, SUM(tds_paisa)::bigint AS tds_total
    FROM tds_credits
   WHERE source_kind = 'GST_INVOICE'
   GROUP BY financial_year
   ORDER BY 1
`;
if (fySummary.length > 0) {
  console.log('\nGlobal FY totals (auto-derived from invoices, all tenants):');
  for (const r of fySummary) {
    console.log(
      `  FY ${r.financial_year}: ${r.n} row(s), ₹${(Number(r.tds_total) / 100).toLocaleString('en-IN')}`,
    );
  }
}

await sql.end();
