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
import { and, eq, gte, lte } from 'drizzle-orm';
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
  invoices,
  itrFormSelection,
  liabilities,
  type TaxRegime,
} from '@/db';
import { auth } from '@/auth';
import { computeItr2Summary } from '@/lib/finance/itr2-summary';
import { aggregateLoanTaxDeductions } from '@/lib/finance/loan-tax';
import { financialYearBoundsIso } from '@/lib/finance/tax-constants';
import { resolveSalaryIncome, resolveSalaryTds } from '@/lib/finance/form16-tax-source';
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

    const { start: fyStart, end: fyEnd } = financialYearBoundsIso(fy);

    const [
      salaries,
      properties,
      otherRows,
      cgRows,
      deductions,
      slabs,
      configs,
      prefs,
      fyInvoices,
      wizardSelection,
      loanRows,
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
      // Sprint 5.4 — business-income detection (ITR-2's only ineligibility)
      db
        .select({
          taxableAmount: invoices.taxableAmount,
        })
        .from(invoices)
        .where(
          and(
            eq(invoices.userId, userId),
            gte(invoices.invoiceDate, fyStart),
            lte(invoices.invoiceDate, fyEnd),
          ),
        ),
      // Sprint 5.4 — wizard recommendation
      db
        .select()
        .from(itrFormSelection)
        .where(
          and(eq(itrFormSelection.userId, userId), eq(itrFormSelection.fy, fy)),
        )
        .limit(1),
      // Sprint 5.9c — loans for 80C principal + 24(b) interest
      db.select().from(liabilities).where(eq(liabilities.userId, userId)),
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

    // Form-16-authoritative salary gross + TDS (resolver). Falls back to
    // salary_income books when no Part-B / Part-A Form 16 exists for the FY.
    const [salaryResolved, salaryTdsResolved] = await Promise.all([
      resolveSalaryIncome(userId, fy),
      resolveSalaryTds(userId, fy),
    ]);

    const salaryGross = salaryResolved.grossSalaryPaisa;
    const salaryExemptions = salaries.reduce(
      (s, r) => s + (r.exemptionsPaisa ?? 0),
      0,
    );
    const salaryTds = salaryTdsResolved.valuePaisa;

    const manualInterest24b = deductions
      .filter((d) => d.section === '24B')
      .reduce((s, d) => s + (d.amountPaisa ?? 0), 0);

    // Sprint 5.9c — loan-derived 24(b) interest. Aggregator sums the
    // FY interest portion across all loans flagged
    // interest_qualifies_24b=true. We take MAX(manual, loan-derived)
    // so flag + manual entry don't double-count.
    const loanAgg = aggregateLoanTaxDeductions(
      loanRows.map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        status: r.status,
        currentBalance: r.currentBalance,
        originalAmount: r.originalAmount,
        interestRate: r.interestRate,
        monthlyEmi: r.monthlyEmi,
        startDate: r.startDate,
        maturityDate: r.maturityDate,
        remainingTenor: r.remainingTenor,
        principalQualifies80c: r.principalQualifies80c,
        interestQualifies24b: r.interestQualifies24b,
      })),
      fy,
    );
    const loanDeductions =
      'error' in loanAgg
        ? { totalInterestPaisa: 0, totalPrincipalPaisa: 0, perLiability: [] }
        : loanAgg;
    const interest24b = Math.max(manualInterest24b, loanDeductions.totalInterestPaisa);

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

    // Sprint 5.9c — loan principal flows into 80C with ₹1.5L cap.
    const EIGHTY_C_CAP_PAISA = 1_50_000 * 100;
    const manualEightyCPaisa = deductions
      .filter((r) => r.section === '80C')
      .reduce((s, r) => s + (r.amountPaisa ?? 0), 0);
    const eightyCAppliedPaisa = Math.min(
      manualEightyCPaisa + loanDeductions.totalPrincipalPaisa,
      EIGHTY_C_CAP_PAISA,
    );
    const otherDeductionsPaisa = deductions
      .filter((r) => r.section !== '80C')
      .reduce((s, r) => s + (r.amountPaisa ?? 0), 0);
    const oldDeductionsTotal = otherDeductionsPaisa + eightyCAppliedPaisa;
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

    // ─── Sprint 5.4 — eligibility detection ──────────────────────────
    // ITR-2's only ineligibility flag is business income. Everything
    // else (any number of HPs, capital gains, foreign income) is fine
    // here. If business income exists, push to ITR-3.
    const invoiceCount = fyInvoices.length;
    const turnoverPaisa = fyInvoices.reduce(
      (s, i) => s + (i.taxableAmount ?? 0),
      0,
    );

    const flags: {
      hasBusiness?: { invoiceCount: number; turnoverPaisa: number };
      hasForeignIncome?: boolean;
      isDirectorOrUnlisted?: boolean;
      agriculturalOver5k?: boolean;
    } = {};
    if (invoiceCount > 0) {
      flags.hasBusiness = { invoiceCount, turnoverPaisa };
    }
    flags.hasForeignIncome = false;
    flags.isDirectorOrUnlisted = false;
    flags.agriculturalOver5k = false;

    const isEligible = !flags.hasBusiness;

    return NextResponse.json({
      fy,
      regime,
      blocks: {
        salary: {
          employerCount: salaries.length,
          grossPaisa: salaryGross,
          grossSource: salaryResolved.source,
          grossDetail: salaryResolved.detail,
          exemptionsPaisa: salaryExemptions,
          taxableSalaryPaisa: salaryGross - salaryExemptions,
          tdsPaisa: salaryTds,
          tdsSource: salaryTdsResolved.source,
          tdsDetail: salaryTdsResolved.detail,
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
          // Sprint 5.9c — 80C breakdown + loan-derived deductions
          eightyC: {
            manualPaisa: manualEightyCPaisa,
            fromLoansPaisa: loanDeductions.totalPrincipalPaisa,
            appliedPaisa: eightyCAppliedPaisa,
            capPaisa: EIGHTY_C_CAP_PAISA,
          },
          loanDeductions: {
            totalInterestPaisa: loanDeductions.totalInterestPaisa,
            totalPrincipalPaisa: loanDeductions.totalPrincipalPaisa,
            perLiability: loanDeductions.perLiability,
          },
        },
      },
      summary,
      eligibility: { isEligible, flags },
      excludedIncomeBlocks: [],
      wizardSelectedForm: wizardSelection[0]?.selectedForm ?? null,
    });
  } catch (err) {
    console.error('[tax/itr2/summary GET]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
