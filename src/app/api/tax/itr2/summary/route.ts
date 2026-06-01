/**
 * ITR-2 summary API — Sprint 4.1.
 *
 * GET /api/tax/itr2/summary?fy=2025-26
 *
 * Multi-house + capital-gains aware variant of /api/tax/itr1/summary.
 * Pulls:
 *   • salary_income (sum)
 *   • ALL real_estate rows (each becomes one Schedule HP row)
 *   • non-exempt other_sources_income (broader filter than ITR-1 —
 *     ITR-2 accepts business-flavoured "OTHER", just not the
 *     presumptive business sections)
 *   • capital_gains for the FY → Schedule CG
 *   • tax_deductions for the section-80 total
 *
 * Home-loan-interest cap allocation across multiple properties is
 * NOT modelled here — we apply the user's `24B` deductions row to
 * the FIRST property (self-occupied is the conventional choice).
 * Per-property interest can be elaborated if/when users complain.
 *
 * Cost-inflation-index lookup for LTCG-other → still flat 20%.
 * Deferred per CLAUDE.md "Deferred from Sprint 4.1".
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import {
  db,
  salaryIncome,
  realEstate,
  otherSourcesIncome,
  capitalGains,
  taxDeductions,
  taxSlabs,
  taxRegimeConfig,
  userPreferences,
  type TaxRegime,
} from '@/db';
import { auth } from '@/auth';
import { computeItr2Summary } from '@/lib/finance/itr2-summary';
import type { CapitalGainRow, CgAssetType, CgGainType } from '@/lib/finance/capital-gains-tax';

/** Map schema `assetType` codes to the lib's CgAssetType. The lib's
 *  type covers both names — STOCKS in DB maps to STOCKS in lib. */
function mapAssetType(t: string): CgAssetType {
  switch (t) {
    case 'STOCKS':
    case 'EQUITY_MF':
    case 'DEBT_MF':
    case 'GOLD':
    case 'REAL_ESTATE':
    case 'OTHER':
      return t as CgAssetType;
    default:
      return 'OTHER';
  }
}

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
      cgRows,
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
      db.select().from(realEstate).where(eq(realEstate.userId, userId)),
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
        .from(capitalGains)
        .where(
          and(
            eq(capitalGains.userId, userId),
            eq(capitalGains.financialYear, fy),
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

    const interest24b = deductions
      .filter((d) => d.section === '24B')
      .reduce((s, d) => s + (d.amountPaisa ?? 0), 0);

    // House properties — apply the 24B interest deduction to the first
    // property. Cleaner per-property allocation is a follow-up.
    const houseProperties = properties.map((p, idx) => ({
      label: p.propertyName,
      annualRentPaisa: (p.monthlyRent ?? 0) * 12,
      municipalTaxesPaisa: p.propertyTaxAnnual ?? 0,
      homeLoanInterestPaisa: idx === 0 ? interest24b : 0,
    }));

    const otherIncome = otherRows
      .filter((r) => !r.isTaxExempt)
      .reduce((s, r) => s + (r.amountPaisa ?? 0), 0);

    const capitalGainsRows: CapitalGainRow[] = cgRows.map((r) => ({
      assetType: mapAssetType(r.assetType),
      gainType: r.holdingPeriod as CgGainType,
      taxableGainPaisa: r.taxableGain,
      saleDate: r.saleDate, // Sprint 5.1c — drives pre/post-Jul-24 cutoff
    }));

    const oldDeductionsTotal = deductions.reduce(
      (s, r) => s + (r.amountPaisa ?? 0),
      0,
    );
    const deductionsForRegime = regime === 'OLD' ? oldDeductionsTotal : 0;

    const summary = computeItr2Summary({
      salaryGrossPaisa: salaryGross,
      salaryExemptionsPaisa: salaryExemptions,
      houseProperties,
      otherIncomePaisa: otherIncome,
      capitalGainsRows,
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
      fy,
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
        houseProperties: summary.housePropertyRows,
        otherSources: {
          rowCount: otherRows.length,
          taxablePaisa: otherIncome,
        },
        capitalGainsRows: cgRows.map((r) => ({
          id: r.id,
          assetType: r.assetType,
          assetName: r.assetName,
          saleDate: r.saleDate,
          taxableGainPaisa: r.taxableGain,
          holdingPeriod: r.holdingPeriod,
        })),
        deductions: {
          rowCount: deductions.length,
          oldRegimeTotalPaisa: oldDeductionsTotal,
          appliedPaisa: deductionsForRegime,
        },
      },
      summary,
    });
  } catch (err) {
    console.error('[tax/itr2/summary GET]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
