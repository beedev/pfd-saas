#!/usr/bin/env node
/**
 * Comprehensive demo-data seed for BXDEva (FY 2025-26).
 *
 * Hard-coded to user_id = dcc2a010-bf3e-44e5-8b6b-9fcd3bc521d3.
 * Refuses to run in production. Wraps all inserts in one transaction.
 *
 * Idempotent: deletes prior 'DEMO-SEED:%' rows (and a couple of
 * marker-based deletes for tables without a `notes` column) before
 * inserting. UPDATEs user_preferences in place.
 *
 * Per-table abort guard: if the target already has >50 rows in any
 * table we plan to touch, the script bails with a loud message so we
 * never overwrite real data.
 *
 * Usage:
 *   node scripts/seed-demo-bxdeva.mjs
 */

import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import postgres from 'postgres';

// ─── safety gates ───────────────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  throw new Error('refuse in prod');
}

const TARGET_USER_ID = 'dcc2a010-bf3e-44e5-8b6b-9fcd3bc521d3';
const FY = '2025-26';
const FY_LABEL = `DEMO-SEED: ${FY} —`;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not set (check .env.local)');
  process.exit(2);
}

const sql = postgres(DATABASE_URL, { max: 4, prepare: false });

// ─── helpers ────────────────────────────────────────────────────────
/** ₹ → paisa (integer). */
const rs = (rupees) => Math.round(rupees * 100);
const lakh = (n) => Math.round(n * 100000 * 100);
const cr = (n) => Math.round(n * 10000000 * 100);

// Stamp the notes column so we can wipe DEMO-SEED rows idempotently.
const NOTE = (bucket = '') => (bucket ? `${FY_LABEL} ${bucket}` : `${FY_LABEL} demo data`);

const inserted = {}; // { table: count }
function tally(table, n = 1) {
  inserted[table] = (inserted[table] ?? 0) + n;
}

// ─── per-table guard ────────────────────────────────────────────────
// Tables touched by this seed. We pre-check each: if the user already
// has > 50 non-demo rows we abort. "Non-demo" = notes either NULL or
// not starting 'DEMO-SEED:'. For tables without a notes column we
// just count totals (the threshold of 50 still applies).
const TABLES_WITH_NOTES = [
  'salary_income', 'other_sources_income', 'real_estate',
  'capital_gains', 'tax_deductions', 'tds_credits', 'holdings',
  'mutual_funds', 'sips', 'gold_holdings', 'nps_accounts',
  'epf_accounts', 'small_savings_accounts', 'fixed_deposits',
  'liabilities', 'insurance_policies', 'health_insurance_policies',
  'vehicles', 'subscriptions', 'budget_entries',
  // Sprint 5.3 — per-FY historical rental track.
  'rental_history',
  // Sprint 5.10 — forex deposits asset class.
  'forex_deposits',
];
/** Tables we seed into that don't have a `notes` column. Guard checks
 *  the row count without the notes filter; cleanup uses a stable
 *  per-table marker (see cleanup{Goals,…} below). */
const TABLES_WITHOUT_NOTES = ['financial_goals'];

async function guardSafety() {
  for (const t of TABLES_WITH_NOTES) {
    const rows = await sql`
      SELECT COUNT(*)::int AS c
      FROM ${sql(t)}
      WHERE user_id = ${TARGET_USER_ID}
        AND (notes IS NULL OR notes NOT LIKE 'DEMO-SEED:%')
    `;
    const c = rows[0].c;
    if (c > 50) {
      throw new Error(
        `ABORT: ${t} has ${c} non-demo rows for user — real data, not a demo shell.`,
      );
    }
  }
  for (const t of TABLES_WITHOUT_NOTES) {
    const rows = await sql`
      SELECT COUNT(*)::int AS c
      FROM ${sql(t)}
      WHERE user_id = ${TARGET_USER_ID}
    `;
    const c = rows[0].c;
    if (c > 50) {
      throw new Error(
        `ABORT: ${t} has ${c} rows for user — real data, not a demo shell.`,
      );
    }
  }
}

// ─── cleanup ────────────────────────────────────────────────────────
// Deletes any prior DEMO-SEED rows so re-runs are idempotent. Each
// DELETE is bounded to the target user.
async function cleanup(tx) {
  // Tables with notes — delete by note marker.
  for (const t of TABLES_WITH_NOTES) {
    await tx`
      DELETE FROM ${tx(t)}
      WHERE user_id = ${TARGET_USER_ID}
        AND notes LIKE 'DEMO-SEED:%'
    `;
  }
  // Tables without notes — use a stable per-row marker.
  //   itr_form_selection: there can be at most one row per (user,fy)
  //   so we delete by (user, fy) directly.
  await tx`
    DELETE FROM itr_form_selection
    WHERE user_id = ${TARGET_USER_ID} AND fy = ${FY}
  `;
  //   budget_categories: cascades to budget_entries on delete. We use
  //   sort_order >= 9000 as our marker (chosen to not collide with
  //   any human-curated categories that typically start at 1).
  await tx`
    DELETE FROM budget_categories
    WHERE user_id = ${TARGET_USER_ID} AND sort_order >= 9000
  `;
  //   chit_funds / chit_fund_installments: not seeded here.
  //   epf_accounts / nps_accounts: notes-based delete above already handles.
  //   vehicles: notes-based delete; child rows (insurance/puc/service)
  //   cascade automatically via the FKs.
}

