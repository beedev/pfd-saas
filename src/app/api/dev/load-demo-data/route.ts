/**
 * POST /api/dev/load-demo-data
 *
 * Pre-populates the authenticated user's account with a small, realistic
 * portfolio so testers can explore every screen without registering real
 * data first. Scoped to the calling user — never touches another tenant.
 *
 * Sprint 6.1.6 — MINIMAL version. The full BXDEva seed
 * (scripts/seed-demo-bxdeva.mjs) covers 23 tables; this route seeds only
 * the high-signal subset:
 *   - salary income (FY 2025-26)
 *   - 4 tax deductions (80C / 80D / 80CCD_1B / 80G)
 *   - 2 stock holdings (RELIANCE, TCS)
 *   - 1 mutual fund position
 *   - 1 life insurance policy
 *   - 1 home loan liability
 *
 * Rationale: these are the screens reviewers most often want to see live
 * data on. Forex, chit funds, NPS, gold etc. can be deferred — they
 * render an empty-state hint that's clearly labelled.
 *
 * Every inserted row carries `notes` prefixed with 'DEMO-SEED:' so the
 * companion wipe endpoint can clean up idempotently.
 *
 * Idempotent: re-running deletes prior DEMO-SEED rows for this user
 * before inserting.
 */

import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db, holdings, mutualFunds, salaryIncome, taxDeductions, insurancePolicies, liabilities } from '@/db';
import { auth } from '@/auth';

