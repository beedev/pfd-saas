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
  liabilities,
  presumptiveIncome,
  type TaxRegime,
} from '@/db';
import { compareRegimes } from '@/lib/finance/tax-slabs';
import { computeHraExemption } from '@/lib/finance/hra-exemption';
import {
  computeSection24bDeduction,
  isDisbursedOnOrAfterVintageCutoff,
} from '@/lib/finance/section-24b';
import { computeSection80EeaDeduction } from '@/lib/finance/section-80eea';
import { aggregateLoanTaxDeductions } from '@/lib/finance/loan-tax';
import { deriveDeductions } from '@/lib/finance/deduction-engine';
import { resolveSalaryIncome } from '@/lib/finance/form16-tax-source';
import { financialYearBoundsIso } from '@/lib/finance/tax-constants';
import { computeAggregateCapitalGainsTax } from '@/lib/finance/capital-gains-tax';
import { auth } from '@/auth';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const fy = searchParams.get('fy') ?? defaultCurrentFY();
    const bounds = /^\d{4}-\d{2}$/.test(fy) ? financialYearBoundsIso(fy) : null;
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
      salaryResolved,
      others,
      caps,
      properties,
      gstInvoices,
      deductions,
      prefsRows,
      loanRows,
      presumptiveRows,
    ] = await Promise.all([
      db
        .select()
        .from(salaryIncome)
        .where(and(eq(salaryIncome.userId, userId), eq(salaryIncome.financialYear, fy))),
      resolveSalaryIncome(userId, fy),
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
      // Sprint 5.9c — pull liabilities so the qualifying flags can
      // feed 80C + 24(b) without forcing the user to also create
      // manual tax_deductions rows.
      db.select().from(liabilities).where(eq(liabilities.userId, userId)),
      // Sprint 5.12 — presumptive (44AD/44ADA/44AE) declarations for the FY.
      // When present, the deemed profit IS the taxable business income and
      // the underlying GST receipts must not be double-counted.
      db
        .select()
        .from(presumptiveIncome)
        .where(
          and(eq(presumptiveIncome.userId, userId), eq(presumptiveIncome.fy, fy)),
        ),
    ]);

    const prefs = prefsRows[0];
    const isMetro = prefs?.metroCity ?? true;

    // Sprint 5.9c — Loan tax aggregator. Maps loans whose flags are
    // set into FY-aggregated principal/interest sums. The result also
    // surfaces per-liability breakdown for the UI's "from your loans"
    // line.
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
        ? { totalInterestPaisa: 0, totalPrincipalPaisa: 0, perLiability: [] as Array<unknown> }
        : loanAgg;

    // Salary — gross is Form-16 authoritative (resolver). When a Part-B
    // Form 16 exists for the FY its gross-salary figure overrides the
    // manually-kept salary_income books; the resolver's grossSalaryPaisa
    // equals the books gross sum when no Form 16 is present (behaviour
    // unchanged). HRA components (basic/DA/HRA/rent) stay books-sourced —
    // Form 16 Part B doesn't break gross into these components, so the HRA
    // exemption math still relies on the user-entered components.
    const salaryPaisa = salaryResolved.grossSalaryPaisa;
    let basicPlusDaTotalPaisa = 0;
    let hraReceivedTotalPaisa = 0;
    let rentPaidAnnualPaisa = 0;
    for (const r of salaries) {
      basicPlusDaTotalPaisa += (r.basicPaisa ?? 0) + (r.daPaisa ?? 0);
      hraReceivedTotalPaisa += r.hraReceivedPaisa ?? 0;
      // Stored as MONTHLY rent — annualise.
      rentPaidAnnualPaisa += (r.rentPaidMonthlyPaisa ?? 0) * 12;
    }

    // HRA exemption — OLD regime ONLY. Subtracted from salary pre-slab.
    // NEW regime does not allow this exemption.
    //   • Books path: compute the 10(13A) min() from the user-entered
    //     components (basic+DA, HRA received, rent paid) — granular and
    //     preferred when present.
    //   • Form 16 fallback: when no books components exist (salary is
    //     Form-16-authoritative), trust the employer-computed exemption
    //     reported on Form 16 Part B. Otherwise the OLD regime would
    //     silently drop a real HRA exemption to ₹0.
    const hraFromBooksPaisa = computeHraExemption({
      hraReceivedPaisa: hraReceivedTotalPaisa,
      basicPlusDaPaisa: basicPlusDaTotalPaisa,
      rentPaidPaisa: rentPaidAnnualPaisa,
      isMetro,
    });
    const hraExemptionPaisa =
      hraFromBooksPaisa > 0
        ? hraFromBooksPaisa
        : (salaryResolved.hraExemptionPaisa ?? 0);

    // Other sources — exclude rows flagged tax-exempt (PPF interest etc.).
    const otherPaisa = others
      .filter((r) => !r.isTaxExempt)
      .reduce((s, r) => s + (r.amountPaisa ?? 0), 0);

    // Business income. Two mutually-exclusive bases:
    //   • Presumptive (44AD/44ADA/44AE) — when the user has declared
    //     presumptive income for the FY, the *deemed profit* (e.g. 44ADA's
    //     50% of professional receipts) IS the taxable business income.
    //     The raw GST receipts that fund it are NOT added on top.
    //   • Regular books — full GST taxable_amount on FINAL invoices.
    const gstReceiptsPaisa = gstInvoices.reduce(
      (s, r) => s + (r.taxableAmount ?? 0),
      0,
    );
    const presumptiveDeclaredPaisa = presumptiveRows.reduce(
      (s, r) => s + (r.declaredProfitPaisa ?? 0),
      0,
    );
    const hasPresumptive = presumptiveRows.length > 0;
    const businessPaisa = hasPresumptive ? presumptiveDeclaredPaisa : gstReceiptsPaisa;

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
        const post1999 = isDisbursedOnOrAfterVintageCutoff(p.homeLoanDisbursedDate);
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

    // Sprint 5.9c — Loan-derived 24(b) interest. When a HOME_LOAN has
    // `interest_qualifies_24b=true`, the FY interest portion from the
    // amortization schedule is a more accurate source than whatever the
    // user typed into `real_estate.home_loan_interest_paid_paisa`. We
    // route the loan interest to the FIRST self-occupied property
    // (conventional default — if a user has multiple loans on multiple
    // properties they can disable flags + keep manual entries). The
    // ₹2L self-occupied cap still applies via the sec24b lib.
    //
    // Math: replace the per-property contribution that the loop above
    // computed for the first self-occupied row with the LARGER of
    // (loan interest, user-entered interest), capped through the sec24b
    // lib. Net delta is added to sec24bTotalPaisa.
    const loanInterestPaisa = loanDeductions.totalInterestPaisa;
    if (loanInterestPaisa > 0) {
      const firstSelfOccupied = properties.find((p) => p.isSelfOccupied);
      if (firstSelfOccupied) {
        const userInterest = firstSelfOccupied.homeLoanInterestPaidPaisa ?? 0;
        const post1999 = isDisbursedOnOrAfterVintageCutoff(
          firstSelfOccupied.homeLoanDisbursedDate,
        );
        const oldContribution = computeSection24bDeduction({
          homeLoanInterestPaidPaisa: userInterest,
          isSelfOccupied: true,
          loanDisbursedAfter1Apr1999: post1999,
        });
        const newContribution = computeSection24bDeduction({
          homeLoanInterestPaidPaisa: Math.max(userInterest, loanInterestPaisa),
          isSelfOccupied: true,
          loanDisbursedAfter1Apr1999: post1999,
        });
        sec24bTotalPaisa += Math.max(0, newContribution - oldContribution);
      } else {
        // No self-occupied property — fall back to attributing the
        // loan interest at the let-out (uncapped) rate. Stack-add to
        // 24(b) total.
        sec24bTotalPaisa += loanInterestPaisa;
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

    // ─── Chapter VI-A deductions — shared deduction engine ────────────
    // The engine derives EVERY Chapter VI-A bucket from the user's real
    // records (80C with EPF/small-savings/ELSS/SGB/LIC/loan-principal,
    // 80CCD(1B) NPS, 80D via sr-citizen helper INCLUDING health_insurance_
    // policies, 80G at eligible amount, plus 24B/80EEA and any other
    // manual sections), applying every cap once. This replaces the
    // previous inline block that read raw tax_deductions and missed the
    // asset-backed sources.
    //
    // IMPORTANT — house-property head double-count avoidance: regime-
    // compare folds home-loan interest (24B) and 80EEA into the INCOME-
    // side house-property head above (sec24bTotalPaisa / sec80eeaTotalPaisa
    // reduce oldHpForSlab). So we must EXCLUDE the engine's 24B + 80EEA
    // buckets from the Chapter VI-A deduction total here — otherwise the
    // home-loan interest would be deducted twice (once on income, once as
    // a deduction). The engine still surfaces them in its buckets; we
    // simply don't add those two to oldDeductionsPaisa.
    const engineDeductions = await deriveDeductions(userId, fy, {
      adjustedGrossForEightyGPaisa: Math.max(0, oldGrossSlab),
    });
    const INCOME_SIDE_SECTIONS = new Set(['24B', '80EEA']);
    const oldDeductionsPaisa = Object.entries(engineDeductions.buckets)
      .filter(([sec]) => !INCOME_SIDE_SECTIONS.has(sec))
      .reduce((s, [, b]) => s + b.appliedPaisa, 0);

    const newDeductionsPaisa = engineDeductions.newRegimeTotalPaisa;

    // Surfaced for the UI's expandable "Deductions applied" line — the
    // engine's per-section breakdown, minus the income-side sections.
    const deductionBreakdown = engineDeductions.breakdown.filter(
      (b) => !b.label.includes('24(b)') && !b.label.includes('80EEA'),
    );
    // 80C bucket detail for the existing eightyC response shape.
    const eightyCBucket = engineDeductions.buckets['80C'];
    const manualEightyCPaisa = deductions
      .filter((r) => r.section === '80C')
      .reduce((s, r) => s + (r.amountPaisa ?? 0), 0);
    const loanPrincipal80cPaisa = loanDeductions.totalPrincipalPaisa;
    const combinedEightyCRaw = (eightyCBucket?.sources ?? []).reduce(
      (s, x) => s + x.amountPaisa,
      0,
    );
    const eightyCApplied = eightyCBucket?.appliedPaisa ?? 0;
    const EIGHTY_C_CAP_PAISA = 1_50_000 * 100;

    const result = compareRegimes({
      grossIncomePaisa: Math.max(0, oldGrossSlab),
      oldRegimeDeductionsPaisa: oldDeductionsPaisa,
      newRegimeDeductionsPaisa: newDeductionsPaisa,
      oldSlabs: slabsByRegime('OLD'),
      oldConfig: configByRegime('OLD'),
      newSlabs: slabsByRegime('NEW'),
      newConfig: configByRegime('NEW'),
      fy,
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
      regime: 'NEW',
      fy,
    });
    // ─── Capital gains tax (regime-agnostic flat rates) ─────────────
    // CG tax is computed per-row when the user files the gain (12.5%
    // for equity LTCG post-2024-budget, 20% for property LTCG indexed,
    // etc.) — see capital_gains.tax_amount. CG tax is NOT subject to
    // the 87A rebate (slab-only) and is added on top of slab tax. Cess
    // (4%) re-applies on the combined slab+CG total.
    //
    // Surcharge interaction (per-band on aggregate income) is left
    // approximated to slab-only for now — most users won't cross a
    // band boundary because of CG alone; if they do, the slab-only
    // surcharge under-counts by a few thousand. Documented limitation.
    // Aggregate (authoritative) CG tax — equity LTCG/STCG net all gains
    // and losses for the FY, applying the sec-112A annual exemption ONCE.
    // Replaces the per-row sum (caps.reduce on taxAmount) which over-counted
    // because it ignored netting and applied the exemption per transaction.
    const capitalGainsAgg = computeAggregateCapitalGainsTax(
      caps.map((r) => ({
        assetType: r.assetType,
        holdingPeriod: r.holdingPeriod,
        saleDate: r.saleDate,
        capitalGain: r.capitalGain,
        taxAmount: r.taxAmount ?? 0,
      })),
      fy,
    );
    const capitalGainsTaxPaisa = capitalGainsAgg.totalTaxPaisa;
    const CESS_PCT = 4;
    const capitalGainsTaxWithCessPaisa = Math.round(
      capitalGainsTaxPaisa * (1 + CESS_PCT / 100),
    );
    const oldTotal = result.old.totalTaxPaisa + capitalGainsTaxWithCessPaisa;
    const newTotal = newResult.totalTaxPaisa + capitalGainsTaxWithCessPaisa;
    const recommendation: 'NEW' | 'OLD' = newTotal <= oldTotal ? 'NEW' : 'OLD';
    const savingsPaisa = Math.abs(newTotal - oldTotal);

    return NextResponse.json({
      fy,
      income: {
        salary: salaryPaisa,
        salarySource: salaryResolved.source,
        salaryDetail: salaryResolved.detail,
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
        // Engine-derived per-section bucket detail (appliedPaisa post-cap
        // + pre-cap sources) for the expandable UI.
        buckets: engineDeductions.buckets,
        // Per-section breakdown that sums to oldRegime — drives the
        // expandable "Deductions applied" line. Income-side 24(b)/80EEA
        // are excluded (they reduce the house-property head, not VI-A).
        breakdown: deductionBreakdown,
        // Sprint 5.9c — 80C breakdown after cap application (engine-sourced).
        eightyC: {
          manualPaisa: manualEightyCPaisa,
          fromLoansPaisa: loanPrincipal80cPaisa,
          combinedRawPaisa: combinedEightyCRaw,
          appliedPaisa: eightyCApplied,
          capPaisa: EIGHTY_C_CAP_PAISA,
          overCapPaisa: Math.max(0, combinedEightyCRaw - EIGHTY_C_CAP_PAISA),
        },
      },
      // Sprint 5.9c — loan-derived deductions detail. Surfaces the
      // per-liability split so the /tax page can show "from your
      // HDFC home loan: ₹X principal, ₹Y interest".
      loanDeductions: {
        totalInterestPaisa: loanDeductions.totalInterestPaisa,
        totalPrincipalPaisa: loanDeductions.totalPrincipalPaisa,
        perLiability: loanDeductions.perLiability,
      },
      comparison: {
        // Augment each regime result with the CG tax add-on so the UI
        // can render it as a line item beneath the slab tax. Keeping
        // the regime object's existing fields untouched preserves
        // backward-compat (slab tax computed exactly as before).
        old: {
          ...result.old,
          capitalGainsTaxPaisa,
          capitalGainsCessPaisa: capitalGainsTaxWithCessPaisa - capitalGainsTaxPaisa,
          capitalGainsTotalPaisa: capitalGainsTaxWithCessPaisa,
          totalTaxPaisa: oldTotal, // overrides the slab-only total
        },
        new: {
          ...newResult,
          capitalGainsTaxPaisa,
          capitalGainsCessPaisa: capitalGainsTaxWithCessPaisa - capitalGainsTaxPaisa,
          capitalGainsTotalPaisa: capitalGainsTaxWithCessPaisa,
          totalTaxPaisa: newTotal,
        },
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
