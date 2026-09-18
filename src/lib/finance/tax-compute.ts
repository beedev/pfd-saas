/**
 * Shared FY tax-comparison engine.
 *
 * THE single source of truth for "given a user + FY, what is the slab-able
 * income, the Chapter VI-A deductions, and the OLD-vs-NEW total tax". Both
 * /api/tax/regime-compare (interactive comparison card) and the advance-tax
 * projection (lib/finance/tax-projection) call this so the two can never
 * drift — historically the projection was a hand-copied parallel that
 * silently missed Form-16 salary, 44ADA presumptive, the deduction engine
 * and HRA, producing a materially wrong advance-tax number.
 *
 * Income assembly mirrors the documented regime-compare rules:
 *   • salary  — Form-16-authoritative gross (resolver); HRA exemption from
 *     books components, falling back to Form 16 Part B's reported figure.
 *   • business — presumptive deemed profit (44AD/44ADA/44AE) when declared,
 *     else full FY GST FINAL receipts.
 *   • house property — per-regime head (rent − 30% std − 24(b) − 80EEA,
 *     loan-derived 24(b) routed to the first self-occupied property).
 *   • Chapter VI-A — the shared deduction engine, with income-side 24(b)/
 *     80EEA excluded to avoid double-counting against the HP head.
 *   • capital gains — aggregate flat-rate tax, added on top of slab tax.
 *
 * Multi-tenant: userId scopes every user table read.
 */

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
import { compareRegimes, computeTax } from './tax-slabs';
import { computeHraExemption } from './hra-exemption';
import {
  computeSection24bDeduction,
  isDisbursedOnOrAfterVintageCutoff,
} from './section-24b';
import { computeSection80EeaDeduction } from './section-80eea';
import { aggregateLoanTaxDeductions } from './loan-tax';
import { deriveDeductions } from './deduction-engine';
import { resolveSalaryIncome } from './form16-tax-source';
import { financialYearBoundsIso } from './tax-constants';
import { computeAggregateCapitalGainsTax } from './capital-gains-tax';
import { getTaxRules } from './tax-rules';

const EIGHTY_C_CAP_PAISA = 1_50_000 * 100;
const TWO_LAKH = 2_00_000 * 100;
const CESS_PCT = 4;
const INCOME_SIDE_SECTIONS = new Set(['24B', '80EEA']);

export type ComputeError = { error: string; status: number };

export interface FyTaxComparison {
  fy: string;
  income: {
    salary: number;
    salarySource: string;
    salaryDetail: string;
    hraExemption: number;
    exemptAllowances: number;
    other: number;
    business: number;
    /** How `business` was derived. GROSS_RECEIPTS means no presumptive
     *  declaration exists for this FY, so receipts are taxed in full — see
     *  `warnings`. */
    businessBasis: 'PRESUMPTIVE' | 'GROSS_RECEIPTS' | 'NONE';
    businessDetail: string;
    businessGrossReceipts: number;
    rentalGross: number;
    rentalStdMaintenance: number;
    sec24b: number;
    sec80eea: number;
    oldHpNet: number;
    newHpNet: number;
    gross: number;
    grossNew: number;
    capitalGainsTaxable: number;
  };
  deductions: {
    oldRegime: number;
    newRegime: number;
    buckets: Awaited<ReturnType<typeof deriveDeductions>>['buckets'];
    breakdown: Awaited<ReturnType<typeof deriveDeductions>>['breakdown'];
    eightyC: {
      manualPaisa: number;
      fromLoansPaisa: number;
      combinedRawPaisa: number;
      appliedPaisa: number;
      capPaisa: number;
      overCapPaisa: number;
    };
  };
  loanDeductions: {
    totalInterestPaisa: number;
    totalPrincipalPaisa: number;
    perLiability: unknown[];
  };
  comparison: {
    old: Record<string, unknown>;
    new: Record<string, unknown>;
    recommendation: 'NEW' | 'OLD';
    savingsPaisa: number;
  };
  /** Recommended-regime total tax (slab + CG, cess included). The figure
   *  advance-tax projects installments against. */
  recommendedTotalTaxPaisa: number;
  /** Conditions that make the numbers above wrong or incomplete. The UI MUST
   *  surface these — a plausible-looking figure with a hidden caveat is worse
   *  than a visible gap. */
  warnings: string[];
}