// ─── seed payload ───────────────────────────────────────────────────
async function seedAll(tx) {
  // ─── user_preferences — UPDATE (do not delete or re-insert) ──────
  await tx`
    UPDATE user_preferences
    SET metro_city = true,
        parents_are_sr_citizens = true,
        is_sr_citizen = false,
        is_family_pensioner = false,
        is_govt_employee_for_nps = false,
        has_permanent_disability = false,
        disability_severity = NULL,
        updated_at = NOW()
    WHERE user_id = ${TARGET_USER_ID}
  `;
  tally('user_preferences', 1);

  // ─── salary_income ────────────────────────────────────────────────
  // FY 2025-26, all paisa values. Gross = sum of components.
  const basic   = rs(600000);
  const da      = rs(60000);
  const hra     = rs(240000);
  const lta     = rs(40000);
  const conv    = rs(19200);
  const childEd = rs(0);
  const medical = rs(15000);
  const otherAl = rs(86800);
  const gross   = basic + da + hra + lta + conv + childEd + medical + otherAl;
  // ₹10,61,000 — matches spec.
  const tds     = rs(120000);
  const rentMonthly = rs(30000);
  await tx`
    INSERT INTO salary_income
      (user_id, financial_year, employer_name, employer_tan,
       gross_salary_paisa, exemptions_paisa, section16_paisa,
       taxable_salary_paisa, tds_paisa,
       basic_paisa, da_paisa, hra_received_paisa, lta_paisa,
       conveyance_paisa, children_ed_allowance_paisa, medical_paisa,
       other_allowances_paisa, rent_paid_monthly_paisa, notes)
    VALUES
      (${TARGET_USER_ID}, ${FY}, 'Heartfulness Institute', 'BLRX99999E',
       ${gross}, ${0}, ${5000000},
       ${gross - 5000000}, ${tds},
       ${basic}, ${da}, ${hra}, ${lta},
       ${conv}, ${childEd}, ${medical},
       ${otherAl}, ${rentMonthly}, ${NOTE('salary')})
  `;
  tally('salary_income', 1);

  // ─── other_sources_income — 3 taxable rows ───────────────────────
  const otherSources = [
    { src: 'BANK_INTEREST', desc: 'Savings + sweep interest (multi-bank)', amt: rs(35000) },
    { src: 'FD_INTEREST',   desc: 'Fixed deposit accrued interest',        amt: rs(85000) },
    { src: 'DIVIDEND',      desc: 'Equity + MF dividends',                  amt: rs(15000) },
  ];
  for (const o of otherSources) {
    await tx`
      INSERT INTO other_sources_income
        (user_id, financial_year, source, description, amount_paisa,
         is_tax_exempt, tax_section, notes)
      VALUES
        (${TARGET_USER_ID}, ${FY}, ${o.src}, ${o.desc}, ${o.amt},
         false, NULL, ${NOTE('os-' + o.src.toLowerCase())})
    `;
    tally('other_sources_income', 1);
  }

  // ─── real_estate — 3 properties ───────────────────────────────────
  // 1. Self-occupied (24(b) interest)
  {
    const buy = lakh(85);
    const cur = cr(1.2);
    await tx`
      INSERT INTO real_estate
        (user_id, property_name, type, status, address, city, state,
         area, area_unit, purchase_price, purchase_date,
         current_valuation, valuation_date, gain_loss, gain_loss_percent,
         monthly_rent, is_self_occupied,
         home_loan_interest_paid_paisa, home_loan_disbursed_date,
         is_first_home, notes)
      VALUES
        (${TARGET_USER_ID}, 'Anand Apartment, Bengaluru', 'RESIDENTIAL', 'OWNED',
         'Anand Apartment, Indiranagar', 'Bengaluru', 'Karnataka',
         ${1450}, 'sqft', ${buy}, '2018-05-15',
         ${cur}, '2026-03-31', ${cr(1.2) - lakh(85)}, ${((cr(1.2) - lakh(85)) / lakh(85)) * 100},
         ${0}, true,
         ${lakh(1.8)}, '2018-06-01',
         false, ${NOTE('re-anand')})
    `;
    tally('real_estate', 1);
  }
  // 2. Let-out (rent + property tax, no home loan interest)
  {
    const buy = lakh(65);
    const cur = lakh(95);
    await tx`
      INSERT INTO real_estate
        (user_id, property_name, type, status, address, city, state,
         area, area_unit, purchase_price, purchase_date,
         current_valuation, valuation_date, gain_loss, gain_loss_percent,
         monthly_rent, rent_start_date, rent_tenant_name,
         property_tax_annual, is_self_occupied,
         home_loan_interest_paid_paisa,
         notes)
      VALUES
        (${TARGET_USER_ID}, 'Whitefield Flat, Bengaluru', 'RESIDENTIAL', 'OWNED',
         'Whitefield, Phase 2', 'Bengaluru', 'Karnataka',
         ${1100}, 'sqft', ${buy}, '2020-08-15',
         ${cur}, '2026-03-31', ${cur - buy}, ${((cur - buy) / buy) * 100},
         ${rs(25000)}, '2022-04-01', 'Tenant XYZ',
         ${rs(18000)}, false,
         ${0},
         ${NOTE('re-whitefield')})
    `;
    tally('real_estate', 1);
  }
  // 3. Land plot (drives 80EEA — first-home, post-Apr-2019 disbursal,
  // stamp value ≤ ₹45L, carpet ≤ 968 sqft, interest above 24(b) ₹2L cap.
  // For 80EEA computation: interest paid > 24b cap; here interest = ₹2.4L
  // and self-occupied is false but we set is_first_home=true.)
  // NOTE: 80EEA in the lib gates on first_home + stamp_value + carpet_area;
  // is_self_occupied doesn't gate it. We mark this plot as land with the
  // home-loan flags set so the lib's 80EEA computation fires on a
  // realistic ₹40k delta (interest 2.4L − 24b cap 2.0L = 0.4L → 80EEA
  // claim 0.4L within the 1.5L cap).
  {
    await tx`
      INSERT INTO real_estate
        (user_id, property_name, type, status, address, city, state,
         area, area_unit, purchase_price, purchase_date,
         current_valuation, valuation_date, gain_loss, gain_loss_percent,
         monthly_rent, is_self_occupied,
         home_loan_interest_paid_paisa, home_loan_disbursed_date,
         is_first_home, stamp_value_paisa, carpet_area_sqft,
         notes)
      VALUES
        (${TARGET_USER_ID}, 'Hosur Plot', 'LAND', 'OWNED',
         'Hosur Industrial Area', 'Hosur', 'Tamil Nadu',
         ${850}, 'sqft', ${lakh(35)}, '2020-08-15',
         ${lakh(48)}, '2026-03-31', ${lakh(48) - lakh(35)}, ${((lakh(48) - lakh(35)) / lakh(35)) * 100},
         ${0}, false,
         ${lakh(2.4)}, '2020-08-15',
         true, ${lakh(42)}, ${850},
         ${NOTE('re-hosur')})
    `;
    tally('real_estate', 1);
  }

  // ─── rental_history — 3 prior FYs on the Whitefield flat ─────────
  // Sprint 5.3 — backfill so /income YoY shows real per-FY rental
  // figures. The current FY (2025-26) deliberately has NO row so the
  // monthly_rent × 12 = ₹3,00,000 fallback path stays exercised.
  //   FY 2022-23: ₹2.40L (₹20k/mo × 12)
  //   FY 2023-24: ₹2.52L (₹21k/mo × 12)
  //   FY 2024-25: ₹2.76L (₹23k/mo × 12)
  {
    // Whitefield is the only let-out property in this seed, look it up
    // by property_name since INSERTs above don't capture ids.
    const wfRows = await tx`
      SELECT id FROM real_estate
      WHERE user_id = ${TARGET_USER_ID}
        AND property_name = 'Whitefield Flat, Bengaluru'
      LIMIT 1
    `;
    if (wfRows.length === 0) {
      throw new Error('rental_history seed: Whitefield property not found');
    }
    const whitefieldId = wfRows[0].id;
    const RH_NOTE = `${FY_LABEL.replace(`${FY} —`, '')} rental history for prior FYs`.replace(/\s+/g, ' ').trim();
    // RH_NOTE preserves the 'DEMO-SEED:' prefix so the cleanup-by-LIKE
    // pattern still wipes these rows on re-runs.
    const history = [
      { fy: '2022-23', rent: rs(240000) },
      { fy: '2023-24', rent: rs(252000) },
      { fy: '2024-25', rent: rs(276000) },
    ];
    for (const h of history) {
      await tx`
        INSERT INTO rental_history
          (user_id, real_estate_id, fy, rent_received_paisa, months_let, notes)
        VALUES
          (${TARGET_USER_ID}, ${whitefieldId}, ${h.fy}, ${h.rent}, 12, ${'DEMO-SEED: rental history for prior FYs'})
      `;
      tally('rental_history', 1);
    }
  }

  // ─── capital_gains — 4 rows exercising every bracket ─────────────
  const capRows = [
    {
      assetType: 'EQUITY_MF',
      assetName: 'SBI Bluechip — sold pre-reform',
      purchaseDate: '2020-04-10',
      saleDate: '2024-06-15',
      purchasePrice: lakh(5),
      salePrice: lakh(7.5),
      gain: lakh(2.5),
      taxable: lakh(2.5),
      holding: 'LTCG',
      rate: 10,
      bucket: 'cg-equity-ltcg-pre-jul24',
    },
    {
      assetType: 'EQUITY_MF',
      assetName: 'Parag Parikh Flexi — post-reform',
      purchaseDate: '2022-01-10',
      saleDate: '2025-10-20',
      purchasePrice: lakh(6),
      salePrice: lakh(9.5),
      gain: lakh(3.5),
      taxable: lakh(3.5),
      holding: 'LTCG',
      rate: 12.5,
      bucket: 'cg-equity-ltcg-post-jul24',
    },
    {
      assetType: 'DEBT_MF',
      assetName: 'HDFC Corporate Bond — indexed',
      purchaseDate: '2018-04-01',
      saleDate: '2025-08-10',
      purchasePrice: lakh(8),
      salePrice: lakh(9.2),
      gain: lakh(1.2),
      taxable: lakh(1.2),
      holding: 'LTCG',
      rate: 20,
      bucket: 'cg-debt-ltcg',
    },
    {
      assetType: 'STOCKS',
      assetName: 'Reliance — STCG',
      purchaseDate: '2025-08-01',
      saleDate: '2025-12-05',
      purchasePrice: lakh(2.85),
      salePrice: lakh(3.5),
      gain: rs(65000),
      taxable: rs(65000),
      holding: 'STCG',
      rate: 20,
      bucket: 'cg-equity-stcg',
    },
  ];
  for (const r of capRows) {
    const taxAmount = Math.round(r.taxable * (r.rate / 100));
    await tx`
      INSERT INTO capital_gains
        (user_id, financial_year, asset_type, asset_name,
         purchase_date, sale_date, purchase_price, sale_price,
         capital_gain, holding_period, exemption_applied, taxable_gain,
         tax_rate, tax_amount, notes)
      VALUES
        (${TARGET_USER_ID}, ${FY}, ${r.assetType}, ${r.assetName},
         ${r.purchaseDate}, ${r.saleDate}, ${r.purchasePrice}, ${r.salePrice},
         ${r.gain}, ${r.holding}, ${0}, ${r.taxable},
         ${r.rate}, ${taxAmount}, ${NOTE(r.bucket)})
    `;
    tally('capital_gains', 1);
  }

  // ─── tax_deductions — exercises every relevant section ───────────
  const FY_START = '2025-04-01'; // for incurred_date / payment_date
  const dedRows = [
    // 80C bucket — total ₹3,02,000 (capped at ₹1.5L by app, but raw stored)
    { sec: '80C', desc: 'PPF deposit',                  amount: lakh(1.0), pd: '2025-06-15', bucket: '80c-ppf' },
    { sec: '80C', desc: 'ELSS investment',              amount: rs(50000), pd: '2025-12-10', bucket: '80c-elss' },
    { sec: '80C', desc: 'Term life insurance premium',  amount: rs(45000), pd: '2025-07-20', bucket: '80c-term-life' },
    { sec: '80C', desc: 'Tuition fees',                 amount: rs(35000), pd: '2025-06-30', bucket: '80c-tuition' },
    { sec: '80C', desc: 'EPF contribution (employee share)', amount: rs(72000), pd: '2025-12-31', bucket: '80c-epf' },
    // 80CCD(1B) — additional NPS Tier-I (OLD only)
    {
      sec: '80CCD_1B', desc: 'NPS Tier-I additional contribution',
      amount: rs(50000), pd: '2025-12-20', bucket: '80ccd1b-nps-self',
      eligibleNew: false,
    },
    // 80CCD(2) — employer NPS contribution (eligible under NEW)
    {
      sec: '80CCD_2', desc: 'NPS employer contribution (10% of basic+da)',
      amount: rs(84800), pd: '2025-12-31', bucket: '80ccd2-nps-employer',
      eligibleNew: true,
    },
    // 80D — self/family (no sr citizen)
    {
      sec: '80D', desc: 'Self/family health insurance premium',
      amount: rs(28000), pd: '2025-05-15', bucket: '80d-self',
      eightyDBucket: 'SELF_FAMILY',
    },
    // 80D — parents (sr citizen — cap ₹50k applies in lib)
    {
      sec: '80D', desc: 'Parents health insurance + preventive check-up',
      amount: rs(42000), pd: '2025-05-15', bucket: '80d-parents',
      eightyDBucket: 'PARENTS',
    },
    // 80E — education loan interest
    { sec: '80E', desc: 'Education loan interest', amount: rs(65000), pd: '2025-09-15', bucket: '80e-edu-loan' },
    // 80G — PM CARES (100% no limit)
    {
      sec: '80G', desc: 'PM CARES donation',
      amount: rs(25000), pd: '2025-04-15', bucket: '80g-pmcares',
      eightyGCategory: '100_NO_LIMIT',
      recipientName: 'PM CARES Fund',
      qualifyingPercent: 100,
    },
    // 80G — local NGO (50% with limit)
    {
      sec: '80G', desc: 'Local NGO donation',
      amount: rs(15000), pd: '2025-08-10', bucket: '80g-ngo',
      eightyGCategory: '50_WITH_LIMIT',
      recipientName: 'Saksham Trust',
      recipientPan: 'AAATS1234F',
      recipient80gNumber: 'AAATS1234F/CIT(E)/2024-25',
      qualifyingPercent: 50,
    },
    // 80TTA — savings interest
    { sec: '80TTA', desc: 'Savings bank interest deduction', amount: rs(10000), pd: '2026-03-31', bucket: '80tta-savings' },
    // 80EEB — EV loan interest
    { sec: '80EEB', desc: 'Electric vehicle loan interest', amount: rs(40000), pd: '2025-11-01', bucket: '80eeb-ev' },
  ];
  for (const r of dedRows) {
    const amount = r.amount;
    await tx`
      INSERT INTO tax_deductions
        (user_id, section, description, financial_year,
         deductible_amount, available_limit, utilizable_amount,
         claimed, claimed_amount,
         amount_paisa, payment_date, payment_method,
         incurred_date,
         eligible_under_new,
         eighty_g_category, eighty_d_bucket,
         recipient_name, recipient_pan, recipient_80g_number,
         qualifying_percent, has_upper_limit,
         notes)
      VALUES
        (${TARGET_USER_ID}, ${r.sec}, ${r.desc}, ${FY},
         ${amount}, ${0}, ${0},
         true, ${amount},
         ${amount}, ${r.pd}, 'NEFT',
         ${r.pd},
         ${r.eligibleNew ?? false},
         ${r.eightyGCategory ?? null}, ${r.eightyDBucket ?? null},
         ${r.recipientName ?? null}, ${r.recipientPan ?? null}, ${r.recipient80gNumber ?? null},
         ${r.qualifyingPercent ?? null}, ${false},
         ${NOTE(r.bucket)})
    `;
    tally('tax_deductions', 1);
  }

  // ─── tds_credits — 5 rows ─────────────────────────────────────────
  const tdsRows = [
    {
      category: 'OTHER', deductor: 'Heartfulness Institute', tan: 'BLRX99999E',
      section: '192', income: gross, tds: rs(120000), bucket: 'tds-salary',
    },
    {
      category: 'INTEREST', deductor: 'SBI Bank', tan: 'MUMS00001E',
      section: '194A', income: rs(85000), tds: rs(8500), bucket: 'tds-fd-interest',
    },
    {
      category: 'CONSULTING', deductor: 'TechClient Pvt Ltd', tan: 'BLRT88888E',
      section: '194J', income: rs(150000), tds: rs(15000), bucket: 'tds-194j',
    },
    {
      category: 'RENT', deductor: 'Tenant XYZ', tan: 'BLRR77777E',
      section: '194I', income: rs(300000), tds: rs(7500), bucket: 'tds-194i',
    },
    {
      category: 'PROPERTY', deductor: 'Buyer ABC', pan: 'XXXXX1234X',
      section: '194-IA', income: lakh(40), tds: rs(20000), bucket: 'tds-194ia',
    },
  ];
  for (const r of tdsRows) {
    await tx`
      INSERT INTO tds_credits
        (user_id, financial_year, category, deductor_name,
         deductor_tan, deductor_pan, section,
         income_paisa, tds_paisa, is_reconciled, notes)
      VALUES
        (${TARGET_USER_ID}, ${FY}, ${r.category}, ${r.deductor},
         ${r.tan ?? null}, ${r.pan ?? null}, ${r.section},
         ${r.income}, ${r.tds}, false, ${NOTE(r.bucket)})
    `;
    tally('tds_credits', 1);
  }

  // ─── holdings — 5 stocks ──────────────────────────────────────────
  const stocks = [
    { sym: 'RELIANCE.NS', qty: 100, avg: rs(1250), cur: rs(1310), purchase: '2024-02-15' },
    { sym: 'INFY.NS',     qty: 50,  avg: rs(1520), cur: rs(1605), purchase: '2024-04-10' },
    { sym: 'HDFCBANK.NS', qty: 75,  avg: rs(1680), cur: rs(1640), purchase: '2024-01-20' },
    { sym: 'TCS.NS',      qty: 30,  avg: rs(3400), cur: rs(3520), purchase: '2024-06-05' },
    { sym: 'ITC.NS',      qty: 200, avg: rs(450),  cur: rs(472),  purchase: '2024-03-12' },
  ];
  for (const s of stocks) {
    const totInv = s.qty * s.avg;
    const curVal = s.qty * s.cur;
    const gain = curVal - totInv;
    const gainPct = (gain / totInv) * 100;
    await tx`
      INSERT INTO holdings
        (user_id, symbol, quantity, average_price, current_price,
         purchase_date, total_investment, current_value,
         gain_loss, gain_loss_percent, notes)
      VALUES
        (${TARGET_USER_ID}, ${s.sym}, ${s.qty}, ${s.avg}, ${s.cur},
         ${s.purchase}, ${totInv}, ${curVal},
         ${gain}, ${gainPct}, ${NOTE('stock-' + s.sym.split('.')[0].toLowerCase())})
    `;
    tally('holdings', 1);
  }

  // ─── mutual_funds — 8 funds across categories ────────────────────
  // fund_type valid set: EQUITY|DEBT|HYBRID|LIQUID|GOLD (AMFI scheme class)
  // category   valid set: EQUITY|DEBT|HYBRID|UNKNOWN    (rate bucket; Sprint 5.7)
  // Liquid funds map to DEBT for projection (Indian liquid funds are
  // short-term debt — typically 6–7% expected return, aligns with DEBT
  // bucket, not equity-like growth).
  const funds = [
    { isin: 'INF879O01027', name: 'Parag Parikh Flexi Cap - Direct Growth', type: 'EQUITY', cat: 'EQUITY', units: 1850.5, nav: rs(82.4), totInv: lakh(1.2), start: '2023-04-10' },
    { isin: 'INF769K01010', name: 'Mirae Asset Large Cap - Direct Growth',  type: 'EQUITY', cat: 'EQUITY', units: 1320.0, nav: rs(108.2), totInv: lakh(1.3), start: '2023-05-05' },
    { isin: 'INF200K01QX4', name: 'SBI Small Cap - Direct Growth',          type: 'EQUITY', cat: 'EQUITY', units: 720.0,  nav: rs(168.5), totInv: lakh(1.0), start: '2023-08-15' },
    { isin: 'INF846K01EW2', name: 'Axis Bluechip - Direct Growth',          type: 'EQUITY', cat: 'EQUITY', units: 2100.0, nav: rs(58.7),  totInv: lakh(1.1), start: '2023-06-20' },
    { isin: 'INF204KB1FD3', name: 'Nippon India Multi Asset - Direct Growth', type: 'HYBRID', cat: 'HYBRID', units: 4500.0, nav: rs(18.9), totInv: lakh(0.8), start: '2023-09-10' },
    { isin: 'INF966L01A35', name: 'Quant ELSS Tax Saver - Direct Growth',   type: 'EQUITY', cat: 'EQUITY', units: 1100.0, nav: rs(412.3), totInv: lakh(4.0), start: '2022-12-05' },
    { isin: 'INF179K01OC6', name: 'HDFC Corporate Bond - Direct Growth',    type: 'DEBT',   cat: 'DEBT',   units: 12000.0, nav: rs(31.5),  totInv: lakh(3.5), start: '2022-04-15' },
    { isin: 'INF109K01F18', name: 'ICICI Pru Liquid - Direct Growth',       type: 'LIQUID', cat: 'DEBT',   units: 450.0,  nav: rs(356.0), totInv: lakh(1.5), start: '2024-01-08' },
  ];
  for (const f of funds) {
    const curVal = Math.round(f.units * f.nav);
    const gain = curVal - f.totInv;
    const gainPct = f.totInv === 0 ? 0 : (gain / f.totInv) * 100;
    await tx`
      INSERT INTO mutual_funds
        (user_id, isin, scheme_name, fund_type, category, units, nav,
         total_investment, current_value, gain_loss, gain_loss_percent,
         last_nav_date, investment_start_date, notes)
      VALUES
        (${TARGET_USER_ID}, ${f.isin}, ${f.name}, ${f.type}, ${f.cat},
         ${f.units}, ${f.nav},
         ${f.totInv}, ${curVal}, ${gain}, ${gainPct},
         '2026-06-01', ${f.start}, ${NOTE('mf-' + f.isin.toLowerCase())})
    `;
    tally('mutual_funds', 1);
  }

  // Resolve fund IDs for SIPs.
  const mfIdRows = await tx`
    SELECT id, isin FROM mutual_funds WHERE user_id = ${TARGET_USER_ID}
    ORDER BY id
  `;
  const mfByIsin = new Map(mfIdRows.map((r) => [r.isin, r.id]));

  // ─── sips — 4 active ─────────────────────────────────────────────
  const sipPlan = [
    { isin: 'INF879O01027', amt: rs(20000), day: 5,  startMonth: 4,  startUnits: 100.0, startNav: rs(80) },
    { isin: 'INF769K01010', amt: rs(15000), day: 10, startMonth: 4,  startUnits: 80.0,  startNav: rs(100) },
    { isin: 'INF200K01QX4', amt: rs(10000), day: 15, startMonth: 5,  startUnits: 30.0,  startNav: rs(160) },
    { isin: 'INF966L01A35', amt: rs(12500), day: 25, startMonth: 6,  startUnits: 25.0,  startNav: rs(390) },
  ];
  for (const s of sipPlan) {
    const mfId = mfByIsin.get(s.isin);
    if (!mfId) continue;
    // First exec date in FY 26-27 — day-of-month s.day in April 2026.
    const next = `2026-${String(s.day === 25 ? 7 : 7).padStart(2, '0')}-${String(s.day).padStart(2, '0')}`;
    const start = `2024-${String(s.startMonth).padStart(2, '0')}-${String(s.day).padStart(2, '0')}`;
    await tx`
      INSERT INTO sips
        (user_id, mutual_fund_id, status, frequency, monthly_amount,
         start_date, next_execution_date, total_invested_so_far,
         starting_units, starting_nav, notes)
      VALUES
        (${TARGET_USER_ID}, ${mfId}, 'ACTIVE', 'MONTHLY', ${s.amt},
         ${start}, ${next}, ${s.amt * 24},
         ${s.startUnits}, ${s.startNav}, ${NOTE('sip-' + s.isin.toLowerCase())})
    `;
    tally('sips', 1);
  }

  // ─── gold_holdings — 1 SGB ────────────────────────────────────────
  {
    const grams = 50;
    const buyPg = rs(4500);
    const nowPg = rs(7300);
    const totInv = grams * buyPg;
    const curVal = grams * nowPg;
    await tx`
      INSERT INTO gold_holdings
        (user_id, type, quantity, current_price, total_value,
         grams, purity, purchase_date, purchase_price_per_gram,
         current_rate_per_gram, total_investment, current_value,
         gain_loss, gain_loss_percent, name, notes)
      VALUES
        (${TARGET_USER_ID}, 'GOLD_BOND', ${grams}, ${nowPg}, ${curVal},
         ${grams}, '999', '2022-03-15', ${buyPg},
         ${nowPg}, ${totInv}, ${curVal},
         ${curVal - totInv}, ${((curVal - totInv) / totInv) * 100},
         'SGB 2021-22 Series VIII',
         ${NOTE('gold-sgb')})
    `;
    tally('gold_holdings', 1);
  }

  // ─── nps_accounts — 1 Tier-I ──────────────────────────────────────
  {
    const equity = lakh(4.5);
    const debt = lakh(2.5);
    const alt = lakh(1.5);
    const total = equity + debt + alt;
    const contrib = rs(50000) + rs(84800);
    // Sprint 5.5f — ₹50k 80CCD(1B) + ₹84.8k 80CCD(2) per year ÷ 12
    // = ₹11,235/mo monthly contribution stream.
    const monthlyContrib = Math.round((rs(50000) + rs(84800)) / 12);
    await tx`
      INSERT INTO nps_accounts
        (user_id, account_number, account_holder, pan, tier, status,
         equity_fund_value, debt_fund_value, alternative_fund_value,
         total_value, total_contributed, employer_contribution,
         monthly_contribution_paisa,
         gain_loss, opening_date, notes)
      VALUES
        (${TARGET_USER_ID}, 'PRAN110099887766', 'BXDEva Demo', 'XXXXX1234X',
         'TIER1', 'ACTIVE',
         ${equity}, ${debt}, ${alt},
         ${total}, ${contrib * 4}, ${rs(84800)},
         ${monthlyContrib},
         ${total - contrib * 4}, '2020-04-15',
         ${NOTE('nps-tier1')})
    `;
    tally('nps_accounts', 1);
  }

  // ─── epf_accounts — 1 ─────────────────────────────────────────────
  {
    const emp = lakh(3.8);
    const empr = lakh(3.8);
    const interest = rs(0); // bundled in totals
    const total = emp + empr + interest;
    // Sprint 5.5f — 24% of ₹6.6L basic+DA ÷ 12 ≈ ₹13,200/mo.
    // Brief spec called for ₹15,840 (~24% of ₹7.92L). Going with the
    // spec value so the projection delta on the verify step is
    // unambiguous.
    const monthlyContrib = rs(15840);
    await tx`
      INSERT INTO epf_accounts
        (user_id, account_type, account_holder, pan, uan,
         employee_balance, employer_balance, interest_balance,
         total_balance, total_contributed, interest_earned,
         monthly_contribution_paisa,
         opening_date, is_active, notes)
      VALUES
        (${TARGET_USER_ID}, 'EPF', 'BXDEva Demo', 'XXXXX1234X', 'UAN100200300',
         ${emp}, ${empr}, ${interest},
         ${total}, ${emp + empr}, ${interest},
         ${monthlyContrib},
         '2018-06-01', true, ${NOTE('epf-heartfulness')})
    `;
    tally('epf_accounts', 1);
  }

  // ─── small_savings_accounts — 3 (PPF, SSY, NSC) ──────────────────
  // Sprint 5.5f — periodic contribution streams:
  //   PPF: ₹8,333/mo (₹1L/yr ÷ 12) – well under the 1.5L 80C cap
  //   SSY: ₹15,000/mo
  //   NSC: 0 (lumpsum scheme — projection lib zeros this out anyway)
  const ssRows = [
    {
      scheme: 'PPF', acct: 'PPF8001100200300', holder: 'BXDEva Demo',
      institution: 'SBI Indiranagar',
      open: '2017-04-10', maturity: '2032-04-10', rate: 7.1,
      bal: lakh(6.5), totDep: lakh(7.5), totInt: lakh(0.5),
      bucket: 'ss-ppf',
      periodicContrib: rs(8333), contribFreq: 'MONTHLY',
    },
    {
      scheme: 'SSY', acct: 'SSY8001234567890', holder: 'Daughter',
      dob: '2017-08-22',
      institution: 'India Post Indiranagar',
      open: '2018-09-05', maturity: '2038-08-22', rate: 8.2,
      bal: lakh(1.8), totDep: lakh(2.0), totInt: rs(20000),
      bucket: 'ss-ssy',
      periodicContrib: rs(15000), contribFreq: 'MONTHLY',
    },
    {
      scheme: 'NSC', acct: 'NSC8009988776655', holder: 'BXDEva Demo',
      institution: 'India Post Indiranagar',
      open: '2022-10-10', maturity: '2027-10-10', rate: 7.7,
      bal: rs(58000), totDep: rs(50000), totInt: rs(8000),
      bucket: 'ss-nsc',
      periodicContrib: 0, contribFreq: 'MONTHLY',
    },
  ];
  for (const s of ssRows) {
    await tx`
      INSERT INTO small_savings_accounts
        (user_id, scheme_type, account_number, holder_name, holder_dob,
         institution, opening_date, maturity_date,
         deposit_amount_paisa, current_balance_paisa,
         interest_rate_percent, interest_compounding,
         lock_in_end_date,
         total_deposited_paisa, total_interest_paisa,
         periodic_contribution_paisa, contribution_frequency,
         status, notes)
      VALUES
        (${TARGET_USER_ID}, ${s.scheme}, ${s.acct}, ${s.holder}, ${s.dob ?? null},
         ${s.institution}, ${s.open}, ${s.maturity},
         ${0}, ${s.bal},
         ${s.rate}, 'YEARLY',
         ${s.maturity},
         ${s.totDep}, ${s.totInt},
         ${s.periodicContrib}, ${s.contribFreq},
         'ACTIVE', ${NOTE(s.bucket)})
    `;
    tally('small_savings_accounts', 1);
  }

  // ─── fixed_deposits — 5 ───────────────────────────────────────────
  const fds = [
    { bank: 'SBI',    acct: 'SBIFD0001', principal: lakh(3),   rate: 7.1,  start: '2025-03-01', mat: '2026-03-01', tenure: 12, comp: 'QUARTERLY' },
    { bank: 'HDFC',   acct: 'HDFCFD002', principal: lakh(2),   rate: 7.25, start: '2025-08-01', mat: '2026-08-01', tenure: 12, comp: 'QUARTERLY' },
    { bank: 'ICICI',  acct: 'ICICIFD003', principal: lakh(5),  rate: 7.0,  start: '2024-12-01', mat: '2027-12-01', tenure: 36, comp: 'QUARTERLY' },
    { bank: 'Axis',   acct: 'AXISFD004', principal: lakh(1.5), rate: 7.4,  start: '2025-06-01', mat: '2026-06-01', tenure: 12, comp: 'QUARTERLY' },
    { bank: 'Kotak',  acct: 'KOTAKFD005', principal: lakh(4),  rate: 7.15, start: '2025-10-01', mat: '2028-10-01', tenure: 36, comp: 'QUARTERLY' },
  ];
  for (const f of fds) {
    // Maturity ≈ principal × (1 + rate/4/100)^(tenure/3). For demo,
    // approximate via simple compound.
    const periods = f.tenure / 3;
    const matAmt = Math.round(f.principal * Math.pow(1 + f.rate / 400, periods));
    await tx`
      INSERT INTO fixed_deposits
        (user_id, bank_name, account_number, principal_paisa,
         interest_rate, compounding_freq, interest_type,
         start_date, maturity_date, tenure_months,
         maturity_amount_paisa, status, is_tax_saver, auto_renew, notes)
      VALUES
        (${TARGET_USER_ID}, ${f.bank}, ${f.acct}, ${f.principal},
         ${f.rate}, ${f.comp}, 'CUMULATIVE',
         ${f.start}, ${f.mat}, ${f.tenure},
         ${matAmt}, 'ACTIVE', false, false, ${NOTE('fd-' + f.bank.toLowerCase())})
    `;
    tally('fixed_deposits', 1);
  }

  // ─── forex_deposits — 3 (Sprint 5.10) ─────────────────────────────
  // INR equivalents resolve at runtime via Yahoo Finance — the seed
  // only writes the foreign amount. Two ongoing (no maturity_date) +
  // one fixed deposit maturing in 2028 so the cashflow-derive layer
  // emits a FOREX_MATURITY event for it.
  const forex = [
    { bank: 'HDFC NRE', acct: 'HDFC-NRE-001', ccy: 'USD', amt: '5000.0000',  rate: 4.0, opening: '2024-09-15', maturity: null,         status: 'ACTIVE', note: 'forex-hdfc-usd' },
    { bank: 'ICICI NRE Bank', acct: 'ICICI-NRE-002', ccy: 'EUR', amt: '2000.0000', rate: 2.5, opening: '2025-06-01', maturity: '2028-06-01', status: 'ACTIVE', note: 'forex-icici-eur' },
    { bank: 'ENBD', acct: 'ENBD-DBX-003', ccy: 'AED', amt: '10000.0000', rate: 1.5, opening: '2023-04-12', maturity: null,         status: 'ACTIVE', note: 'forex-enbd-aed' },
  ];
  for (const f of forex) {
    await tx`
      INSERT INTO forex_deposits
        (user_id, bank_name, account_number, currency_code,
         amount_in_currency, interest_rate,
         opening_date, maturity_date, status, notes)
      VALUES
        (${TARGET_USER_ID}, ${f.bank}, ${f.acct}, ${f.ccy},
         ${f.amt}, ${f.rate},
         ${f.opening}, ${f.maturity}, ${f.status}, ${NOTE(f.note)})
    `;
    tally('forex_deposits', 1);
  }

  // ─── liabilities — 2 ─────────────────────────────────────────────
  await tx`
    INSERT INTO liabilities
      (user_id, name, type, status, creditor_name,
       original_amount, current_balance, interest_rate, monthly_emi,
       start_date, maturity_date, remaining_tenor,
       next_payment_date, notes)
    VALUES
      (${TARGET_USER_ID}, 'Anand Apartment home loan', 'HOME_LOAN', 'ACTIVE',
       'HDFC Bank',
       ${lakh(65)}, ${lakh(52)}, ${8.6}, ${rs(58000)},
       '2018-07-01', '2038-07-01', 144,
       '2026-07-05', ${NOTE('liab-home-loan')})
  `;
  tally('liabilities', 1);
  await tx`
    INSERT INTO liabilities
      (user_id, name, type, status, creditor_name,
       original_amount, current_balance, interest_rate, monthly_emi,
       start_date,
       next_payment_date, notes)
    VALUES
      (${TARGET_USER_ID}, 'HDFC Regalia Credit Card', 'CREDIT_CARD', 'ACTIVE',
       'HDFC Bank',
       ${rs(300000)}, ${rs(35000)}, ${42.0}, ${rs(5000)},
       '2020-04-01',
       '2026-06-15', ${NOTE('liab-credit-card')})
  `;
  tally('liabilities', 1);

  // ─── insurance_policies — 3 LIFE ──────────────────────────────────
  const lifePolicies = [
    {
      policyNo: 'LICTERM10001', type: 'TERM_LIFE', insurer: 'LIC of India',
      sumAssured: cr(1), premium: rs(18000),
      freq: 'ANNUAL', start: '2018-04-15', term: 30, ppt: 30,
      nextDue: '2026-04-15', bucket: 'ins-lic-term',
    },
    {
      policyNo: 'LICEND20002', type: 'ENDOWMENT', insurer: 'LIC of India',
      sumAssured: lakh(15), premium: rs(35000),
      freq: 'ANNUAL', start: '2015-07-10', term: 20, ppt: 20,
      nextDue: '2026-07-10', bucket: 'ins-lic-endowment',
      maturity: '2035-07-10', maturityBenefit: lakh(25),
    },
    {
      policyNo: 'HDFCULIP30003', type: 'ULIP', insurer: 'HDFC Life',
      sumAssured: lakh(30), premium: rs(50000),
      freq: 'ANNUAL', start: '2020-05-20', term: 15, ppt: 15,
      nextDue: '2026-05-20', bucket: 'ins-hdfc-ulip',
      maturity: '2035-05-20', maturityBenefit: lakh(45),
    },
  ];
  for (const p of lifePolicies) {
    await tx`
      INSERT INTO insurance_policies
        (user_id, policy_number, policy_type, status, policy_holder,
         insurer, sum_assured, maturity_benefit, premium_amount,
         premium_frequency, policy_start_date, maturity_date,
         policy_term, premium_payment_term, next_premium_due_date, notes)
      VALUES
        (${TARGET_USER_ID}, ${p.policyNo}, ${p.type}, 'ACTIVE', 'BXDEva Demo',
         ${p.insurer}, ${p.sumAssured}, ${p.maturityBenefit ?? null}, ${p.premium},
         ${p.freq}, ${p.start}, ${p.maturity ?? null},
         ${p.term}, ${p.ppt}, ${p.nextDue}, ${NOTE(p.bucket)})
    `;
    tally('insurance_policies', 1);
  }

  // ─── health_insurance_policies — 1 family floater ─────────────────
  const healthRows = await tx`
    INSERT INTO health_insurance_policies
      (user_id, insurer, policy_number, policy_type, status, policy_holder,
       sum_insured_paisa, premium_paisa, premium_frequency,
       start_date, renewal_date, waiting_period_months,
       served_waiting_months, cashless_available, network_hospital_count, notes)
    VALUES
      (${TARGET_USER_ID}, 'Star Health', 'STARHEALTHFAM12345', 'FAMILY_FLOATER',
       'ACTIVE', 'BXDEva Demo',
       ${lakh(10)}, ${rs(28000)}, 'ANNUAL',
       '2023-04-15', '2026-04-15', 48,
       36, true, 12000, ${NOTE('health-star-family-floater')})
    RETURNING id
  `;
  tally('health_insurance_policies', 1);
  const healthPolicyId = healthRows[0].id;
  // family of 4 — self/spouse/2 children
  const fam = [
    { name: 'BXDEva Demo',  rel: 'SELF',     dob: '1988-04-12', gender: 'M' },
    { name: 'Spouse Demo',  rel: 'SPOUSE',   dob: '1990-08-22', gender: 'F' },
    { name: 'Child 1 Demo', rel: 'DAUGHTER', dob: '2017-08-22', gender: 'F' },
    { name: 'Child 2 Demo', rel: 'SON',      dob: '2020-03-05', gender: 'M' },
  ];
  for (const m of fam) {
    await tx`
      INSERT INTO health_insurance_cards
        (user_id, policy_id, member_name, member_id, relationship,
         date_of_birth, gender, notes)
      VALUES
        (${TARGET_USER_ID}, ${healthPolicyId}, ${m.name},
         ${`SH-${healthPolicyId}-${m.rel}`}, ${m.rel},
         ${m.dob}, ${m.gender}, ${NOTE('health-card-' + m.rel.toLowerCase())})
    `;
    // health_insurance_cards has no notes col? Confirm via schema —
    // schema does have `notes`. OK.
    tally('health_insurance_cards', 1);
  }

  // ─── vehicles + insurance + PUC + service ─────────────────────────
  const vehRows = await tx`
    INSERT INTO vehicles
      (user_id, registration_number, make, model, variant, year,
       fuel_type, transmission, color, body_type,
       purchase_date, purchase_price_paisa, current_idv_paisa,
       odometer_km, status, notes)
    VALUES
      (${TARGET_USER_ID}, 'KA01XX1234', 'Honda', 'City', 'V CVT', 2020,
       'PETROL', 'AUTOMATIC', 'Pearl White', 'SEDAN',
       '2020-03-15', ${lakh(12)}, ${lakh(8)},
       65000, 'ACTIVE', ${NOTE('veh-honda-city')})
    RETURNING id
  `;
  tally('vehicles', 1);
  const vehicleId = vehRows[0].id;
  await tx`
    INSERT INTO vehicle_insurance_policies
      (user_id, vehicle_id, insurer, policy_number, insurance_type,
       idv_paisa, premium_paisa, own_damage_premium_paisa,
       third_party_premium_paisa, ncb_percent, addons,
       premium_frequency, start_date, renewal_date,
       claims_made_count, status, notes)
    VALUES
      (${TARGET_USER_ID}, ${vehicleId}, 'ICICI Lombard',
       ${`VEHINS-${vehicleId}-2025`}, 'COMPREHENSIVE',
       ${lakh(8)}, ${rs(18500)}, ${rs(12000)},
       ${rs(4500)}, 35, ${'["ZERO_DEP","ENGINE_PROTECT","RSA"]'},
       'ANNUAL', '2025-09-15', '2026-09-15',
       0, 'ACTIVE', ${NOTE('vehins-honda-city')})
  `;
  tally('vehicle_insurance_policies', 1);
  await tx`
    INSERT INTO vehicle_puc
      (user_id, vehicle_id, certificate_number, issued_date,
       valid_until, issuing_authority, cost_paisa, notes)
    VALUES
      (${TARGET_USER_ID}, ${vehicleId},
       ${`PUC-${vehicleId}-2025`},
       '2025-12-01', '2026-12-01',
       'Authorised PUC Center, Indiranagar', ${rs(150)},
       ${NOTE('puc-honda-city')})
  `;
  tally('vehicle_puc', 1);
  await tx`
    INSERT INTO vehicle_service_log
      (user_id, vehicle_id, service_date, odometer_km, service_type,
       garage_name, cost_paisa, description,
       next_service_due_date, next_service_due_km, notes)
    VALUES
      (${TARGET_USER_ID}, ${vehicleId}, '2026-02-10', 62000, 'REGULAR',
       'Honda Authorised Service Center', ${rs(8500)},
       '60k km service — oil, filter, brake pads',
       '2026-08-10', 70000, ${NOTE('veh-service-honda-60k')})
  `;
  tally('vehicle_service_log', 1);

  // ─── subscriptions — 6 ────────────────────────────────────────────
  const subs = [
    { name: 'Netflix',     prov: 'Netflix', cat: 'STREAMING',    plan: 'Standard', amt: rs(649),  freq: 'MONTHLY' },
    { name: 'Spotify',     prov: 'Spotify', cat: 'STREAMING',    plan: 'Individual', amt: rs(119), freq: 'MONTHLY' },
    { name: 'Notion',      prov: 'Notion Labs', cat: 'PRODUCTIVITY', plan: 'Plus',  amt: rs(950),  freq: 'MONTHLY' },
    { name: 'ChatGPT Plus', prov: 'OpenAI', cat: 'AI', plan: 'Plus', amt: rs(1650), freq: 'MONTHLY' },
    { name: 'AWS Personal Cloud', prov: 'Amazon Web Services', cat: 'CLOUD', plan: 'Reserved + EC2', amt: rs(4200), freq: 'MONTHLY' },
    { name: 'Times Prime', prov: 'Times Internet', cat: 'NEWS',  plan: 'Annual', amt: rs(1499), freq: 'ANNUAL' },
  ];
  for (const s of subs) {
    await tx`
      INSERT INTO subscriptions
        (user_id, name, provider, category, plan_name, amount_paisa,
         billing_frequency, start_date, next_renewal_date, payment_method,
         auto_renew, status, notes)
      VALUES
        (${TARGET_USER_ID}, ${s.name}, ${s.prov}, ${s.cat}, ${s.plan},
         ${s.amt}, ${s.freq}, '2025-04-01',
         ${s.freq === 'ANNUAL' ? '2026-04-01' : '2026-06-15'},
         'HDFC Regalia', true, 'ACTIVE', ${NOTE('sub-' + s.name.toLowerCase().replace(/\W+/g, '-'))})
    `;
    tally('subscriptions', 1);
  }

  // ─── budget_categories + budget_entries — 24 entries (2/month × 12) ──
  const groceriesCatRows = await tx`
    INSERT INTO budget_categories
      (user_id, name, type, sort_order, is_active)
    VALUES (${TARGET_USER_ID}, 'Groceries (Demo)', 'EXPENSE', 9001, true)
    RETURNING id
  `;
  tally('budget_categories', 1);
  const groceriesId = groceriesCatRows[0].id;

  const utilitiesCatRows = await tx`
    INSERT INTO budget_categories
      (user_id, name, type, sort_order, is_active)
    VALUES (${TARGET_USER_ID}, 'Utilities (Demo)', 'EXPENSE', 9002, true)
    RETURNING id
  `;
  tally('budget_categories', 1);
  const utilitiesId = utilitiesCatRows[0].id;

  // 12 months: April 2025 → March 2026 (FY 2025-26).
  // Use deterministic ±20% drift seeded from month index for repeatability.
  const monthsFY = [
    { m: 4,  y: 2025 }, { m: 5,  y: 2025 }, { m: 6,  y: 2025 },
    { m: 7,  y: 2025 }, { m: 8,  y: 2025 }, { m: 9,  y: 2025 },
    { m: 10, y: 2025 }, { m: 11, y: 2025 }, { m: 12, y: 2025 },
    { m: 1,  y: 2026 }, { m: 2,  y: 2026 }, { m: 3,  y: 2026 },
  ];
  for (let i = 0; i < monthsFY.length; i++) {
    const { m, y } = monthsFY[i];
    const period = `${String(m).padStart(2, '0')}${y}`;
    // Deterministic variance: ±20% drift centred on means.
    const variance = ((i * 37) % 41) / 100 - 0.20; // ranges roughly -0.2…+0.2
    const groceries = Math.round(rs(15000) * (1 + variance));
    const utilities = Math.round(rs(4500)  * (1 - variance));
    await tx`
      INSERT INTO budget_entries
        (user_id, category_id, period, planned_amount, actual_amount, notes)
      VALUES
        (${TARGET_USER_ID}, ${groceriesId}, ${period}, ${rs(15000)}, ${groceries},
         ${NOTE('budget-groceries-' + period)})
    `;
    tally('budget_entries', 1);
    await tx`
      INSERT INTO budget_entries
        (user_id, category_id, period, planned_amount, actual_amount, notes)
      VALUES
        (${TARGET_USER_ID}, ${utilitiesId}, ${period}, ${rs(4500)}, ${utilities},
         ${NOTE('budget-utilities-' + period)})
    `;
    tally('budget_entries', 1);
  }

  // ─── financial_goals — 3 ─────────────────────────────────────────
  const goals = [
    {
      name: "Daughter's higher education", target: lakh(50),
      tdate: '2032-12-31', goalType: 'EDUCATION', disb: 'LUMPSUM',
      bucket: 'goal-education',
    },
    {
      name: 'Retirement corpus', target: cr(5),
      tdate: '2045-12-31', goalType: 'OTHER', disb: 'INFLATION_SWP',
      bucket: 'goal-retirement',
      growthPct: 6,
      disbAmountPerYr: lakh(15),
      disbYears: 30,
      disbStart: '2046-01-01',
    },
    {
      name: 'House upgrade', target: lakh(40),
      tdate: '2030-12-31', goalType: 'HOUSE', disb: 'LUMPSUM',
      bucket: 'goal-house',
    },
  ];
  for (const g of goals) {
    await tx`
      INSERT INTO financial_goals
        (user_id, name, target_amount, target_date, current_amount,
         color, is_active, goal_type, disbursement_type,
         disbursement_amount_per_yr_paisa, disbursement_years,
         disbursement_start_date, growth_pct_per_yr,
         expected_return_pct, inflation_pct)
      VALUES
        (${TARGET_USER_ID}, ${g.name}, ${g.target}, ${g.tdate}, ${0},
         '#10b981', true, ${g.goalType}, ${g.disb},
         ${g.disbAmountPerYr ?? null}, ${g.disbYears ?? null},
         ${g.disbStart ?? null}, ${g.growthPct ?? 0},
         ${10}, ${6})
    `;
    tally('financial_goals', 1);
    // financial_goals has no `notes` column — cleanup uses a marker
    // instead. We rely on name matching (these 3 demo names are
    // distinctive enough that the user's real goals won't collide).
    // For safety on re-run we delete + re-insert below in cleanup
    // (handled via DELETE WHERE name IN (...) — see cleanup func).
  }

  // ─── itr_form_selection — 1 row (ITR-2 for multi-property + capgains) ──
  const wizardAnswers = {
    hasSalary: true,
    numHouseProperties: 3,
    hasCapitalGains: true,
    hasBusinessIncome: false,
    hasPresumptive: false,
    hasForeignIncome: false,
    hasOtherSources: true,
    totalIncomePaisa: gross + rs(35000) + rs(85000) + rs(15000),
  };
  // postgres-js serializes JS objects as JSON for json/jsonb params.
  await tx`
    INSERT INTO itr_form_selection
      (user_id, fy, selected_form, wizard_answers, reasoning)
    VALUES
      (${TARGET_USER_ID}, ${FY}, 'ITR-2',
       ${JSON.stringify(wizardAnswers)}::jsonb,
       'Multiple house properties (3) + capital gains require ITR-2 (ITR-1 caps at 1 property and no capital gains).')
  `;
  tally('itr_form_selection', 1);
}

