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
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import {
  db,
  salaryIncome,
  otherSourcesIncome,
  presumptiveIncome,
  taxDeductions,
  taxSlabs,
  taxRegimeConfig,
  userPreferences,
  realEstate,
  capitalGains,
  invoices,
  itrFormSelection,
  type TaxRegime,
  type PresumptiveSection,
  type ReceiptMode,
} from '@/db';
import { auth } from '@/auth';
import { computeItr4Summary } from '@/lib/finance/itr4-summary';

function fyDateRange(fy: string): [string, string] {
  const [start] = fy.split('-');
  const startYear = parseInt(start, 10);
  return [`${startYear}-04-01`, `${startYear + 1}-03-31`];
}

const ITR4_CAP_PAISA = 50 * 100 * 100000;

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  try {
    const fy = new URL(request.url).searchParams.get('fy');
    if (!fy) return NextResponse.json({ error: 'fy required' }, { status: 400 });
    const userId = session.user.id;

    const [fyStart, fyEnd] = fyDateRange(fy);

    const [
      salaries,
      presumptiveRows,
      otherRows,
      deductions,
      slabs,
      configs,
      prefs,
      allProperties,
      cgRows,
      fyInvoices,
      wizardSelection,
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
      // Sprint 5.4 — eligibility detection inputs
      db
        .select()
        .from(realEstate)
        .where(eq(realEstate.userId, userId))
        .orderBy(asc(realEstate.id)),
      db
        .select()
        .from(capitalGains)
        .where(
          and(eq(capitalGains.userId, userId), eq(capitalGains.financialYear, fy)),
        ),
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
      db
        .select()
        .from(itrFormSelection)
        .where(
          and(eq(itrFormSelection.userId, userId), eq(itrFormSelection.fy, fy)),
        )
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

    // ─── Sprint 5.4 — eligibility detection ──────────────────────────
    const cgTotalPaisa = cgRows.reduce((s, r) => s + (r.taxableGain ?? 0), 0);
    const extraPropertiesRent = allProperties
      .slice(1)
      .filter((p) => !p.isSelfOccupied && (p.monthlyRent ?? 0) > 0)
      .reduce((s, p) => s + (p.monthlyRent ?? 0) * 12, 0);
    const invoiceCount = fyInvoices.length;
    const turnoverPaisa = fyInvoices.reduce(
      (s, i) => s + (i.taxableAmount ?? 0),
      0,
    );

    const excludedIncomeBlocks: Array<{
      label: string;
      amountPaisa: number;
      reason: string;
    }> = [];
    if (cgTotalPaisa > 0) {
      excludedIncomeBlocks.push({
        label: 'Capital gains',
        amountPaisa: cgTotalPaisa,
        reason: 'ITR-4 does not include Schedule CG.',
      });
    }
    if (extraPropertiesRent > 0) {
      excludedIncomeBlocks.push({
        label: 'Rental from additional properties',
        amountPaisa: extraPropertiesRent,
        reason: 'ITR-4 allows only one house property.',
      });
    }

    const flags: {
      exceedsCap?: { actualPaisa: number; capPaisa: number };
      hasCapitalGains?: { totalPaisa: number; rowCount: number };
      multipleHouseProperties?: { count: number; rentalPaisa: number };
      hasBusiness?: { invoiceCount: number; turnoverPaisa: number };
      hasForeignIncome?: boolean;
      isDirectorOrUnlisted?: boolean;
      agriculturalOver5k?: boolean;
    } = {};
    if (cgRows.length > 0 && cgTotalPaisa > 0) {
      flags.hasCapitalGains = {
        totalPaisa: cgTotalPaisa,
        rowCount: cgRows.length,
      };
    }
    if (allProperties.length > 1) {
      flags.multipleHouseProperties = {
        count: allProperties.length,
        rentalPaisa: extraPropertiesRent,
      };
    }
    // ITR-4 expects presumptive business; non-presumptive (GST invoices
    // not declared under 44ADA) would still be acceptable in theory, but
    // we surface invoices here only as a hint since the user's wizard
    // recommendation is what drives the actual eligibility narrative.
    if (invoiceCount > 0 && presumptiveRows.length === 0) {
      flags.hasBusiness = { invoiceCount, turnoverPaisa };
    }
    flags.hasForeignIncome = false;
    flags.isDirectorOrUnlisted = false;
    flags.agriculturalOver5k = false;

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

    // ITR-4 cap check needs the computed gross — evaluate now.
    if (summary.grossTotalIncomePaisa > ITR4_CAP_PAISA) {
      flags.exceedsCap = {
        actualPaisa: summary.grossTotalIncomePaisa,
        capPaisa: ITR4_CAP_PAISA,
      };
    }

    const isEligible =
      !flags.exceedsCap &&
      !flags.hasCapitalGains &&
      !flags.multipleHouseProperties &&
      !flags.hasBusiness &&
      !flags.hasForeignIncome &&
      !flags.isDirectorOrUnlisted &&
      !flags.agriculturalOver5k;

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
      eligibility: { isEligible, flags },
      excludedIncomeBlocks,
      wizardSelectedForm: wizardSelection[0]?.selectedForm ?? null,
    });
  } catch (err) {
    console.error('[tax/itr4/summary GET]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
