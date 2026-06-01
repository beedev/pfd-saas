/**
 * Cost Inflation Index (CII) indexed-cost calculator — Sprint 5.1c.
 *
 * Pure compute. Used when the taxpayer elects the pre-Jul-23-2024
 * indexed treatment for non-equity LTCG (e.g. property, debt MF,
 * gold). Post-Jul-2024 reform removed indexation for most assets
 * and dropped the rate from 20% to 12.5% — taxpayer can pick the
 * pre-reform treatment if it works out cheaper.
 *
 * Formula: indexedCost = purchasePrice × (saleCii / purchaseCii)
 *
 * Returns the indexed acquisition cost. The caller subtracts this
 * from sale price to get the indexed LTCG.
 *
 * Reference: Yeswanth TaxCalc "Cost Inflation Index" sheet plus
 * the "Cap Gains - Property&Debt" computation.
 *
 * Caveats:
 *  • Requires CII rows for BOTH purchase and sale FYs. Caller
 *    fetches from `cost_inflation_index` table.
 *  • If either FY is missing → throws. Caller's responsibility to
 *    handle (probably user error: purchase pre-2001-02 needs
 *    "fair market value as on 1 Apr 2001" rebasing — not modelled
 *    here).
 *  • Indexed cost is reported in paisa (integer round).
 */

export interface IndexedCostInput {
  purchasePricePaisa: number;
  /** FY string (e.g. "2015-16") for purchase. */
  purchaseFy: string;
  /** FY string for sale. */
  saleFy: string;
  /** CII table — list of (fy, indexValue) rows fetched from DB.
   *  Caller can pass the full table; we look up only the two we
   *  need. */
  ciiTable: Array<{ fy: string; indexValue: number }>;
}

export function indexedCost(input: IndexedCostInput): number {
  const { purchasePricePaisa, purchaseFy, saleFy, ciiTable } = input;

  const purchase = ciiTable.find((r) => r.fy === purchaseFy);
  const sale = ciiTable.find((r) => r.fy === saleFy);

  if (!purchase) {
    throw new Error(
      `CII row missing for purchase FY ${purchaseFy}. Pre-2001 purchases require fair-market-value rebasing — not modelled here.`,
    );
  }
  if (!sale) {
    throw new Error(`CII row missing for sale FY ${saleFy}.`);
  }
  if (purchase.indexValue <= 0) {
    throw new Error(`CII for ${purchaseFy} is 0 — invalid seed data.`);
  }

  return Math.round((purchasePricePaisa * sale.indexValue) / purchase.indexValue);
}
