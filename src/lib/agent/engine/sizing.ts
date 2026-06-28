/**
 * Position sizing helpers (paisa). Two methods used by the strategies:
 *  - equal-weight: split available cash across N target slots (momentum/rotation)
 *  - risk-based: risk a fixed % of sleeve equity over a stop distance (trend/MR)
 * MF buys allow fractional units; stocks/futures buy whole units/lots.
 */

export interface SizingOpts {
  fractional: boolean; // MF = true (fractional units), else whole units
}

/** Spendable cash after keeping a buffer. */
export function spendable(cashPaisa: number, bufferPaisa: number): number {
  return Math.max(0, cashPaisa - bufferPaisa);
}

/** Equal-weight: budget = min(perSlot, cash); qty by price. */
export function equalWeightQty(
  budgetPaisa: number,
  pricePaisa: number,
  contractMultiplier: number,
  opts: SizingOpts,
): number {
  const unitCost = Math.round(pricePaisa * contractMultiplier);
  if (budgetPaisa <= 0 || unitCost <= 0) return 0;
  const raw = budgetPaisa / unitCost;
  return opts.fractional ? Math.floor(raw * 1000) / 1000 : Math.floor(raw);
}

/**
 * Risk-based: units such that a move of `stopDistancePaisa` against us loses
 * ~`riskPaisa`. Capped by the budget. Whole units (stocks/futures).
 */
export function riskBasedQty(
  riskPaisa: number,
  stopDistancePaisa: number,
  pricePaisa: number,
  contractMultiplier: number,
  budgetPaisa: number,
): number {
  if (stopDistancePaisa <= 0 || pricePaisa <= 0) return 0;
  const byRisk = riskPaisa / (stopDistancePaisa * contractMultiplier);
  const unitCost = Math.round(pricePaisa * contractMultiplier);
  const byBudget = unitCost > 0 ? budgetPaisa / unitCost : 0;
  return Math.max(0, Math.floor(Math.min(byRisk, byBudget)));
}