/** paisa -> "₹12,34,567" for warning text. Indian digit grouping. */
function rupees(paisa: number): string {
  return '₹' + Math.round(paisa / 100).toLocaleString('en-IN');
}

function isError(x: unknown): x is ComputeError {
  return typeof x === 'object' && x !== null && 'error' in x && 'status' in x;
}
export { isError as isComputeError };

/**
 * Compute the full OLD-vs-NEW tax comparison for a user/FY. Returns a
 * `ComputeError` (with HTTP status) when FY format is bad or slab data is
 * unseeded, so the route can pass the status straight through.
 */
export async function computeFyTaxComparison(
  userId: string,
  fy: string,
): Promise<FyTaxComparison | ComputeError> {
  const bounds = /^\d{4}-\d{2}$/.test(fy) ? financialYearBoundsIso(fy) : null;
  if (!bounds) return { error: 'Invalid fy format, use YYYY-YY', status: 400 };

  const [slabs, configs] = await Promise.all([
    db.select().from(taxSlabs).where(eq(taxSlabs.fy, fy)),
    db.select().from(taxRegimeConfig).where(eq(taxRegimeConfig.fy, fy)),
  ]);
  if (slabs.length === 0 || configs.length < 2) {
    return { error: `No slab data for FY ${fy}. Seed first.`, status: 404 };
  }

  // FY-configurable tax rules (deduction caps, surcharge brackets, CG
  // rates, presumptive %) — fetched ONCE here and injected into the pure
  // compute libs below. Falls back to the historical constants when no
  // tax_rules row exists, so results stay byte-identical to the seed.
  const rules = await getTaxRules(fy);
  const slabsByRegime = (regime: TaxRegime) => slabs.filter((s) => s.regime === regime);
  const configByRegime = (regime: TaxRegime) => {
    const cfg = configs.find((c) => c.regime === regime);
    if (!cfg) throw new Error(`Missing config for regime ${regime} in FY ${fy}`);
    return cfg;
  };

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
      .where(and(eq(otherSourcesIncome.userId, userId), eq(otherSourcesIncome.financialYear, fy))),
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
      .where(and(eq(taxDeductions.userId, userId), eq(taxDeductions.financialYear, fy))),
    db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1),
    db.select().from(liabilities).where(eq(liabilities.userId, userId)),
    db
      .select()
      .from(presumptiveIncome)
      .where(and(eq(presumptiveIncome.userId, userId), eq(presumptiveIncome.fy, fy))),
  ]);

  const prefs = prefsRows[0];
  const isMetro = prefs?.metroCity ?? true;

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
      ? { totalInterestPaisa: 0, totalPrincipalPaisa: 0, perLiability: [] as unknown[] }
      : loanAgg;

  // ─── Salary + HRA ────────────────────────────────────────────────
  const salaryPaisa = salaryResolved.grossSalaryPaisa;
  let basicPlusDaTotalPaisa = 0;
  let hraReceivedTotalPaisa = 0;
  let rentPaidAnnualPaisa = 0;
  for (const r of salaries) {
    basicPlusDaTotalPaisa += (r.basicPaisa ?? 0) + (r.daPaisa ?? 0);
    hraReceivedTotalPaisa += r.hraReceivedPaisa ?? 0;
    rentPaidAnnualPaisa += (r.rentPaidMonthlyPaisa ?? 0) * 12;
  }
  const hraFromBooksPaisa = computeHraExemption({
    hraReceivedPaisa: hraReceivedTotalPaisa,
    basicPlusDaPaisa: basicPlusDaTotalPaisa,
    rentPaidPaisa: rentPaidAnnualPaisa,
    isMetro,
  });
  const hraExemptionPaisa =
    hraFromBooksPaisa > 0 ? hraFromBooksPaisa : (salaryResolved.hraExemptionPaisa ?? 0);

  // Exempt salary allowances BEYOND HRA — chiefly leave encashment on
  // retirement/resignation (sec 10(10AA), cap ₹25L since Aug-2023), also gratuity /
  // commuted pension. Crucially, the NEW regime KEEPS these retirement exemptions (it
  // strips HRA/LTA/most Ch.VI-A, not 10(10AA)). The employer nets them out of the
  // *taxable* salary figure but they still sit in *gross*; the engine was using gross,
  // so it silently taxed them. Recover them as (gross − taxable − employer-HRA), and
  // only from the Form 16 split (books lump exemptions ambiguously). Applies to BOTH
  // regimes.
  const exemptAllowancesPaisa = salaryResolved.source === 'form16'
    ? Math.max(0, salaryPaisa - salaryResolved.valuePaisa - (salaryResolved.hraExemptionPaisa ?? 0))
    : 0;

  // ─── Other sources ───────────────────────────────────────────────
  const otherPaisa = others
    .filter((r) => !r.isTaxExempt)
    .reduce((s, r) => s + (r.amountPaisa ?? 0), 0);

  // ─── Business: presumptive deemed profit, else full GST receipts ──
  //
  // The fallback is a LAST RESORT and must never be silent. Presumptive
  // treatment (44AD/44ADA/44AE) applies only when the user has declared it for
  // THIS fy — it is a per-year election with its own eligibility conditions, so
  // we cannot infer it from a prior year.
  //
  // When there is no declaration we fall back to gross receipts, which is not a
  // profit figure under any regime: a presumptive filer would be taxed on 50%
  // (44ADA) or 6-8% (44AD), and a regular filer would deduct expenses. Taxing
  // 100% of receipts therefore overstates tax, and it looks entirely plausible
  // on screen — exactly the silent-wrongness that let the AMFI NAV bug run for
  // three weeks. So we tag the basis and emit a warning the UI must surface.
  const gstReceiptsPaisa = gstInvoices.reduce((s, r) => s + (r.taxableAmount ?? 0), 0);
  const presumptiveDeclaredPaisa = presumptiveRows.reduce(
    (s, r) => s + (r.declaredProfitPaisa ?? 0),
    0,
  );
  const presumptiveReceiptsPaisa = presumptiveRows.reduce(
    (s, r) => s + (r.grossReceiptsPaisa ?? 0),
    0,
  );
  const hasPresumptive = presumptiveRows.length > 0;
  const businessPaisa = hasPresumptive ? presumptiveDeclaredPaisa : gstReceiptsPaisa;

  const businessBasis: 'PRESUMPTIVE' | 'GROSS_RECEIPTS' | 'NONE' = hasPresumptive
    ? 'PRESUMPTIVE'
    : gstReceiptsPaisa > 0
      ? 'GROSS_RECEIPTS'
      : 'NONE';

  const businessWarnings: string[] = [];
  let businessDetail = 'No business or professional income for this FY.';
  if (businessBasis === 'PRESUMPTIVE') {
    const sections = [...new Set(presumptiveRows.map((r) => r.section))].join(', ');
    businessDetail =
      `Presumptive (${sections}): declared profit ${rupees(presumptiveDeclaredPaisa)}` +
      (presumptiveReceiptsPaisa > 0
        ? ` on receipts ${rupees(presumptiveReceiptsPaisa)}`
        : '');
  } else if (businessBasis === 'GROSS_RECEIPTS') {
    businessDetail =
      `Gross receipts ${rupees(gstReceiptsPaisa)} taxed in full — ` +
      `no presumptive declaration for FY ${fy}.`;
    businessWarnings.push(
      `Business income for FY ${fy} is your GROSS RECEIPTS (${rupees(gstReceiptsPaisa)}), ` +
        `not profit — you have not declared presumptive income for this year. Under 44ADA ` +
        `only 50% (${rupees(Math.round(gstReceiptsPaisa * 0.5))}) would be taxable; under ` +
        `44AD, 6-8%. Declare it for this FY, or record actual expenses, or this tax figure ` +
        `is overstated.`,
    );
  }

  // ─── House property head ─────────────────────────────────────────
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
      }, rules.sec24bSelfOccupiedCapPaisa, rules.sec24bPre1999CapPaisa);
      sec24bTotalPaisa += sec24b;
      sec80eeaTotalPaisa += computeSection80EeaDeduction({
        homeLoanInterestPaidPaisa: interestPaid,
        section24bDeductionPaisa: sec24b,
        isFirstHome: p.isFirstHome,
        stampValuePaisa: p.stampValuePaisa,
        carpetAreaSqft: p.carpetAreaSqft,
        loanDisbursedDate: p.homeLoanDisbursedDate,
      }, rules.sec80eeaCapPaisa);
    }
  }

  // Loan-derived 24(b) routed to the first self-occupied property.
  const loanInterestPaisa = loanDeductions.totalInterestPaisa;
  if (loanInterestPaisa > 0) {
    const firstSelfOccupied = properties.find((p) => p.isSelfOccupied);
    if (firstSelfOccupied) {
      const userInterest = firstSelfOccupied.homeLoanInterestPaidPaisa ?? 0;
      const post1999 = isDisbursedOnOrAfterVintageCutoff(firstSelfOccupied.homeLoanDisbursedDate);
      const oldContribution = computeSection24bDeduction({
        homeLoanInterestPaidPaisa: userInterest,
        isSelfOccupied: true,
        loanDisbursedAfter1Apr1999: post1999,
      }, rules.sec24bSelfOccupiedCapPaisa, rules.sec24bPre1999CapPaisa);
      const newContribution = computeSection24bDeduction({
        homeLoanInterestPaidPaisa: Math.max(userInterest, loanInterestPaisa),
        isSelfOccupied: true,
        loanDisbursedAfter1Apr1999: post1999,
      }, rules.sec24bSelfOccupiedCapPaisa, rules.sec24bPre1999CapPaisa);
      sec24bTotalPaisa += Math.max(0, newContribution - oldContribution);
    } else {
      sec24bTotalPaisa += loanInterestPaisa;
    }
  }

  const oldHpLossUncapped = sec24bTotalPaisa + sec80eeaTotalPaisa;
  const oldHpNet = rentalGrossPaisa - stdMaintenanceDeductionPaisa - oldHpLossUncapped;
  const oldHpForSlab = oldHpNet < 0 ? Math.max(oldHpNet, -TWO_LAKH) : oldHpNet;
  const newHpForSlab = letoutRentalGrossPaisa - letoutStdMaintPaisa;

  const capitalGainsTaxablePaisa = caps.reduce((s, r) => s + (r.taxableGain ?? 0), 0);

  // ─── Slab-able gross (per regime) ────────────────────────────────
  const oldGrossSlab =
    salaryPaisa - hraExemptionPaisa - exemptAllowancesPaisa + otherPaisa + businessPaisa + oldHpForSlab;
  const newGrossSlab = salaryPaisa - exemptAllowancesPaisa + otherPaisa + businessPaisa + newHpForSlab;

  // ─── Chapter VI-A via shared deduction engine ────────────────────
  const engineDeductions = await deriveDeductions(userId, fy, {
    adjustedGrossForEightyGPaisa: Math.max(0, oldGrossSlab),
  });
  const oldDeductionsPaisa = Object.entries(engineDeductions.buckets)
    .filter(([sec]) => !INCOME_SIDE_SECTIONS.has(sec))
    .reduce((s, [, b]) => s + b.appliedPaisa, 0);
  const newDeductionsPaisa = engineDeductions.newRegimeTotalPaisa;
  const deductionBreakdown = engineDeductions.breakdown.filter(
    (b) => !b.label.includes('24(b)') && !b.label.includes('80EEA'),
  );
  const eightyCBucket = engineDeductions.buckets['80C'];
  const manualEightyCPaisa = deductions
    .filter((r) => r.section === '80C')
    .reduce((s, r) => s + (r.amountPaisa ?? 0), 0);
  const loanPrincipal80cPaisa = loanDeductions.totalPrincipalPaisa;
  const combinedEightyCRaw = (eightyCBucket?.sources ?? []).reduce((s, x) => s + x.amountPaisa, 0);
  const eightyCApplied = eightyCBucket?.appliedPaisa ?? 0;

  // ─── Slab tax (OLD shares gross with compareRegimes; NEW recomputed) ──
  const result = compareRegimes({
    grossIncomePaisa: Math.max(0, oldGrossSlab),
    oldRegimeDeductionsPaisa: oldDeductionsPaisa,
    newRegimeDeductionsPaisa: newDeductionsPaisa,
    oldSlabs: slabsByRegime('OLD'),
    oldConfig: configByRegime('OLD'),
    newSlabs: slabsByRegime('NEW'),
    newConfig: configByRegime('NEW'),
    fy,
    oldSurchargeBrackets: rules.surchargeOldBrackets,
    newSurchargeBrackets: rules.surchargeNewBrackets,
  });
  const newResult = computeTax({
    grossIncomePaisa: Math.max(0, newGrossSlab),
    deductionsPaisa: newDeductionsPaisa,
    slabs: slabsByRegime('NEW'),
    config: configByRegime('NEW'),
    regime: 'NEW',
    fy,
    surchargeBrackets: rules.surchargeNewBrackets,
  });

  // ─── Capital gains (flat-rate, added on top, cess re-applied) ─────
  const capitalGainsAgg = computeAggregateCapitalGainsTax(
    caps.map((r) => ({
      assetType: r.assetType,
      holdingPeriod: r.holdingPeriod,
      saleDate: r.saleDate,
      capitalGain: r.capitalGain,
      taxAmount: r.taxAmount ?? 0,
    })),
    fy,
    rules.capitalGains,
  );
  const capitalGainsTaxPaisa = capitalGainsAgg.totalTaxPaisa;
  const capitalGainsTaxWithCessPaisa = Math.round(capitalGainsTaxPaisa * (1 + CESS_PCT / 100));
  const oldTotal = result.old.totalTaxPaisa + capitalGainsTaxWithCessPaisa;
  const newTotal = newResult.totalTaxPaisa + capitalGainsTaxWithCessPaisa;
  const recommendation: 'NEW' | 'OLD' = newTotal <= oldTotal ? 'NEW' : 'OLD';
  const savingsPaisa = Math.abs(newTotal - oldTotal);

  return {
    fy,
    income: {
      salary: salaryPaisa,
      salarySource: salaryResolved.source,
      salaryDetail: salaryResolved.detail,
      hraExemption: hraExemptionPaisa,
      exemptAllowances: exemptAllowancesPaisa,   // leave encashment 10(10AA) etc. (both regimes)
      other: otherPaisa,
      business: businessPaisa,
      businessBasis,
      businessDetail,
      businessGrossReceipts: gstReceiptsPaisa,
      rentalGross: rentalGrossPaisa,
      rentalStdMaintenance: stdMaintenanceDeductionPaisa,
      sec24b: sec24bTotalPaisa,
      sec80eea: sec80eeaTotalPaisa,
      oldHpNet: oldHpForSlab,
      newHpNet: newHpForSlab,
      gross: oldGrossSlab,
      grossNew: newGrossSlab,
      capitalGainsTaxable: capitalGainsTaxablePaisa,
    },
    deductions: {
      oldRegime: oldDeductionsPaisa,
      newRegime: newDeductionsPaisa,
      buckets: engineDeductions.buckets,
      breakdown: deductionBreakdown,
      eightyC: {
        manualPaisa: manualEightyCPaisa,
        fromLoansPaisa: loanPrincipal80cPaisa,
        combinedRawPaisa: combinedEightyCRaw,
        appliedPaisa: eightyCApplied,
        capPaisa: EIGHTY_C_CAP_PAISA,
        overCapPaisa: Math.max(0, combinedEightyCRaw - EIGHTY_C_CAP_PAISA),
      },
    },
    loanDeductions: {
      totalInterestPaisa: loanDeductions.totalInterestPaisa,
      totalPrincipalPaisa: loanDeductions.totalPrincipalPaisa,
      perLiability: loanDeductions.perLiability,
    },
    comparison: {
      old: {
        ...result.old,
        capitalGainsTaxPaisa,
        capitalGainsCessPaisa: capitalGainsTaxWithCessPaisa - capitalGainsTaxPaisa,
        capitalGainsTotalPaisa: capitalGainsTaxWithCessPaisa,
        totalTaxPaisa: oldTotal,
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
    recommendedTotalTaxPaisa: recommendation === 'NEW' ? newTotal : oldTotal,
    warnings: businessWarnings,
  };
}
