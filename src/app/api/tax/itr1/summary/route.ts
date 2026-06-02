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
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import {
  db,
  salaryIncome,
  realEstate,
  otherSourcesIncome,
  taxDeductions,
  taxSlabs,
  taxRegimeConfig,
  userPreferences,
  capitalGains,
  invoices,
  itrFormSelection,
  liabilities,
  type TaxRegime,
  type OtherIncomeSource,
} from '@/db';
import { auth } from '@/auth';
import { computeItr1Summary } from '@/lib/finance/itr1-summary';
import { aggregateLoanTaxDeductions } from '@/lib/finance/loan-tax';

/** FY string "2025-26" → ["2025-04-01", "2026-03-31"]. Used for the
 *  invoice-date range when checking business-income eligibility. */
function fyDateRange(fy: string): [string, string] {
  const [start] = fy.split('-');
  const startYear = parseInt(start, 10);
  return [`${startYear}-04-01`, `${startYear + 1}-03-31`];
}

/** ITR-1 cap — gross total income must be ≤ ₹50L. */
const ITR1_CAP_PAISA = 50 * 100 * 100000;

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

    const [fyStart, fyEnd] = fyDateRange(fy);

    const [
      salaries,
      allProperties,
      otherRows,
      deductions,
      slabs,
      configs,
      prefs,
      cgRows,
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
      // Sprint 5.4 — pull ALL properties (not just the first) so the page
      // can disclose every row. Sorting by id keeps the "first = ITR-1's
      // single eligible property" choice deterministic.
      db
        .select()
        .from(realEstate)
        .where(eq(realEstate.userId, userId))
        .orderBy(asc(realEstate.id)),
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
      // Sprint 5.4 — capital gains eligibility check
      db
        .select()
        .from(capitalGains)
        .where(
          and(eq(capitalGains.userId, userId), eq(capitalGains.financialYear, fy)),
        ),
      // Sprint 5.4 — business-income eligibility via GST invoices in FY
      db
        .select({
          taxableAmount: invoices.taxableAmount,
          invoiceDate: invoices.invoiceDate,
        })
        .from(invoices)
        .where(
          and(
            eq(invoices.userId, userId),
            gte(invoices.invoiceDate, fyStart),
            lte(invoices.invoiceDate, fyEnd),
          ),
        ),
      // Sprint 5.4 — wizard recommendation (if any)
      db
        .select()
        .from(itrFormSelection)
        .where(
          and(eq(itrFormSelection.userId, userId), eq(itrFormSelection.fy, fy)),
        )
        .limit(1),
      // Sprint 5.9c — loan rows for 80C principal + 24(b) interest derivation
      db.select().from(liabilities).where(eq(liabilities.userId, userId)),
    ]);
    // Keep the original single-property variable so the rest of the
    // file's math stays untouched. ITR-1 still only computes against the
    // first row; the additional rows are surfaced for disclosure only.
    const properties = allProperties.slice(0, 1);

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
    const manualInterest24b = deductions
      .filter((d) => d.section === '24B')
      .reduce((s, d) => s + (d.amountPaisa ?? 0), 0);

    // Sprint 5.9c — Loan-derived 24(b) interest. The aggregator sums
    // the FY interest portion across all loans flagged
    // interest_qualifies_24b=true. We take the LARGER of (manual
    // entry, loan-derived) so the user can't accidentally
    // double-count by leaving both the manual deduction row AND the
    // loan flag in place.
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
    // Sprint 5.9c — loan principal flows into 80C with ₹1.5L cap. The
    // raw sum may exceed the cap; we clamp the 80C bucket then add the
    // capped value alongside non-80C rows.
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

    // ─── Sprint 5.4 — eligibility detection ──────────────────────────
    // None of these mutate `summary` (ITR-1 math must stay byte-identical
    // to the prior version); they're additive disclosure for the UI.

    // Capital gains — sum taxableGain across all rows in FY.
    const cgTotalPaisa = cgRows.reduce((s, r) => s + (r.taxableGain ?? 0), 0);

    // Multi-property — count + rental from properties beyond the first
    // (only non-self-occupied rows with positive monthly rent contribute,
    // matching the IT-rules letter-out treatment for the form).
    const extraPropertiesRent = allProperties
      .slice(1)
      .filter((p) => !p.isSelfOccupied && (p.monthlyRent ?? 0) > 0)
      .reduce((s, p) => s + (p.monthlyRent ?? 0) * 12, 0);

    // Business — sum taxableAmount across FY invoices.
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
        reason: 'ITR-1 does not include Schedule CG.',
      });
    }
    if (extraPropertiesRent > 0) {
      excludedIncomeBlocks.push({
        label: 'Rental from additional properties',
        amountPaisa: extraPropertiesRent,
        reason: 'ITR-1 allows only one house property.',
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
    if (summary.grossTotalIncomePaisa > ITR1_CAP_PAISA) {
      flags.exceedsCap = {
        actualPaisa: summary.grossTotalIncomePaisa,
        capPaisa: ITR1_CAP_PAISA,
      };
    }
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
    if (invoiceCount > 0) {
      flags.hasBusiness = { invoiceCount, turnoverPaisa };
    }
    // Stubs — schema doesn't capture these yet. Typed for forward
    // compatibility; UI will pick them up automatically.
    flags.hasForeignIncome = false;
    flags.isDirectorOrUnlisted = false;
    flags.agriculturalOver5k = false;

    const isEligible =
      !flags.exceedsCap &&
      !flags.hasCapitalGains &&
      !flags.multipleHouseProperties &&
      !flags.hasBusiness &&
      !flags.hasForeignIncome &&
      !flags.isDirectorOrUnlisted &&
      !flags.agriculturalOver5k;

    const housePropertyRows = allProperties.map((p) => ({
      id: p.id,
      name: p.propertyName,
      rentalPaisa: (p.monthlyRent ?? 0) * 12,
      sec24bPaisa: p.id === (property?.id ?? -1) ? interest24b : 0,
      isSelfOccupied: !!p.isSelfOccupied,
    }));

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
          // Sprint 5.9c — surface 80C breakdown after cap
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
      excludedIncomeBlocks,
      housePropertyRows,
      wizardSelectedForm: wizardSelection[0]?.selectedForm ?? null,
    });
  } catch (err) {
    console.error('[tax/itr1/summary GET]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
