#!/usr/bin/env node
/**
 * Seed synthetic demo data for evaluation / screenshots / first-run UX.
 *
 * Creates (or finds) a user with the given email, then populates every
 * major asset class with believable INR values. All values are in paisa
 * where applicable. No real PII — fictional ISINs, fake PANs, generic
 * names. Safe to run on a production DB if you want a demo account.
 *
 * Usage:
 *   node scripts/seed-demo.mjs                        # uses demo@pfd-saas.local
 *   node scripts/seed-demo.mjs --owner-email=foo@x   # populate any user
 *
 * Idempotency: every insert is guarded — if the user already has rows
 * in a table, that table is skipped (the script reports skipped tables
 * in its summary). To re-seed from scratch, delete the user row first;
 * ON DELETE CASCADE wipes everything tied to that user_id.
 */

import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import postgres from 'postgres';
import { randomUUID } from 'node:crypto';

const DEFAULT_EMAIL = 'demo@pfd-saas.local';

// ─── args ───────────────────────────────────────────────────────────
const arg = process.argv.find((a) => a.startsWith('--owner-email='));
const OWNER_EMAIL = arg ? arg.split('=')[1] : DEFAULT_EMAIL;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not set (check .env.local)');
  process.exit(2);
}

const sql = postgres(DATABASE_URL, { max: 4, prepare: false });

// ─── helpers ────────────────────────────────────────────────────────
const today = new Date().toISOString().substring(0, 10);
const lakh = (n) => n * 100000 * 100; // ₹n lakh in paisa
const cr = (n) => n * 10000000 * 100; // ₹n cr in paisa

const fyNow = (() => {
  const d = new Date();
  const fyStart = d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1;
  return `${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')}`;
})();

const monthsAgoIso = (n) => {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().substring(0, 10);
};

const daysAgoIso = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().substring(0, 10);
};

const monthsAheadIso = (n) => {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return d.toISOString().substring(0, 10);
};