// ─── finalisation: cleanup financial_goals (no notes column) ──────
// Re-run-safety: financial_goals doesn't have a notes column. We can't
// flag rows as DEMO-SEED, so we use a distinctive name list. To keep
// cleanup idempotent, we DELETE rows by name BEFORE inserting (handled
// inside cleanup via a sentinel — see below).
async function cleanupGoals(tx) {
  await tx`
    DELETE FROM financial_goals
    WHERE user_id = ${TARGET_USER_ID}
      AND name IN (
        'Daughter''s higher education',
        'Retirement corpus',
        'House upgrade'
      )
  `;
}

// ─── main ───────────────────────────────────────────────────────────
console.log(`Seeding demo data for BXDEva (user.id=${TARGET_USER_ID}, FY=${FY})`);

try {
  await guardSafety();
  console.log('  Safety gate passed — no real data found.');

  await sql.begin(async (tx) => {
    await cleanup(tx);
    await cleanupGoals(tx);
    console.log('  Prior DEMO-SEED rows wiped.');
    await seedAll(tx);
  });

  console.log('\nSeeded counts:');
  const sortedTables = Object.keys(inserted).sort();
  for (const t of sortedTables) {
    console.log(`  ${t.padEnd(32)} ${inserted[t]}`);
  }
  const total = Object.values(inserted).reduce((s, n) => s + n, 0);
  console.log(`  ${'TOTAL'.padEnd(32)} ${total}`);
} catch (err) {
  console.error('\nSEED FAILED:', err.message);
  console.error(err.stack);
  process.exitCode = 1;
} finally {
  await sql.end();
}
