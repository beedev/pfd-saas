/**
 * ITR-1 (Sahaj) summary API — Sprint 4.1.
 *
 * GET /api/tax/itr1/summary?fy=2025-26
 *
 * Aggregates the user's salary_income + first real_estate row +
 * interest-flavoured other_sources_income rows + section-80
 * tax_deductions and hands them to `computeItr1Summary()`.
 *
 * Regime selection: reads user_preferences.tax_regime_default;
 * defaults to NEW (govt default).
 *
 * ITR-1 only allows ONE house property — we take the first row
 * from real_estate ordered by id. The wizard already filters users
 * with multiple properties into ITR-2; this endpoint stays
 * deterministic if data drifts.
 *
 * Returns a flat JSON shape suitable for the /tax/itr1 page to
 * render block-by-block without further computation. `exceedsCap`
 * surfaces the "switch to ITR-2" banner.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';
import {
  db,
  salaryIncome,
  realEstate,
  otherSourcesIncome,
  taxDeductions,
  taxSlabs,
  taxRegimeConfig,
  userPreferences,
  type TaxRegime,
  type OtherIncomeSource,
} from '@/db';
import { auth } from '@/auth';
import { computeItr1Summary } from '@/lib/finance/itr1-summary';

/** Sources that count as "interest-like" income for ITR-1's
 *  Schedule OS line. Excludes business / freelance / agricultural
 *  buckets (those push the filer into ITR-2/3). */
const ITR1_OTHER_SOURCES: OtherIncomeSource[] = [
  'BANK_INTEREST',
  'FD_INTEREST',
  'PF_INTEREST',
  'DIVIDEND',
];

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
      properties,
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
        .from(realEstate)
        .where(eq(realEstate.userId, userId))
        .orderBy(asc(realEstate.id))
        .limit(1),
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

    // ITR-1 single property — derive 24(b) interest from tax_deductions
    // section '24B' for the FY (caller's accepted Section 24 cap).
    const interest24b = deductions
      .filter((d) => d.section === '24B')
      .reduce((s, d) => s + (d.amountPaisa ?? 0), 0);
    const property = properties[0] ?? null;
    const propertyInput = property
      ? {
          annualRentPaisa: (property.monthlyRent ?? 0) * 12,
          municipalTaxesPaisa: property.propertyTaxAnnual ?? 0,
          homeLoanInterestPaisa: interest24b,
        }
      : null;

    const otherInterest = otherRows
      .filter((r) => !r.isTaxExempt)
      .filter((r) => ITR1_OTHER_SOURCES.includes(r.source))
      .reduce((s, r) => s + (r.amountPaisa ?? 0), 0);

    // Section-80 deductions. NEW regime accepts very few — for now we
    // follow the same conservative posture as /api/tax/regime-compare:
    // NEW = 0 deductions, OLD = sum of all rows. The wider per-row
    // regime-eligibility refactor is on the Sprint 4 deferred list.
    const oldDeductionsTotal = deductions.reduce(
      (s, r) => s + (r.amountPaisa ?? 0),
      0,
    );
    const deductionsForRegime = regime === 'OLD' ? oldDeductionsTotal : 0;

    const summary = computeItr1Summary({
      salaryGrossPaisa: salaryGross,
      salaryExemptionsPaisa: salaryExemptions,
      property: propertyInput,
      otherInterestIncomePaisa: otherInterest,
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
        houseProperty: property
          ? {
              propertyName: property.propertyName,
              annualRentPaisa: (property.monthlyRent ?? 0) * 12,
              municipalTaxesPaisa: property.propertyTaxAnnual ?? 0,
              homeLoanInterestPaisa: interest24b,
              netIncomePaisa: summary.housePropertyIncomePaisa,
            }
          : null,
        otherSources: {
          rowCount: otherRows.length,
          taxableInterestPaisa: otherInterest,
        },
        deductions: {
          rowCount: deductions.length,
          oldRegimeTotalPaisa: oldDeductionsTotal,
          appliedPaisa: deductionsForRegime,
        },
      },
      summary,
    });
  } catch (err) {
    console.error('[tax/itr1/summary GET]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