// ─── helpers ─────────────────────────────────────────────────────────
const rs = (rupees: number) => Math.round(rupees * 100); // ₹ → paisa
const lakh = (n: number) => Math.round(n * 100_000 * 100);
const NOTE = (bucket: string) => `DEMO-SEED: minimal — ${bucket}`;
const FY = '2025-26';

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  const userId = session.user.id;

  try {
    // ─── idempotency: clean prior DEMO-SEED rows for this user ────────
    await db.execute(sql`DELETE FROM holdings WHERE user_id = ${userId} AND notes LIKE 'DEMO-SEED:%'`);
    await db.execute(sql`DELETE FROM mutual_funds WHERE user_id = ${userId} AND notes LIKE 'DEMO-SEED:%'`);
    await db.execute(sql`DELETE FROM salary_income WHERE user_id = ${userId} AND notes LIKE 'DEMO-SEED:%'`);
    await db.execute(sql`DELETE FROM tax_deductions WHERE user_id = ${userId} AND notes LIKE 'DEMO-SEED:%'`);
    await db.execute(sql`DELETE FROM insurance_policies WHERE user_id = ${userId} AND notes LIKE 'DEMO-SEED:%'`);
    await db.execute(sql`DELETE FROM liabilities WHERE user_id = ${userId} AND notes LIKE 'DEMO-SEED:%'`);

    const inserted: Record<string, number> = {};

    // ─── salary ───────────────────────────────────────────────────────
    // ₹24L gross, with HRA and standard exemptions, ₹3L TDS already
    // deducted by employer. Realistic mid-career IT salary for FY 2025-26.
    await db.insert(salaryIncome).values({
      userId,
      financialYear: FY,
      employerName: 'Demo Tech Solutions Pvt Ltd',
      employerTan: 'BLRX12345D',
      grossSalaryPaisa: lakh(24),
      basicPaisa: lakh(12),
      hraReceivedPaisa: lakh(4.8),
      ltaPaisa: lakh(0.6),
      conveyancePaisa: lakh(0.36),
      otherAllowancesPaisa: lakh(6.24),
      exemptionsPaisa: lakh(2.4), // HRA + LTA exemptions
      section16Paisa: rs(75_000), // standard deduction (FY 25-26 new regime ₹75k)
      taxableSalaryPaisa: lakh(20.85),
      tdsPaisa: lakh(3),
      rentPaidMonthlyPaisa: rs(35_000),
      notes: NOTE('salary'),
    });
    inserted.salary_income = 1;

    // ─── tax deductions (80C + 80D + 80CCD_1B + 80G) ──────────────────
    const deductions = [
      {
        section: '80C',
        description: 'PPF + ELSS + life insurance premium',
        amountPaisa: lakh(1.5),
        availableLimit: lakh(1.5),
      },
      {
        section: '80D',
        description: 'Health insurance — self + family',
        amountPaisa: rs(25_000),
        availableLimit: rs(25_000),
        eightyDBucket: 'SELF_FAMILY',
      },
      {
        section: '80CCD_1B',
        description: 'NPS Tier-I additional contribution',
        amountPaisa: rs(50_000),
        availableLimit: rs(50_000),
      },
      {
        section: '80G',
        description: 'Donation — registered charity',
        amountPaisa: rs(10_000),
        availableLimit: 0,
        eightyGCategory: '50_NO_LIMIT',
      },
    ];
    for (const d of deductions) {
      await db.insert(taxDeductions).values({
        userId,
        financialYear: FY,
        section: d.section,
        description: d.description,
        amountPaisa: d.amountPaisa,
        deductibleAmount: d.amountPaisa,
        utilizableAmount: d.amountPaisa,
        availableLimit: d.availableLimit,
        incurredDate: '2025-06-15',
        claimed: true,
        claimedAmount: d.amountPaisa,
        claimedInYear: FY,
        eightyDBucket: d.eightyDBucket,
        eightyGCategory: d.eightyGCategory,
        notes: NOTE(d.section),
      });
    }
    inserted.tax_deductions = deductions.length;

    // ─── stocks ───────────────────────────────────────────────────────
    const stockRows = [
      { symbol: 'RELIANCE.NS', qty: 25, avg: 2400, cur: 2820 },
      { symbol: 'TCS.NS', qty: 10, avg: 3500, cur: 3920 },
    ];
    for (const s of stockRows) {
      const totalInv = rs(s.qty * s.avg);
      const curVal = rs(s.qty * s.cur);
      await db.insert(holdings).values({
        userId,
        symbol: s.symbol,
        quantity: s.qty,
        averagePrice: rs(s.avg),
        currentPrice: rs(s.cur),
        purchaseDate: '2023-04-10',
        totalInvestment: totalInv,
        currentValue: curVal,
        gainLoss: curVal - totalInv,
        gainLossPercent: ((curVal - totalInv) / totalInv) * 100,
        notes: NOTE('stock-' + s.symbol),
      });
    }
    inserted.holdings = stockRows.length;

    // ─── mutual fund (1 position) ─────────────────────────────────────
    {
      const units = 1450.327;
      const nav = rs(95.42);
      const totalInv = rs(120_000);
      const curVal = Math.round(units * nav);
      await db.insert(mutualFunds).values({
        userId,
        isin: 'INF200K01QX4',
        schemeName: 'Demo Bluechip Fund — Direct Growth',
        fundType: 'EQUITY',
        category: 'EQUITY',
        folioNumber: '1234567/00',
        units,
        nav,
        totalInvestment: totalInv,
        currentValue: curVal,
        gainLoss: curVal - totalInv,
        gainLossPercent: ((curVal - totalInv) / totalInv) * 100,
        lastNavDate: '2025-12-01',
        investmentStartDate: '2022-01-15',
        notes: NOTE('mf-bluechip'),
      });
      inserted.mutual_funds = 1;
    }

    // ─── insurance (1 term policy) ────────────────────────────────────
    await db.insert(insurancePolicies).values({
      userId,
      policyNumber: 'DEMO-TERM-001',
      policyHolder: 'Demo User',
      insurer: 'Demo Life Insurance Co.',
      policyType: 'TERM_LIFE',
      sumAssured: lakh(100), // ₹1 crore
      premiumAmount: rs(18_000),
      premiumFrequency: 'YEARLY',
      policyStartDate: '2022-08-15',
      maturityDate: '2052-08-15',
      nextPremiumDueDate: '2026-08-15',
      notes: NOTE('insurance-term'),
    });
    inserted.insurance_policies = 1;

    // ─── liability (1 home loan) ──────────────────────────────────────
    await db.insert(liabilities).values({
      userId,
      name: 'Demo Home Loan — HDFC',
      type: 'HOME_LOAN',
      creditorName: 'HDFC Bank',
      originalAmount: lakh(60),
      currentBalance: lakh(48),
      interestRate: 8.6,
      monthlyEmi: rs(52_000),
      startDate: '2022-03-01',
      remainingTenor: 144,
      nextPaymentDate: '2026-07-05',
      principalQualifies80c: true,
      interestQualifies24b: true,
      notes: NOTE('liability-home'),
    });
    inserted.liabilities = 1;

    return NextResponse.json({
      ok: true,
      inserted,
      note: 'Demo data loaded. Use POST /api/dev/wipe-demo-data to remove.',
    });
  } catch (err) {
    console.error('[load-demo-data] failed:', err);
    return NextResponse.json(
      {
        error: 'load_failed',
        detail: err instanceof Error ? err.message : 'unknown',
      },
      { status: 500 },
    );
  }
}
