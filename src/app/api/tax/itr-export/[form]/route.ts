/**
 * ITR-form-specific export — Sprint 4 Phase 4 + Sprint 4.1 rewire.
 *
 * GET /api/tax/itr-export/:form?fy=2025-26
 *   :form ∈ ITR-1 | ITR-2 | ITR-3 | ITR-4
 *
 * Per-form behaviour:
 *   • ITR-1 — bespoke Sahaj JSON summary (same shape as Phase 4)
 *   • ITR-2 — calls computeItr2Summary directly (Sprint 4.1)
 *   • ITR-3 — delegates to the existing /tax/itr3 walkthrough URL
 *     (this route doesn't try to rebuild the filing-pack ZIP)
 *   • ITR-4 — calls computeItr4Summary directly (Sprint 4.1)
 *
 * The form-specific summaries carry the same data shape as what the
 * walkthrough pages already render, so this export route doubles as
 * a stable JSON "view" of the page for any downstream tool (e.g. a
 * future e-filing JSON transformer — see CLAUDE.md "Deferred from
 * Sprint 4.1").
 *
 * Implementation note: we call the summary libs directly (not over
 * HTTP) to avoid round-trip-cookie complexity. The data fetches are
 * essentially identical to the /api/tax/itrX/summary routes —
 * duplication is intentional and localised.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';
import {
  db,
  salaryIncome,
  taxDeductions,
  otherSourcesIncome,
  realEstate,
  capitalGains,
  presumptiveIncome,
  tdsCredits,
  taxSlabs,
  taxRegimeConfig,
  userPreferences,
  type TaxRegime,
  type OtherIncomeSource,
  type PresumptiveSection,
  type ReceiptMode,
} from '@/db';
import { auth } from '@/auth';
import { computeItr1Summary } from '@/lib/finance/itr1-summary';
import { computeItr2Summary } from '@/lib/finance/itr2-summary';
import { computeItr4Summary } from '@/lib/finance/itr4-summary';
import type { CapitalGainRow, CgAssetType, CgGainType } from '@/lib/finance/capital-gains-tax';

type ItrForm = 'ITR-1' | 'ITR-2' | 'ITR-3' | 'ITR-4';
const VALID: ItrForm[] = ['ITR-1', 'ITR-2', 'ITR-3', 'ITR-4'];

const ITR1_OTHER_SOURCES: OtherIncomeSource[] = [
  'BANK_INTEREST',
  'FD_INTEREST',
  'PF_INTEREST',
  'DIVIDEND',
];

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

/** Load the regime-eligible slabs + config for the user's preferred
 *  regime. Returns null if the FY hasn't been seeded yet. */
