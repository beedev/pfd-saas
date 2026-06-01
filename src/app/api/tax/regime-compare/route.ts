/**
 * GET /api/tax/regime-compare?fy=2026-27
 *
 * Computes tax under BOTH regimes side-by-side using the user's
 * gross income + deductions for the given FY, returns the
 * recommendation + savings delta.
 *
 * Gross income sources (summed for the FY):
 *   • salary_income — Sprint 5.1a: prefers component-sum
 *     (basic+da+hra+lta+conveyance+children_ed+medical+other) when any
 *     component is non-zero; falls back to gross_salary_paisa for
 *     legacy rows where all components are 0.
 *   • other_sources_income — non-exempt rows
 *   • capital gains realised in the FY (LTCG + STCG) — NOTE: slabs do
 *     NOT apply to LTCG/STCG (separate flat rates). For now we pass
 *     only slab-applicable income; LTCG/STCG handling is a Phase 2
 *     refinement.
 *   • GST invoice income (taxable_amount on FINAL invoices)
 *   • real_estate.monthly_rent × 12, MINUS sec 24(b) interest +
 *     sec 80EEA (OLD only) and the 30% standard maintenance
 *     deduction on rental income.
 *
 * Deductions — Sprint 5.1a:
 *   • HRA exemption (sec 10(13A)) — subtracted from OLD-regime
 *     salary only. Uses min(HRA received, rent-10%(basic+da),
 *     city% × (basic+da)).
 *   • Sec 24(b) — capped home-loan interest (₹2L self-occupied
 *     post-1999, ₹30k pre-1999, uncapped let-out) reduces house
 *     property head under OLD only.
 *   • Sec 80EEA — additional ₹1.5L on interest above 24(b) when
 *     eligibility tests pass (first home + stamp ≤ ₹45L + carpet ≤
 *     968 sqft + loan Apr-2019…Mar-2022).
 *   • OLD regime — all tax_deductions rows for the FY.
 *   • NEW regime — only tax_deductions rows where
 *     eligible_under_new = true. The 0024 migration backfills this
 *     for 80CCD(2) employer NPS.
 *
 * Auth-gated, user-scoped. The slab tables are NOT user-scoped (govt
 * data) so reads are global.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq, gte, lte } from 'drizzle-orm';
import {
  db,
  taxSlabs,
  taxRegimeConfig,
  taxDeductions,
  salaryIncome,
  otherSourcesIncome,
  capitalGains,
  realEstate,
  invoices,
  userPreferences,
  type TaxRegime,
} from '@/db';
import { compareRegimes } from '@/lib/finance/tax-slabs';
import { computeHraExemption } from '@/lib/finance/hra-exemption';
import { computeSection24bDeduction } from '@/lib/finance/section-24b';
import { computeSection80EeaDeduction } from '@/lib/finance/section-80eea';
import { auth } from '@/auth';

/** Convert FY string "2026-27" → { start: '2026-04-01', end: '2027-03-31' }. */
function fyBounds(fy: string): { start: string; end: string } | null {
  const m = fy.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const startYear = parseInt(m[1], 10);
  const start = `${startYear}-04-01`;
  const end = `${startYear + 1}-03-31`;
  return { start, end };
}

