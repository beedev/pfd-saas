/**
 * ITR-4 (Sugam) summary API — Sprint 4.1.
 *
 * GET /api/tax/itr4/summary?fy=2025-26
 *
 * Salary + presumptive-income (44AD / 44ADA / 44AE) + other sources.
 * Pulls:
 *   • salary_income (sum across employers)
 *   • presumptive_income for the FY
 *   • non-exempt other_sources_income
 *   • tax_deductions for the section-80 total
 *
 * Note: 44AB(e) audit-trigger validation is already enforced in the
 * presumptive POST/PATCH routes — by the time rows reach this
 * endpoint they're either compliant or were created before that rule
 * existed. We still surface `belowMinimum`/`exceedsCap` flags in the
 * summary so the UI can re-validate visually.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import {
  db,
  salaryIncome,
  otherSourcesIncome,
  presumptiveIncome,
  taxDeductions,
  taxSlabs,
  taxRegimeConfig,
  userPreferences,
  type TaxRegime,
  type PresumptiveSection,
  type ReceiptMode,
} from '@/db';
import { auth } from '@/auth';
import { computeItr4Summary } from '@/lib/finance/itr4-summary';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  try {
    const fy = new URL(request.url).searchParams.get('fy');
    if (!fy) return NextResponse.json({ error: 'fy required' }, { status: 400 });
    const userId = session.user.id;

    const [
      salaries,
      presumptiveRows,
      otherRows,
      deductions,
      slabs,
      configs,
      prefs,
    ] = await Promise.all([
      db
        .select()
        .from(salaryIncome)
        .where(
          and(eq(salaryIncome.userId, userId), eq(salaryIncome.financialYear, fy)),
        ),
      db
        .select()
        .from(presumptiveIncome)
        .where(
          and(eq(presumptiveIncome.userId, userId), eq(presumptiveIncome.fy, fy)),
        ),
      db
        .select()
        .from(otherSourcesIncome)
        .where(
          and(
            eq(otherSourcesIncome.userId, userId),
            eq(otherSourcesIncome.financialYear, fy),
          ),
        ),
      db
        .select()
        .from(taxDeductions)
        .where(
          and(
            eq(taxDeductions.userId, userId),
            eq(taxDeductions.financialYear, fy),
          ),
        ),
      db.select().from(taxSlabs).where(eq(taxSlabs.fy, fy)),
      db.select().from(taxRegimeConfig).where(eq(taxRegimeConfig.fy, fy)),
      db
        .select()
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId))
        .limit(1),
    ]);

    if (slabs.length === 0 || configs.length === 0) {
      return NextResponse.json(
        { error: `Tax slabs for FY ${fy} not seeded yet` },
        { status: 422 },
      );
    }

    const regime: TaxRegime = (prefs[0]?.taxRegimeDefault as TaxRegime) ?? 'NEW';
    const regimeSlabs = slabs.filter((s) => s.regime === regime);
    const regimeConfig = configs.find((c) => c.regime === regime);
    if (!regimeConfig || regimeSlabs.length === 0) {
      return NextResponse.json(
        { error: `Slabs/config missing for regime ${regime} in FY ${fy}` },
        { status: 422 },
      );
    }

    const salaryGross = salaries.reduce(
      (s, r) => s + (r.grossSalaryPaisa ?? 0),
      0,
    );
    const salaryExemptions = salaries.reduce(
      (s, r) => s + (r.exemptionsPaisa ?? 0),
      0,
    );
    const salaryTds = salaries.reduce((s, r) => s + (r.tdsPaisa ?? 0), 0);

    const otherIncome = otherRows
      .filter((r) => !r.isTaxExempt)
      .reduce((s, r) => s + (r.amountPaisa ?? 0), 0);

    const oldDeductionsTotal = deductions.reduce(
      (s, r) => s + (r.amountPaisa ?? 0),
      0,
    );
    const deductionsForRegime = regime === 'OLD' ? oldDeductionsTotal : 0;

    const summary = computeItr4Summary({
      salaryGrossPaisa: salaryGross,
      salaryExemptionsPaisa: salaryExemptions,
      presumptiveLines: presumptiveRows.map((r) => ({
        section: r.section as PresumptiveSection,
        grossReceiptsPaisa: r.grossReceiptsPaisa,
        receiptMode: (r.receiptMode ?? 'DIGITAL') as ReceiptMode,
        declaredProfitPaisa: r.declaredProfitPaisa,
      })),
      otherIncomePaisa: otherIncome,
      deductionsPaisa: deductionsForRegime,
      slabs: regimeSlabs.map((s) => ({
        slabOrder: s.slabOrder,
        lowerPaisa: s.lowerPaisa,
        upperPaisa: s.upperPaisa ?? null,
        ratePct: s.ratePct,
      })),
      config: {
        standardDeductionPaisa: regimeConfig.standardDeductionPaisa,
        rebate87aThresholdPaisa: regimeConfig.rebate87aThresholdPaisa,
        rebate87aMaxPaisa: regimeConfig.rebate87aMaxPaisa,
        cessPct: regimeConfig.cessPct,
      },
      regime,
    });

    return NextResponse.json({
      fy,
      regime,
      blocks: {
        salary: {
          employerCount: salaries.length,
          grossPaisa: salaryGross,
          exemptionsPaisa: salaryExemptions,
          taxableSalaryPaisa: salaryGross - salaryExemptions,
          tdsPaisa: salaryTds,
        },
        presumptive: {
          rows: presumptiveRows.map((r, idx) => ({
            id: r.id,
            section: r.section,
            businessName: r.businessName,
            natureOfBusiness: r.natureOfBusiness,
            grossReceiptsPaisa: r.grossReceiptsPaisa,
            receiptMode: r.receiptMode ?? 'DIGITAL',
            deemedProfitPct: r.deemedProfitPct,
            declaredProfitPaisa: r.declaredProfitPaisa,
            // Mirror the per-line evaluation result for the UI.
            minimumProfitPaisa: summary.presumptiveLines[idx]?.minimumProfitPaisa ?? 0,
            belowMinimum: summary.presumptiveLines[idx]?.belowMinimum ?? false,
            exceedsCap: summary.presumptiveLines[idx]?.exceedsCap ?? false,
          })),
          totalDeclaredProfitPaisa: summary.totalPresumptiveProfitPaisa,
        },
        otherSources: {
          rowCount: otherRows.length,
          taxablePaisa: otherIncome,
        },
        deductions: {
          rowCount: deductions.length,
          oldRegimeTotalPaisa: oldDeductionsTotal,
          appliedPaisa: deductionsForRegime,
        },
      },
      summary: {
        ...summary,
        salaryTdsPaisa: salaryTds,
      },
    });
  } catch (err) {
    console.error('[tax/itr4/summary GET]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
