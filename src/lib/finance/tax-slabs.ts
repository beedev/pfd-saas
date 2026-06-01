/**
 * Indian income-tax computation engine — Sprint 4 Phase 1.
 *
 * Pure functions over slab + regime-config data fetched from the DB.
 * Caller is responsible for loading the slabs/config rows for the FY +
 * regime in question; this lib computes tax given that data + the
 * user's gross income + applicable deductions.
 *
 * Flow:
 *   1. Subtract standard deduction from gross → adjusted gross
 *   2. Subtract section-80 deductions (only for OLD regime — NEW
 *      regime disallows most deductions other than 80CCD(2) employer
 *      NPS, which the caller can pass in via `deductionsPaisa` for
 *      either regime; for NEW pass only the eligible ones)
 *   3. Compute slab tax on the taxable income
 *   4. Apply Section 87A rebate (capped at the smaller of rebate_max
 *      and the computed tax)
 *   5. Add 4% Health & Education Cess on (tax - rebate)
 *   6. Result is total tax payable for the FY
 *
 * Edge cases handled:
 *   • Top-slab upperPaisa is NULL ("∞") — use Infinity in math
 *   • Negative taxable income (very high deductions vs low gross) → 0 tax
 *   • Rebate floors at 0; never negative
 *   • Slabs are inclusive lower, exclusive upper (per govt convention)
 *
 * Not yet handled (deferred to Sprint 4.5 / later):
 *   • Surcharge brackets for high income (>50L, >1Cr, etc.)
 *   • Marginal relief on surcharge
 *   • Capital gains separately taxed (LTCG/STCG slabs)
 *   • AMT (Alternative Minimum Tax) for old regime
 */

export interface TaxSlabRow {
  slabOrder: number;
  lowerPaisa: number;
  /** NULL in DB → encoded as null here; means open-ended. */
  upperPaisa: number | null;
  ratePct: number;
}

export interface TaxRegimeConfigRow {
  standardDeductionPaisa: number;
  rebate87aThresholdPaisa: number;
  rebate87aMaxPaisa: number;
  /** Typically 4 (Health & Education Cess). */
  cessPct: number;
}

export interface TaxComputeInput {
  /** Gross annual income in paisa, before any deductions. */
  grossIncomePaisa: number;
  /** Section-80 / chapter VI-A deductions in paisa. Caller's
   *  responsibility to pass only what's eligible for the chosen regime
   *  (NEW regime disallows most). */
  deductionsPaisa: number;
  slabs: TaxSlabRow[];
  config: TaxRegimeConfigRow;
}

export interface TaxComputeResult {
  /** Income after standard deduction + section-80 deductions. */
  taxablePaisa: number;
  /** Slab tax before rebate or cess. */
  taxBeforeRebatePaisa: number;
  /** 87A rebate applied (0 if income exceeds threshold). */
  rebatePaisa: number;
  /** Tax after rebate, before cess. */
  taxAfterRebatePaisa: number;
  /** 4% (or whatever cess_pct is) on taxAfterRebate. */
  cessPaisa: number;
  /** Final total tax owed = taxAfterRebate + cess. */
  totalTaxPaisa: number;
  /** Effective tax rate as % of gross — useful for headline display. */
  effectiveRatePct: number;
}

/**
 * Apply a slab schedule to a taxable income. Returns the tax owed
 * before any rebate or cess.
 *
 * Slabs are pre-sorted by slab_order. For each slab we tax the portion
 * of income that falls within its [lower, upper) range at the slab's
 * rate. The top slab has upperPaisa=null (open-ended).
 */
function computeSlabTax(taxablePaisa: number, slabs: TaxSlabRow[]): number {
  if (taxablePaisa <= 0 || slabs.length === 0) return 0;

  const sorted = [...slabs].sort((a, b) => a.slabOrder - b.slabOrder);
  let tax = 0;

  for (const slab of sorted) {
    const lower = slab.lowerPaisa;
    const upper = slab.upperPaisa ?? Infinity;
    if (taxablePaisa <= lower) break;

    const portion = Math.min(taxablePaisa, upper) - lower;
    if (portion <= 0) continue;
    tax += (portion * slab.ratePct) / 100;
  }

  return Math.round(tax);
}