/** 1-Apr-1999 cutoff for sec 24(b) — pre = ₹30k cap, post = ₹2L. */
const SEC_24B_VINTAGE_CUTOFF = '1999-04-01';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const fy = searchParams.get('fy') ?? defaultCurrentFY();
    const bounds = fyBounds(fy);
    if (!bounds) {
      return NextResponse.json({ error: 'Invalid fy format, use YYYY-YY' }, { status: 400 });
    }

    // Slab + config rows — govt data, not user-scoped.
    const [slabs, configs] = await Promise.all([
      db.select().from(taxSlabs).where(eq(taxSlabs.fy, fy)),
      db.select().from(taxRegimeConfig).where(eq(taxRegimeConfig.fy, fy)),
    ]);

    if (slabs.length === 0 || configs.length < 2) {
      return NextResponse.json(
        { error: `No slab data for FY ${fy}. Seed first.` },
        { status: 404 },
      );
    }

    const slabsByRegime = (regime: TaxRegime) =>
      slabs.filter((s) => s.regime === regime);
    const configByRegime = (regime: TaxRegime) => {
      const cfg = configs.find((c) => c.regime === regime);
      if (!cfg) throw new Error(`Missing config for regime ${regime} in FY ${fy}`);
      return cfg;
    };

    // Income sources — all user-scoped. Aggregate gross in paisa.
    const userId = session.user.id;
    const [
      salaries,
      others,
      caps,
      properties,
      gstInvoices,
      deductions,
      prefsRows,
    ] = await Promise.all([
      db
        .select()
        .from(salaryIncome)
        .where(and(eq(salaryIncome.userId, userId), eq(salaryIncome.financialYear, fy))),
      db
        .select()
        .from(otherSourcesIncome)
        .where(
          and(eq(otherSourcesIncome.userId, userId), eq(otherSourcesIncome.financialYear, fy)),
        ),
      db
        .select()
        .from(capitalGains)
        .where(and(eq(capitalGains.userId, userId), eq(capitalGains.financialYear, fy))),
      db.select().from(realEstate).where(eq(realEstate.userId, userId)),
      db
        .select()
        .from(invoices)
        .where(
          and(
            eq(invoices.userId, userId),
            gte(invoices.invoiceDate, bounds.start),
            lte(invoices.invoiceDate, bounds.end),
            eq(invoices.status, 'FINAL'),
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
      db
        .select()
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId))
        .limit(1),
    ]);

    const prefs = prefsRows[0];
    const isMetro = prefs?.metroCity ?? true;

    // Salary — Sprint 5.1a. Prefer component-sum when ANY component is
    // populated; fall back to gross_salary_paisa for legacy rows.
    let salaryPaisa = 0;
    let basicPlusDaTotalPaisa = 0;
    let hraReceivedTotalPaisa = 0;
    let rentPaidAnnualPaisa = 0;
    for (const r of salaries) {
      const componentSum =
        (r.basicPaisa ?? 0) +
        (r.daPaisa ?? 0) +
        (r.hraReceivedPaisa ?? 0) +
        (r.ltaPaisa ?? 0) +
        (r.conveyancePaisa ?? 0) +
        (r.childrenEdAllowancePaisa ?? 0) +
        (r.medicalPaisa ?? 0) +
        (r.otherAllowancesPaisa ?? 0);
      if (componentSum > 0) {
        salaryPaisa += componentSum;
      } else {
        // Backward-compat: legacy row only has gross_salary_paisa set.
        if (r.grossSalaryPaisa > 0) {
          console.warn(
            `[regime-compare] legacy salary row id=${r.id} fy=${fy} — gross set but components all 0; HRA exemption will be 0 for this row.`,
          );
        }
        salaryPaisa += r.grossSalaryPaisa ?? 0;
      }
      basicPlusDaTotalPaisa += (r.basicPaisa ?? 0) + (r.daPaisa ?? 0);
      hraReceivedTotalPaisa += r.hraReceivedPaisa ?? 0;
      // Stored as MONTHLY rent — annualise.
      rentPaidAnnualPaisa += (r.rentPaidMonthlyPaisa ?? 0) * 12;
    }

    // HRA exemption — OLD regime ONLY. Subtracted from salary
    // pre-slab. NEW regime does not allow this exemption.
    const hraExemptionPaisa = computeHraExemption({
      hraReceivedPaisa: hraReceivedTotalPaisa,
      basicPlusDaPaisa: basicPlusDaTotalPaisa,
      rentPaidPaisa: rentPaidAnnualPaisa,
      isMetro,
    });

    // Other sources — exclude rows flagged tax-exempt (PPF interest etc.).
    const otherPaisa = others
      .filter((r) => !r.isTaxExempt)
      .reduce((s, r) => s + (r.amountPaisa ?? 0), 0);

    // GST invoices — taxable_amount is post-GST-component, the freelance
    // / consulting income before tax. Falls under business income.
    const businessPaisa = gstInvoices.reduce(
      (s, r) => s + (r.taxableAmount ?? 0),
      0,
    );

    // ─── House property head (OLD regime only deductions) ─────────────
    // For each property: gross rent × 12 → 30% std maintenance deduction
    // → sec 24(b) interest → sec 80EEA. Negative house property (loss)
    // can offset other heads up to ₹2L. NEW regime allows 30% std on
    // let-out only; self-occupied gets nothing.
    let rentalGrossPaisa = 0;
    let stdMaintenanceDeductionPaisa = 0;
    let sec24bTotalPaisa = 0;
    let sec80eeaTotalPaisa = 0;
    let letoutRentalGrossPaisa = 0;
    let letoutStdMaintPaisa = 0;
    for (const p of properties) {
      const annualRent = (p.monthlyRent ?? 0) * 12;
      rentalGrossPaisa += annualRent;
      const stdMaint = Math.round(annualRent * 0.3);
      stdMaintenanceDeductionPaisa += stdMaint;
      if (!p.isSelfOccupied) {
        // Let-out — both regimes get the 30% std maint deduction.
        letoutRentalGrossPaisa += annualRent;
        letoutStdMaintPaisa += stdMaint;
      }
      const interestPaid = p.homeLoanInterestPaidPaisa ?? 0;
      if (interestPaid > 0) {
        const post1999 =
          !p.homeLoanDisbursedDate ||
          p.homeLoanDisbursedDate >= SEC_24B_VINTAGE_CUTOFF;
        const sec24b = computeSection24bDeduction({
          homeLoanInterestPaidPaisa: interestPaid,
          isSelfOccupied: p.isSelfOccupied,
          loanDisbursedAfter1Apr1999: post1999,
        });
        sec24bTotalPaisa += sec24b;
        sec80eeaTotalPaisa += computeSection80EeaDeduction({
          homeLoanInterestPaidPaisa: interestPaid,
          section24bDeductionPaisa: sec24b,
          isFirstHome: p.isFirstHome,
          stampValuePaisa: p.stampValuePaisa,
          carpetAreaSqft: p.carpetAreaSqft,
          loanDisbursedDate: p.homeLoanDisbursedDate,
        });
      }
    }

    // OLD house-property head: gross rent − 30% std maint − sec 24(b) − 80EEA.
    // Can go negative (HP loss) — capped at −₹2L of offset against other
    // heads under existing law; we report raw, the lib's clamp at
    // taxable >= 0 acts as the final guardrail.
    const TWO_LAKH = 2_00_000 * 100;
    const oldHpLossUncapped = sec24bTotalPaisa + sec80eeaTotalPaisa;
    const oldHpNet = rentalGrossPaisa - stdMaintenanceDeductionPaisa - oldHpLossUncapped;
    // Cross-head loss offset cap: loss from HP can offset other heads
    // up to ₹2L. The "loss" portion is anything below 0.
    const oldHpForSlab =
      oldHpNet < 0 ? Math.max(oldHpNet, -TWO_LAKH) : oldHpNet;

    // NEW house-property head: gross rent − 30% std maint on let-out
    // only. Self-occupied = 0 contribution. No sec 24(b) on
    // self-occupied; let-out interest still allowed (current law) but
    // we omit until the user can flag it explicitly (Sprint 5.1
    // simplification — deferred refinement).
    const newHpForSlab = letoutRentalGrossPaisa - letoutStdMaintPaisa;

    // Capital gains — LTCG/STCG have their own flat rates (Phase 5.1c
    // refines these). Tracked separately, not in slab income.
    const capitalGainsTaxablePaisa = caps.reduce(
      (s, r) => s + (r.taxableGain ?? 0),
      0,
    );

    // Slab-applicable gross income (PER regime — HRA + HP differ).
    const oldGrossSlab =
      salaryPaisa - hraExemptionPaisa + otherPaisa + businessPaisa + oldHpForSlab;
    const newGrossSlab = salaryPaisa + otherPaisa + businessPaisa + newHpForSlab;

    // Chapter VI-A deductions.
    // OLD: every row counts.
    // NEW: only rows flagged eligible_under_new (80CCD(2) + future).
    const oldDeductionsPaisa = deductions.reduce(
      (s, r) => s + (r.amountPaisa ?? 0),
      0,
    );
    const newDeductionsPaisa = deductions
      .filter((r) => r.eligibleUnderNew)
      .reduce((s, r) => s + (r.amountPaisa ?? 0), 0);

    const result = compareRegimes({
      grossIncomePaisa: Math.max(0, oldGrossSlab),
      oldRegimeDeductionsPaisa: oldDeductionsPaisa,
      newRegimeDeductionsPaisa: newDeductionsPaisa,
      oldSlabs: slabsByRegime('OLD'),
      oldConfig: configByRegime('OLD'),
      newSlabs: slabsByRegime('NEW'),
      newConfig: configByRegime('NEW'),
    });

    // Recompute NEW under its own gross (different HP treatment).
    // compareRegimes runs both under same gross — call computeTax for
    // NEW separately and merge.
    const { computeTax } = await import('@/lib/finance/tax-slabs');
    const newResult = computeTax({
      grossIncomePaisa: Math.max(0, newGrossSlab),
      deductionsPaisa: newDeductionsPaisa,
      slabs: slabsByRegime('NEW'),
      config: configByRegime('NEW'),
    });
    const oldTotal = result.old.totalTaxPaisa;
    const newTotal = newResult.totalTaxPaisa;
    const recommendation: 'NEW' | 'OLD' = newTotal <= oldTotal ? 'NEW' : 'OLD';
    const savingsPaisa = Math.abs(newTotal - oldTotal);

    return NextResponse.json({
      fy,
      income: {
        salary: salaryPaisa,
        hraExemption: hraExemptionPaisa,
        other: otherPaisa,
        business: businessPaisa,
        rentalGross: rentalGrossPaisa,
        rentalStdMaintenance: stdMaintenanceDeductionPaisa,
        sec24b: sec24bTotalPaisa,
        sec80eea: sec80eeaTotalPaisa,
        oldHpNet: oldHpForSlab,
        newHpNet: newHpForSlab,
        gross: oldGrossSlab,
        grossNew: newGrossSlab,
        // Surfaced separately — slab tax doesn't include this
        capitalGainsTaxable: capitalGainsTaxablePaisa,
      },
      deductions: {
        oldRegime: oldDeductionsPaisa,
        newRegime: newDeductionsPaisa,
      },
      comparison: {
        old: result.old,
        new: newResult,
        recommendation,
        savingsPaisa,
      },
    });
  } catch (err) {
    console.error('[tax/regime-compare GET]', err);
    return NextResponse.json({ error: 'Failed to compute' }, { status: 500 });
  }
}

/** Returns the current Indian FY as a string. April–March cycle. */
function defaultCurrentFY(): string {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const startYear = month >= 4 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}