async function loadRegimeContext(userId: string, fy: string) {
  const [slabs, configs, prefs] = await Promise.all([
    db.select().from(taxSlabs).where(eq(taxSlabs.fy, fy)),
    db.select().from(taxRegimeConfig).where(eq(taxRegimeConfig.fy, fy)),
    db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1),
  ]);
  if (slabs.length === 0 || configs.length === 0) return null;
  const regime: TaxRegime = (prefs[0]?.taxRegimeDefault as TaxRegime) ?? 'NEW';
  const regimeSlabs = slabs.filter((s) => s.regime === regime);
  const regimeConfig = configs.find((c) => c.regime === regime);
  if (!regimeConfig || regimeSlabs.length === 0) return null;
  return {
    regime,
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
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ form: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  try {
    const { form } = await params;
    if (!VALID.includes(form as ItrForm)) {
      return NextResponse.json(
        { error: 'form must be ITR-1 / ITR-2 / ITR-3 / ITR-4' },
        { status: 400 },
      );
    }
    const fy = new URL(request.url).searchParams.get('fy');
    if (!fy) return NextResponse.json({ error: 'fy required' }, { status: 400 });

    const userId = session.user.id;

    // ITR-3 stays delegated — the dedicated multi-page walkthrough at
    // /tax/itr3 owns this filer's experience. We just hand the client
    // a redirect hint with the right URL.
    if (form === 'ITR-3') {
      return NextResponse.json({
        form,
        delegate: `/tax/itr3?fy=${encodeURIComponent(fy)}`,
        message:
          'ITR-3 (business / professional) is handled by the dedicated walkthrough at /tax/itr3 — salary, TDS, business profession, capital gains, other income sub-routes all live there.',
      });
    }

    const regimeContext = await loadRegimeContext(userId, fy);
    if (!regimeContext) {
      return NextResponse.json(
        { error: `Tax slabs/config for FY ${fy} not seeded yet` },
        { status: 422 },
      );
    }

    // ─── Common fetches ─────────────────────────────────────────────
    const [salaries, deductions, others, tdsRows] = await Promise.all([
      db
        .select()
        .from(salaryIncome)
        .where(and(eq(salaryIncome.userId, userId), eq(salaryIncome.financialYear, fy))),
      db
        .select()
        .from(taxDeductions)
        .where(and(eq(taxDeductions.userId, userId), eq(taxDeductions.financialYear, fy))),
      db
        .select()
        .from(otherSourcesIncome)
        .where(
          and(eq(otherSourcesIncome.userId, userId), eq(otherSourcesIncome.financialYear, fy)),
        ),
      db
        .select()
        .from(tdsCredits)
        .where(and(eq(tdsCredits.userId, userId), eq(tdsCredits.financialYear, fy))),
    ]);

    const totalGrossSalary = salaries.reduce((s, r) => s + (r.grossSalaryPaisa ?? 0), 0);
    const totalExemptions = salaries.reduce((s, r) => s + (r.exemptionsPaisa ?? 0), 0);
    const totalSalaryTds = salaries.reduce((s, r) => s + (r.tdsPaisa ?? 0), 0);
    const nonSalaryTds = tdsRows.reduce((s, r) => s + (r.tdsPaisa ?? 0), 0);

    const interest24b = deductions
      .filter((d) => d.section === '24B')
      .reduce((s, d) => s + (d.amountPaisa ?? 0), 0);

    const oldDeductionsTotal = deductions.reduce((s, r) => s + (r.amountPaisa ?? 0), 0);
    const deductionsForRegime =
      regimeContext.regime === 'OLD' ? oldDeductionsTotal : 0;

    if (form === 'ITR-1') {
      // Bespoke Sahaj summary — kept compact (one-pager).
      const [firstProperty] = await db
        .select()
        .from(realEstate)
        .where(eq(realEstate.userId, userId))
        .orderBy(asc(realEstate.id))
        .limit(1);
      const otherInterest = others
        .filter((r) => !r.isTaxExempt)
        .filter((r) => ITR1_OTHER_SOURCES.includes(r.source))
        .reduce((s, r) => s + (r.amountPaisa ?? 0), 0);

      const propertyInput = firstProperty
        ? {
            annualRentPaisa: (firstProperty.monthlyRent ?? 0) * 12,
            municipalTaxesPaisa: firstProperty.propertyTaxAnnual ?? 0,
            homeLoanInterestPaisa: interest24b,
          }
        : null;

      const summary = computeItr1Summary({
        salaryGrossPaisa: totalGrossSalary,
        salaryExemptionsPaisa: totalExemptions,
        property: propertyInput,
        otherInterestIncomePaisa: otherInterest,
        deductionsPaisa: deductionsForRegime,
        slabs: regimeContext.slabs,
        config: regimeContext.config,
        regime: regimeContext.regime,
      });

      // Per-section bucket totals (preserved from Phase 4 for backward
      // compat with anything reading sahajSummary.deductionsBySection).
      const byBucket: Record<string, number> = {};
      for (const d of deductions) {
        const key = (d.section ?? 'OTHER').replace('SECTION_', '');
        byBucket[key] = (byBucket[key] ?? 0) + (d.amountPaisa ?? 0);
      }

      return NextResponse.json({
        form: 'ITR-1',
        fy,
        regime: regimeContext.regime,
        sahajSummary: {
          salary: {
            employerCount: salaries.length,
            grossPaisa: totalGrossSalary,
            taxablePaisa: totalGrossSalary - totalExemptions,
            tdsPaisa: totalSalaryTds,
          },
          houseProperty: firstProperty
            ? {
                count: 1,
                annualRentPaisa: (firstProperty.monthlyRent ?? 0) * 12,
                netIncomePaisa: summary.housePropertyIncomePaisa,
              }
            : { count: 0, annualRentPaisa: 0, netIncomePaisa: 0 },
          otherSourcesPaisa: otherInterest,
          deductionsBySection: byBucket,
          totalDeductionsPaisa: Object.values(byBucket).reduce((s, v) => s + v, 0),
          nonSalaryTdsPaisa: nonSalaryTds,
          totalIncomePaisa: summary.grossTotalIncomePaisa,
          taxableIncomePaisa: summary.taxableIncomePaisa,
          totalTaxPaisa: summary.totalTaxPaisa,
          exceedsCap: summary.exceedsCap,
        },
      });
    }

    if (form === 'ITR-2') {
      const [properties, cgRows] = await Promise.all([
        db.select().from(realEstate).where(eq(realEstate.userId, userId)),
        db
          .select()
          .from(capitalGains)
          .where(
            and(eq(capitalGains.userId, userId), eq(capitalGains.financialYear, fy)),
          ),
      ]);
      const houseProperties = properties.map((p, idx) => ({
        label: p.propertyName,
        annualRentPaisa: (p.monthlyRent ?? 0) * 12,
        municipalTaxesPaisa: p.propertyTaxAnnual ?? 0,
        homeLoanInterestPaisa: idx === 0 ? interest24b : 0,
      }));
      const otherIncome = others
        .filter((r) => !r.isTaxExempt)
        .reduce((s, r) => s + (r.amountPaisa ?? 0), 0);
      const capitalGainsRows: CapitalGainRow[] = cgRows.map((r) => ({
        assetType: mapAssetType(r.assetType),
        gainType: r.holdingPeriod as CgGainType,
        taxableGainPaisa: r.taxableGain,
        saleDate: r.saleDate, // Sprint 5.1c — drives pre/post-Jul-24 cutoff
      }));
      const summary = computeItr2Summary({
        salaryGrossPaisa: totalGrossSalary,
        salaryExemptionsPaisa: totalExemptions,
        houseProperties,
        otherIncomePaisa: otherIncome,
        capitalGainsRows,
        deductionsPaisa: deductionsForRegime,
        slabs: regimeContext.slabs,
        config: regimeContext.config,
        regime: regimeContext.regime,
        fy,
      });
      return NextResponse.json({
        form: 'ITR-2',
        fy,
        regime: regimeContext.regime,
        summary,
        tdsTotals: { salaryTdsPaisa: totalSalaryTds, nonSalaryTdsPaisa: nonSalaryTds },
      });
    }

    // form === 'ITR-4'
    const presumptiveRows = await db
      .select()
      .from(presumptiveIncome)
      .where(and(eq(presumptiveIncome.userId, userId), eq(presumptiveIncome.fy, fy)));
    const otherIncome = others
      .filter((r) => !r.isTaxExempt)
      .reduce((s, r) => s + (r.amountPaisa ?? 0), 0);
    const summary = computeItr4Summary({
      salaryGrossPaisa: totalGrossSalary,
      salaryExemptionsPaisa: totalExemptions,
      presumptiveLines: presumptiveRows.map((r) => ({
        section: r.section as PresumptiveSection,
        grossReceiptsPaisa: r.grossReceiptsPaisa,
        receiptMode: (r.receiptMode ?? 'DIGITAL') as ReceiptMode,
        declaredProfitPaisa: r.declaredProfitPaisa,
      })),
      otherIncomePaisa: otherIncome,
      deductionsPaisa: deductionsForRegime,
      slabs: regimeContext.slabs,
      config: regimeContext.config,
      regime: regimeContext.regime,
    });
    return NextResponse.json({
      form: 'ITR-4',
      fy,
      regime: regimeContext.regime,
      summary,
      tdsTotals: { salaryTdsPaisa: totalSalaryTds, nonSalaryTdsPaisa: nonSalaryTds },
    });
  } catch (err) {
    console.error('[tax/itr-export/:form GET]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