export function computeTax(input: TaxComputeInput): TaxComputeResult {
  const { grossIncomePaisa, deductionsPaisa, slabs, config } = input;

  // 1. Standard deduction
  const afterStdDed = Math.max(0, grossIncomePaisa - config.standardDeductionPaisa);

  // 2. Section-80 / chapter VI-A deductions
  const taxablePaisa = Math.max(0, afterStdDed - deductionsPaisa);

  // 3. Slab tax
  const taxBeforeRebatePaisa = computeSlabTax(taxablePaisa, slabs);

  // 4. Section 87A rebate — kicks in only when taxable income is at
  // or below the threshold. Capped at the smaller of rebate_max and
  // the computed slab tax.
  const eligibleFor87A = taxablePaisa <= config.rebate87aThresholdPaisa;
  const rebatePaisa = eligibleFor87A
    ? Math.min(config.rebate87aMaxPaisa, taxBeforeRebatePaisa)
    : 0;

  const taxAfterRebatePaisa = Math.max(0, taxBeforeRebatePaisa - rebatePaisa);

  // 5. Health & Education Cess (4% in current law)
  const cessPaisa = Math.round((taxAfterRebatePaisa * config.cessPct) / 100);

  // 6. Final tax owed
  const totalTaxPaisa = taxAfterRebatePaisa + cessPaisa;

  // Effective rate against GROSS (not taxable) — answers "what % of
  // my income goes to tax?" — the most useful headline number.
  const effectiveRatePct =
    grossIncomePaisa > 0 ? (totalTaxPaisa / grossIncomePaisa) * 100 : 0;

  return {
    taxablePaisa,
    taxBeforeRebatePaisa,
    rebatePaisa,
    taxAfterRebatePaisa,
    cessPaisa,
    totalTaxPaisa,
    effectiveRatePct,
  };
}

/**
 * Convenience: compute tax for BOTH regimes side-by-side, given a
 * single gross income and BOTH sets of deductions (since OLD regime
 * accepts more deductions than NEW).
 *
 * Returns recommendation = the regime with the LOWER total tax. When
 * tax is identical, prefers NEW (it's the govt default and has fewer
 * filing complications).
 */
export interface RegimeCompareInput {
  grossIncomePaisa: number;
  /** Deductions eligible under OLD regime (full Section 80 + HRA + etc.). */
  oldRegimeDeductionsPaisa: number;
  /** Deductions eligible under NEW regime (basically nothing other than
   *  80CCD(2) employer NPS contribution). */
  newRegimeDeductionsPaisa: number;
  oldSlabs: TaxSlabRow[];
  oldConfig: TaxRegimeConfigRow;
  newSlabs: TaxSlabRow[];
  newConfig: TaxRegimeConfigRow;
}

export interface RegimeCompareResult {
  old: TaxComputeResult;
  new: TaxComputeResult;
  recommendation: 'NEW' | 'OLD';
  /** Positive = how much you save by picking `recommendation`. */
  savingsPaisa: number;
}

export function compareRegimes(input: RegimeCompareInput): RegimeCompareResult {
  const oldResult = computeTax({
    grossIncomePaisa: input.grossIncomePaisa,
    deductionsPaisa: input.oldRegimeDeductionsPaisa,
    slabs: input.oldSlabs,
    config: input.oldConfig,
  });
  const newResult = computeTax({
    grossIncomePaisa: input.grossIncomePaisa,
    deductionsPaisa: input.newRegimeDeductionsPaisa,
    slabs: input.newSlabs,
    config: input.newConfig,
  });

  // Pick the lower-tax regime. Tie-break NEW (govt default + simpler).
  const recommendation: 'NEW' | 'OLD' =
    newResult.totalTaxPaisa <= oldResult.totalTaxPaisa ? 'NEW' : 'OLD';
  const savingsPaisa = Math.abs(
    newResult.totalTaxPaisa - oldResult.totalTaxPaisa,
  );

  return { old: oldResult, new: newResult, recommendation, savingsPaisa };
}