const currentPeriod = () => {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, '0')}${d.getFullYear()}`;
};

const sectionsRun = [];
const sectionsSkipped = [];

async function tableIsEmpty(table, userId) {
  const rows = await sql`SELECT 1 FROM ${sql(table)} WHERE user_id = ${userId} LIMIT 1`;
  return rows.length === 0;
}

async function guardSection(name, table, userId, fn) {
  if (!(await tableIsEmpty(table, userId))) {
    sectionsSkipped.push(name);
    return;
  }
  await fn();
  sectionsRun.push(name);
}

// ─── connect + find/create user ─────────────────────────────────────
console.log(`Seeding demo data for: ${OWNER_EMAIL}`);

const existingUsers = await sql`SELECT id FROM "user" WHERE email = ${OWNER_EMAIL}`;
let userId;
if (existingUsers.length > 0) {
  userId = existingUsers[0].id;
  console.log(`  Found existing user.id=${userId}`);
} else {
  userId = randomUUID();
  await sql`INSERT INTO "user" (id, email, name, email_verified) VALUES (${userId}, ${OWNER_EMAIL}, 'Demo User', NOW())`;
  console.log(`  Created user.id=${userId}`);
}

// ─── user_preferences ──────────────────────────────────────────────
await guardSection('user_preferences', 'user_preferences', userId, async () => {
  await sql`
    INSERT INTO user_preferences (user_id, display_name, base_currency, financial_year_start_month, onboarded_at)
    VALUES (${userId}, 'Demo User', 'INR', 4, NOW())
  `;
});

// ─── business_profile (GST) ────────────────────────────────────────
await guardSection('business_profile', 'business_profile', userId, async () => {
  await sql`
    INSERT INTO business_profile (user_id, business_name, gstin, pan, state_code, financial_year)
    VALUES (${userId}, 'Demo Freelance Services', ${`33DEMO${userId.slice(0, 4).toUpperCase()}1Z9`.substring(0, 15)}, 'DEMOX9999X', '33', ${fyNow})
  `;
});

// ─── holdings (stocks) ─────────────────────────────────────────────
await guardSection('holdings', 'holdings', userId, async () => {
  const stocks = [
    { symbol: 'TCS.NS',     qty: 25, avg: 3200_00, cur: 3850_00 },
    { symbol: 'INFY.NS',    qty: 50, avg: 1450_00, cur: 1620_00 },
    { symbol: 'RELIANCE.NS', qty: 40, avg: 2400_00, cur: 2780_00 },
    { symbol: 'HDFCBANK.NS', qty: 30, avg: 1550_00, cur: 1700_00 },
  ];
  for (const s of stocks) {
    const totalInv = s.qty * s.avg;
    const curVal = s.qty * s.cur;
    const gain = curVal - totalInv;
    const gainPct = (gain / totalInv) * 100;
    await sql`
      INSERT INTO holdings (user_id, symbol, quantity, average_price, current_price, purchase_date, total_investment, current_value, gain_loss, gain_loss_percent)
      VALUES (${userId}, ${s.symbol}, ${s.qty}, ${s.avg}, ${s.cur}, ${monthsAgoIso(18)}, ${totalInv}, ${curVal}, ${gain}, ${gainPct})
    `;
  }
});

// ─── mutual_funds ──────────────────────────────────────────────────
await guardSection('mutual_funds', 'mutual_funds', userId, async () => {
  const funds = [
    { isin: 'INDEMO0001', name: 'Demo Bluechip Equity Fund - Direct Growth',    type: 'EQUITY', units: 1850.4, nav: 92_50,  inv: lakh(1.5) },
    { isin: 'INDEMO0002', name: 'Demo Mid Cap Fund - Direct Growth',            type: 'EQUITY', units: 1200.0, nav: 145_00, inv: lakh(1.2) },
    { isin: 'INDEMO0003', name: 'Demo Balanced Advantage Fund - Direct Growth', type: 'HYBRID', units: 950.0,  nav: 78_30,  inv: lakh(0.6) },
  ];
  for (const f of funds) {
    const curVal = Math.round(f.units * f.nav);
    const gain = curVal - f.inv;
    const gainPct = (gain / f.inv) * 100;
    await sql`
      INSERT INTO mutual_funds (user_id, isin, scheme_name, fund_type, units, nav, total_investment, current_value, gain_loss, gain_loss_percent, last_nav_date)
      VALUES (${userId}, ${f.isin}, ${f.name}, ${f.type}, ${f.units}, ${f.nav}, ${f.inv}, ${curVal}, ${gain}, ${gainPct}, ${today})
    `;
  }
});

// ─── sips ──────────────────────────────────────────────────────────
await guardSection('sips', 'sips', userId, async () => {
  const mfRows = await sql`SELECT id FROM mutual_funds WHERE user_id = ${userId} ORDER BY id LIMIT 2`;
  if (mfRows.length < 2) return;
  await sql`
    INSERT INTO sips (user_id, mutual_fund_id, status, frequency, monthly_amount, start_date, next_execution_date, total_invested_so_far, starting_units, starting_nav)
    VALUES (${userId}, ${mfRows[0].id}, 'ACTIVE', 'MONTHLY', ${5000_00}, ${monthsAgoIso(12)}, ${monthsAheadIso(0)}, ${lakh(0.6)}, ${73.0}, ${8200})
  `;
  await sql`
    INSERT INTO sips (user_id, mutual_fund_id, status, frequency, monthly_amount, start_date, next_execution_date, total_invested_so_far, starting_units, starting_nav)
    VALUES (${userId}, ${mfRows[1].id}, 'ACTIVE', 'MONTHLY', ${10000_00}, ${monthsAgoIso(10)}, ${monthsAheadIso(0)}, ${lakh(1.0)}, ${72.5}, ${13800})
  `;
});

// ─── gold_holdings ─────────────────────────────────────────────────
await guardSection('gold_holdings', 'gold_holdings', userId, async () => {
  const grams = 50;
  const buyPg = 5400_00;
  const nowPg = 7200_00;
  await sql`
    INSERT INTO gold_holdings
      (user_id, type, quantity, current_price, total_value,
       grams, purity, purchase_date, purchase_price_per_gram,
       current_rate_per_gram, total_investment, current_value,
       gain_loss, gain_loss_percent, notes)
    VALUES (${userId}, 'SGB', ${grams}, ${nowPg}, ${grams * nowPg},
            ${grams}, '999', ${monthsAgoIso(24)}, ${buyPg},
            ${nowPg}, ${grams * buyPg}, ${grams * nowPg},
            ${grams * (nowPg - buyPg)}, ${33.33}, 'SGB 2024-25 Series')
  `;
});

// ─── nps_accounts ──────────────────────────────────────────────────
await guardSection('nps_accounts', 'nps_accounts', userId, async () => {
  await sql`
    INSERT INTO nps_accounts (user_id, account_number, account_holder, pan, tier, status, equity_fund_value, debt_fund_value, alternative_fund_value, total_value, total_contributed, employer_contribution, gain_loss, opening_date)
    VALUES (${userId}, ${`PRAN${userId.slice(0,4).toUpperCase()}DEMO`.substring(0,15)}, 'Demo User', 'DEMOX9999X', 'TIER1', 'ACTIVE', ${lakh(4.5)}, ${lakh(2.5)}, ${lakh(0.5)}, ${lakh(7.5)}, ${lakh(6.0)}, ${lakh(1.0)}, ${lakh(1.5)}, ${monthsAgoIso(60)})
  `;
});

// ─── provident_fund ────────────────────────────────────────────────
await guardSection('provident_fund', 'provident_fund', userId, async () => {
  await sql`
    INSERT INTO provident_fund (user_id, account_type, account_holder, employee_balance, employer_balance, interest_balance, total_balance, total_contributed, interest_earned, opening_date, is_active)
    VALUES (${userId}, 'EPF', 'Demo User', ${lakh(8.0)}, ${lakh(8.0)}, ${lakh(2.5)}, ${lakh(18.5)}, ${lakh(16.0)}, ${lakh(2.5)}, ${monthsAgoIso(72)}, true)
  `;
});

// ─── real_estate ───────────────────────────────────────────────────
await guardSection('real_estate', 'real_estate', userId, async () => {
  const buy = cr(0.85);
  const now = cr(1.20);
  const gain = now - buy;
  const gainPct = (gain / buy) * 100;
  await sql`
    INSERT INTO real_estate
      (user_id, property_name, type, status, address, city, state,
       area, area_unit, purchase_price, purchase_date, current_valuation,
       valuation_date, gain_loss, gain_loss_percent,
       monthly_rent)
    VALUES (${userId}, 'Demo Residential Flat', 'RESIDENTIAL', 'OWNED',
            'Velachery, Off Tambaram Main Road', 'Chennai', 'Tamil Nadu',
            ${1200}, 'sqft', ${buy}, ${monthsAgoIso(48)}, ${now},
            ${today}, ${gain}, ${gainPct}, ${25000_00})
  `;
});

// ─── insurance_policies (life only — health goes in its own table below) ──
await guardSection('insurance_policies', 'insurance_policies', userId, async () => {
  await sql`
    INSERT INTO insurance_policies (user_id, policy_number, policy_type, status, policy_holder, insurer, sum_assured, premium_amount, premium_frequency, policy_start_date, policy_term, premium_payment_term, next_premium_due_date)
    VALUES (${userId}, ${`DEMO-TERM-${userId.slice(0,4).toUpperCase()}`}, 'TERM_LIFE', 'ACTIVE', 'Demo User', 'Demo Life Insurance Co', ${cr(1.5)}, ${12000_00}, 'ANNUAL', ${monthsAgoIso(36)}, 30, 30, ${monthsAheadIso(8)})
  `;
});

// ─── health_insurance_policies + cards ─────────────────────────────
await guardSection('health_insurance_policies', 'health_insurance_policies', userId, async () => {
  const inserted = await sql`
    INSERT INTO health_insurance_policies
      (user_id, insurer, policy_number, policy_type, status, policy_holder,
       sum_insured_paisa, premium_paisa, premium_frequency,
       start_date, renewal_date, waiting_period_months, served_waiting_months,
       cashless_available, network_hospital_count)
    VALUES (${userId}, 'Demo Health Insurance Co',
            ${`DEMO-HEALTH-${userId.slice(0,4).toUpperCase()}`},
            'FAMILY_FLOATER', 'ACTIVE', 'Demo User',
            ${lakh(15)}, ${18500_00}, 'ANNUAL',
            ${monthsAgoIso(12)}, ${monthsAheadIso(11)}, 48, 12,
            true, 8500)
    RETURNING id
  `;
  const policyId = inserted[0].id;

  // Family floater = three cards.
  await sql`INSERT INTO health_insurance_cards (user_id, policy_id, member_name, member_id, relationship, date_of_birth, gender) VALUES (${userId}, ${policyId}, 'Demo User',          ${`MEM-${policyId}-001`}, 'SELF',     '1988-04-12', 'M')`;
  await sql`INSERT INTO health_insurance_cards (user_id, policy_id, member_name, member_id, relationship, date_of_birth, gender) VALUES (${userId}, ${policyId}, 'Demo User Spouse',   ${`MEM-${policyId}-002`}, 'SPOUSE',   '1990-08-22', 'F')`;
  await sql`INSERT INTO health_insurance_cards (user_id, policy_id, member_name, member_id, relationship, date_of_birth, gender) VALUES (${userId}, ${policyId}, 'Demo User Daughter', ${`MEM-${policyId}-003`}, 'DAUGHTER', '2018-03-05', 'F')`;
});

// ─── vehicles + insurance + PUC + service ──────────────────────────
await guardSection('vehicles', 'vehicles', userId, async () => {
  const ins = await sql`
    INSERT INTO vehicles
      (user_id, registration_number, make, model, variant, year,
       fuel_type, transmission, color, body_type,
       purchase_date, purchase_price_paisa, current_idv_paisa,
       odometer_km, status)
    VALUES (${userId}, 'KA01DM2024', 'Maruti Suzuki', 'Swift', 'VXi',
            2022, 'PETROL', 'MANUAL', 'Silver', 'HATCHBACK',
            ${monthsAgoIso(36)}, ${lakh(7.5)}, ${lakh(5.5)},
            42000, 'ACTIVE')
    RETURNING id
  `;
  const vehicleId = ins[0].id;

  // Insurance — renewal in 60 days to trigger demo alerts later.
  // Explicit ::bigint casts because postgres-js's single-shot query mode
  // doesn't always let Postgres infer the param type from the target
  // column (especially with many bigint params in one VALUES list).
  const policyNumber = `DEMO-VEH-${vehicleId}`;
  await sql`
    INSERT INTO vehicle_insurance_policies
      (user_id, vehicle_id, insurer, policy_number, insurance_type,
       idv_paisa, premium_paisa, own_damage_premium_paisa,
       third_party_premium_paisa, ncb_percent, addons,
       premium_frequency, start_date, renewal_date,
       claims_made_count, status)
    VALUES (${userId}, ${vehicleId}, 'Demo General Insurance Co',
            ${policyNumber}, 'COMPREHENSIVE',
            ${lakh(5.5)}::bigint, ${14500_00}::bigint, ${9200_00}::bigint,
            ${3100_00}::bigint, 25, ${'["ZERO_DEP","ENGINE_PROTECT","RSA"]'},
            'ANNUAL', ${monthsAgoIso(10)}, ${monthsAheadIso(2)},
            0, 'ACTIVE')
  `;

  // PUC — valid for ~45 days from today
  const pucNumber = `PUC-${vehicleId}-${monthsAgoIso(2).replace(/-/g, '')}`;
  await sql`
    INSERT INTO vehicle_puc
      (user_id, vehicle_id, certificate_number, issued_date,
       valid_until, issuing_authority, cost_paisa)
    VALUES (${userId}, ${vehicleId},
            ${pucNumber},
            ${monthsAgoIso(2)}, ${daysAgoIso(-45)},
            'Demo Petrol Pump Authorised PUC Center', ${100_00}::bigint)
  `;

  // Service log — two entries
  await sql`
    INSERT INTO vehicle_service_log
      (user_id, vehicle_id, service_date, odometer_km, service_type,
       garage_name, cost_paisa, description, next_service_due_date,
       next_service_due_km)
    VALUES
      (${userId}, ${vehicleId}, ${monthsAgoIso(12)}, 30000, 'REGULAR',
       'Demo Maruti Authorised Service', ${5500_00}::bigint,
       '20,000 km service — oil, filter, brake check',
       ${monthsAgoIso(0)}, 40000)
  `;
  await sql`
    INSERT INTO vehicle_service_log
      (user_id, vehicle_id, service_date, odometer_km, service_type,
       garage_name, cost_paisa, description, next_service_due_date,
       next_service_due_km)
    VALUES (${userId}, ${vehicleId}, ${monthsAgoIso(3)}, 38500, 'REGULAR',
       'Demo Maruti Authorised Service', ${4800_00}::bigint,
       '40,000 km service — oil, filter, tyre rotation',
       ${monthsAheadIso(9)}, 50000)
  `;
});

// ─── liabilities ───────────────────────────────────────────────────
await guardSection('liabilities', 'liabilities', userId, async () => {
  // Home loan
  await sql`
    INSERT INTO liabilities
      (user_id, name, type, status, creditor_name,
       original_amount, current_balance, interest_rate, monthly_emi,
       start_date, remaining_tenor, next_payment_date)
    VALUES (${userId}, 'Home Loan', 'HOME_LOAN', 'ACTIVE',
            'Demo Housing Finance Ltd',
            ${cr(0.7)}, ${cr(0.45)}, ${8.5}, ${52000_00},
            ${monthsAgoIso(36)}, 204, ${monthsAheadIso(1)})
  `;
  // Credit card — original_amount/interest_rate/monthly_emi NOT NULL
  // even for CC; use representative values (statement, APR, min-due).
  await sql`
    INSERT INTO liabilities
      (user_id, name, type, status, creditor_name,
       original_amount, current_balance, interest_rate, monthly_emi,
       start_date, next_payment_date)
    VALUES (${userId}, 'Demo Credit Card', 'CREDIT_CARD', 'ACTIVE',
            'Demo Bank',
            ${45000_00}, ${45000_00}, ${42.0}, ${5000_00},
            ${monthsAgoIso(12)}, ${monthsAheadIso(0)})
  `;
});

// ─── chit_funds + installments ─────────────────────────────────────
await guardSection('chit_funds', 'chit_funds', userId, async () => {
  await sql`
    INSERT INTO chit_funds
      (user_id, scheme_name, foreman_name, status, chit_value,
       monthly_installment, duration_months, group_size,
       start_date, expected_end_date, win_month, total_paid,
       total_dividends, net_contribution, next_due_date,
       installments_paid, document_charges_paisa)
    VALUES (${userId}, 'Demo Chit 5L/24', 'Demo Foreman & Co', 'ACTIVE',
            ${lakh(5)}, ${25000_00}, 24, 20,
            ${monthsAgoIso(8)}, ${monthsAheadIso(16)}, NULL,
            ${lakh(2.0)}, ${10000_00}, ${lakh(1.9)},
            ${monthsAheadIso(1)}, 8, 0)
  `;
});

// ─── fixed_deposits ────────────────────────────────────────────────
await guardSection('fixed_deposits', 'fixed_deposits', userId, async () => {
  await sql`
    INSERT INTO fixed_deposits
      (user_id, bank_name, account_number, principal_paisa, interest_rate,
       start_date, maturity_date, tenure_months, status,
       maturity_amount_paisa, compounding_freq)
    VALUES (${userId}, 'Demo Bank', ${`FD${userId.slice(0,6).toUpperCase()}`},
            ${lakh(3)}, ${7.25}, ${monthsAgoIso(6)}, ${monthsAheadIso(18)},
            24, 'ACTIVE', ${lakh(3.45)}, 'QUARTERLY')
  `;
});

// ─── budget_categories + entries ───────────────────────────────────
await guardSection('budget', 'budget_categories', userId, async () => {
  const period = currentPeriod();
  const cats = [
    { name: 'Rent',        planned: 35000_00, actual: 35000_00 },
    { name: 'Groceries',   planned: 12000_00, actual:  8400_00 },
    { name: 'Utilities',   planned:  4500_00, actual:  4200_00 },
    { name: 'Transport',   planned:  6000_00, actual:  3100_00 },
    { name: 'SIP',         planned: 15000_00, actual: 15000_00 },
    { name: 'Chit',        planned: 25000_00, actual: 25000_00 },
    { name: 'Misc',        planned:  5000_00, actual:  1200_00 },
  ];
  for (let i = 0; i < cats.length; i++) {
    const c = cats[i];
    const ins = await sql`
      INSERT INTO budget_categories (user_id, name, type, sort_order, is_active)
      VALUES (${userId}, ${c.name}, 'EXPENSE', ${i + 1}, true)
      RETURNING id
    `;
    await sql`
      INSERT INTO budget_entries (user_id, category_id, period, planned_amount, actual_amount)
      VALUES (${userId}, ${ins[0].id}, ${period}, ${c.planned}, ${c.actual})
    `;
  }
});

// ─── financial_goals ───────────────────────────────────────────────
await guardSection('financial_goals', 'financial_goals', userId, async () => {
  await sql`
    INSERT INTO financial_goals (user_id, name, target_amount, target_date, current_amount, color, is_active)
    VALUES (${userId}, 'Vacation Europe', ${lakh(8)}, ${monthsAheadIso(18)}, ${lakh(2.5)}, '#3b82f6', true)
  `;
  await sql`
    INSERT INTO financial_goals (user_id, name, target_amount, target_date, current_amount, color, is_active)
    VALUES (${userId}, 'Daughter College Fund', ${cr(0.35)}, ${monthsAheadIso(180)}, ${lakh(8)}, '#10b981', true)
  `;
});

// ─── salary_income ─────────────────────────────────────────────────
await guardSection('salary_income', 'salary_income', userId, async () => {
  // Sprint 3 Phase 2 — seed a Form-16-shaped salary row so /income has
  // something to aggregate.
  await sql`
    INSERT INTO salary_income
      (user_id, financial_year, employer_name, employer_tan,
       gross_salary_paisa, exemptions_paisa, section16_paisa,
       taxable_salary_paisa, tds_paisa)
    VALUES (${userId}, ${fyNow}, 'Demo Tech Pvt Ltd', 'MUMA12345E',
            ${lakh(24)}, ${lakh(0.6)}, ${50000_00},
            ${lakh(22.9)}, ${lakh(2.8)})
  `;
});

// ─── other_sources_income ──────────────────────────────────────────
await guardSection('other_sources_income', 'other_sources_income', userId, async () => {
  // Interest from FDs (taxable)
  await sql`
    INSERT INTO other_sources_income
      (user_id, financial_year, source, description, amount_paisa,
       is_tax_exempt, tax_section)
    VALUES (${userId}, ${fyNow}, 'FD_INTEREST',
            'Demo Bank FD interest', ${21750_00},
            false, NULL)
  `;
  // Dividend (taxable)
  await sql`
    INSERT INTO other_sources_income
      (user_id, financial_year, source, description, amount_paisa,
       is_tax_exempt, tax_section)
    VALUES (${userId}, ${fyNow}, 'DIVIDEND',
            'Mutual fund + stock dividends', ${15400_00},
            false, NULL)
  `;
  // Agricultural (exempt) — demonstrates tax-exempt classification
  await sql`
    INSERT INTO other_sources_income
      (user_id, financial_year, source, description, amount_paisa,
       is_tax_exempt, tax_section)
    VALUES (${userId}, ${fyNow}, 'AGRICULTURAL',
            'Family farm — rice + coconut', ${lakh(1.2)},
            true, 'Section 10(1)')
  `;
});

// ─── tax_deductions ────────────────────────────────────────────────
await guardSection('tax_deductions', 'tax_deductions', userId, async () => {
  await sql`
    INSERT INTO tax_deductions
      (user_id, financial_year, section, description,
       deductible_amount, available_limit, utilizable_amount,
       claimed, claimed_amount)
    VALUES (${userId}, ${fyNow}, '80C',
            ${`EPF contribution (FY ${fyNow})`},
            ${120000_00}, ${150000_00}, ${30000_00},
            ${true}, ${120000_00})
  `;
});

// ─── retirement_assumptions ────────────────────────────────────────
await guardSection('retirement_assumptions', 'retirement_assumptions', userId, async () => {
  await sql`
    INSERT INTO retirement_assumptions
      (user_id, current_age, target_age, monthly_expense_rupees,
       inflation_pct, expected_return_pct, post_retirement_return_pct,
       retirement_duration_years)
    VALUES (${userId}, 38, 60, 80000, 6, 12, 7, 30)
  `;
});

// ─── alert_rules ───────────────────────────────────────────────────
await guardSection('alert_rules', 'alert_rules', userId, async () => {
  await sql`INSERT INTO alert_rules (user_id, name, category, rule_type, symbol, threshold, cooldown_hours, is_enabled) VALUES (${userId}, 'Nifty 50 ±2% intraday', 'MARKET', 'INDEX_CHANGE', '^NSEI', 2, 6, true)`;
  await sql`INSERT INTO alert_rules (user_id, name, category, rule_type, threshold, cooldown_hours, is_enabled) VALUES (${userId}, 'Credit card due in 5 days', 'PAYMENT', 'CREDIT_CARD_DUE', 5, 24, true)`;
  await sql`INSERT INTO alert_rules (user_id, name, category, rule_type, threshold, cooldown_hours, is_enabled) VALUES (${userId}, 'Insurance premium due in 30 days', 'PAYMENT', 'INSURANCE_DUE', 30, 168, true)`;
});

// ─── price_snapshots (30 days of net-worth history) ───────────────
await guardSection('price_snapshots', 'price_snapshots', userId, async () => {
  // Sum of asset values for the baseline. Real number from the inserts above.
  const baseline = lakh(8) /* stocks */ + lakh(3.3) /* MFs */ + lakh(3.6) /* gold */
                 + lakh(7.5) /* NPS */ + lakh(18.5) /* PF */ + cr(1.2) /* RE */
                 + lakh(1.9) /* chit */ + lakh(3) /* FD */
                 - cr(0.45) /* home loan */ - lakh(0.45) /* CC */;
  for (let day = 30; day >= 0; day--) {
    // Drift gently from -3% to +0% over 30 days.
    const drift = 1 + ((30 - day) / 30) * 0.03 - 0.03;
    const total = Math.round(baseline * drift);
    const date = daysAgoIso(day);
    // One row per asset class total + one for NET_WORTH. Keep it
    // simple — just NET_WORTH + STOCKS_TOTAL + MF_TOTAL is enough for
    // the dashboard's history charts.
    await sql`INSERT INTO price_snapshots (user_id, asset_type, asset_symbol, asset_name, price, price_date, source) VALUES (${userId}, 'NETWORTH', 'NET_WORTH', 'Net Worth', ${total}, ${date}, 'NETWORTH_SNAPSHOT')`;
  }
});

// ─── scheduled_jobs (cron seed) ────────────────────────────────────
await guardSection('scheduled_jobs', 'scheduled_jobs', userId, async () => {
  for (const job of ['daily_digest', 'alerts_check', 'sip_auto_execute']) {
    await sql`INSERT INTO scheduled_jobs (user_id, job_type, enabled, next_run_at) VALUES (${userId}, ${job}, true, NOW())`;
  }
});

// ─── summary ───────────────────────────────────────────────────────
console.log(`\nSeed complete for ${OWNER_EMAIL} (user.id=${userId}).`);
console.log(`  Sections seeded: ${sectionsRun.length} — ${sectionsRun.join(', ')}`);
if (sectionsSkipped.length) {
  console.log(`  Sections skipped (already populated): ${sectionsSkipped.join(', ')}`);
}
console.log(`\nTo see this dashboard, sign in via /login with ${OWNER_EMAIL}.`);

await sql.end();
