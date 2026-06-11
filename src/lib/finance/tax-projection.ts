/**
 * Tax-projection helper — feeds the advance-tax planner.
 *
 * Thin wrapper over the shared `computeFyTaxComparison` engine so the
 * advance-tax projection is byte-identical to /api/tax/regime-compare.
 * (It used to be a hand-copied parallel that silently missed Form-16
 * salary, 44ADA presumptive, the deduction engine and HRA — producing a
 * materially wrong advance-tax figure. That duplication is gone.)
 */

import {
  computeFyTaxComparison,
  isComputeError,
} from './tax-compute';

export interface TaxProjection {
  fy: string;
  grossIncomePaisa: number;
  oldDeductionsPaisa: number;
  newDeductionsPaisa: number;
  /** Recommended regime: 'NEW' | 'OLD'. */
  recommendation: 'NEW' | 'OLD';
  /** Projected annual tax under the recommended regime (slab + CG, cess in). */
  projectedAnnualTaxPaisa: number;
  /** Effective tax rate under the recommended regime. */
  effectiveRatePct: number;
}

/** Project annual tax for a user / FY via the shared comparison engine.
 *  Returns null when the FY format is bad or slab data isn't seeded. */
export async function projectAnnualTax(
  userId: string,
  fy: string,
): Promise<TaxProjection | null> {
  const result = await computeFyTaxComparison(userId, fy);
  if (isComputeError(result)) return null;

  const recommendation = result.comparison.recommendation;
  const grossIncomePaisa = recommendation === 'NEW' ? result.income.grossNew : result.income.gross;
  const projectedAnnualTaxPaisa = result.recommendedTotalTaxPaisa;
  const effectiveRatePct =
    grossIncomePaisa > 0
      ? Number(((projectedAnnualTaxPaisa / grossIncomePaisa) * 100).toFixed(2))
      : 0;

  return {
    fy: result.fy,
    grossIncomePaisa,
    oldDeductionsPaisa: result.deductions.oldRegime,
    newDeductionsPaisa: result.deductions.newRegime,
    recommendation,
    projectedAnnualTaxPaisa,
    effectiveRatePct,
  };
}
