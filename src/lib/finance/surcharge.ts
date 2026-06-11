/**
 * Surcharge brackets + marginal relief — Sprint 5.1b.
 *
 * Surcharge sits between the 87A rebate and the 4% cess in the
 * Indian income-tax computation:
 *
 *   tax_after_rebate + surcharge − marginal_relief → apply cess →
 *   total_tax
 *
 * Brackets (FY 2024-25 onwards, post-Finance Act 2023 reform that
 * capped NEW regime at 25%):
 *
 *   Taxable income      | OLD regime | NEW regime
 *   ─────────────────── | ────────── | ──────────
 *   ≤ ₹50L              | 0%         | 0%
 *   ₹50L–₹1Cr           | 10%        | 10%
 *   ₹1Cr–₹2Cr           | 15%        | 15%
 *   ₹2Cr–₹5Cr           | 25%        | 25%
 *   > ₹5Cr              | 37%        | 25% (capped)
 *
 * Marginal relief: at each threshold the surcharge bump cannot push
 * total tax above (tax_at_threshold + income_above_threshold). I.e.
 * crossing a threshold by ₹1k shouldn't add lakhs in tax.
 *
 * Reference: Yeswanth TaxCalc "IT 2026-27" surcharge block. The govt
 * has not adjusted these brackets since FY 2023-24.
 */

export type Regime = 'OLD' | 'NEW';

export interface SurchargeBracket {
  lowerPaisa: number;
  ratePct: number;
}

const FIFTY_LAKH = 50_00_000 * 100;
const ONE_CRORE = 1_00_00_000 * 100;
const TWO_CRORE = 2_00_00_000 * 100;
const FIVE_CRORE = 5_00_00_000 * 100;

const OLD_BRACKETS: SurchargeBracket[] = [
  { lowerPaisa: 0, ratePct: 0 },
  { lowerPaisa: FIFTY_LAKH, ratePct: 10 },
  { lowerPaisa: ONE_CRORE, ratePct: 15 },
  { lowerPaisa: TWO_CRORE, ratePct: 25 },
  { lowerPaisa: FIVE_CRORE, ratePct: 37 },
];

const NEW_BRACKETS: SurchargeBracket[] = [
  { lowerPaisa: 0, ratePct: 0 },
  { lowerPaisa: FIFTY_LAKH, ratePct: 10 },
  { lowerPaisa: ONE_CRORE, ratePct: 15 },
  { lowerPaisa: TWO_CRORE, ratePct: 25 },
  { lowerPaisa: FIVE_CRORE, ratePct: 25 },
];

function findBracket(taxableIncomePaisa: number, brackets: SurchargeBracket[]): SurchargeBracket {
  let active = brackets[0];
  for (const b of brackets) {
    if (taxableIncomePaisa >= b.lowerPaisa) active = b;
    else break;
  }
  return active;
}

export interface SurchargeInput {
  taxableIncomePaisa: number;
  taxBeforeSurchargePaisa: number;
  /** Slab tax at the bracket entry threshold (used for marginal
   *  relief). The caller computes by running computeSlabTax at the
   *  threshold income. Surcharge at threshold = 0 by definition
   *  (the bracket starts there), so tax_at_threshold is pure slab. */
  taxAtThresholdPaisa: number;
  regime: Regime;
  fy: string;
}

export interface SurchargeResult {
  surchargePaisa: number;
  marginalReliefPaisa: number;
  effectiveSurchargePaisa: number;
}

export function computeSurcharge(
  input: SurchargeInput,
  brackets?: SurchargeBracket[],
): SurchargeResult {
  const { taxableIncomePaisa, taxBeforeSurchargePaisa, taxAtThresholdPaisa, regime } = input;

  if (taxableIncomePaisa <= FIFTY_LAKH) {
    return { surchargePaisa: 0, marginalReliefPaisa: 0, effectiveSurchargePaisa: 0 };
  }

  // Injected FY-configurable brackets override the module defaults. When
  // omitted, fall back to the regime-appropriate hardcoded arrays.
  const activeBrackets = brackets ?? (regime === 'OLD' ? OLD_BRACKETS : NEW_BRACKETS);
  const bracket = findBracket(taxableIncomePaisa, activeBrackets);

  if (bracket.ratePct === 0) {
    return { surchargePaisa: 0, marginalReliefPaisa: 0, effectiveSurchargePaisa: 0 };
  }

  const surchargePaisa = Math.round((taxBeforeSurchargePaisa * bracket.ratePct) / 100);

  // Marginal relief: total tax + surcharge at THIS income shouldn't
  // exceed (slab tax at threshold + income_above_threshold). Caller
  // passes taxAtThresholdPaisa = computeSlabTax(thresholdPaisa).
  const incomeAboveThreshold = taxableIncomePaisa - bracket.lowerPaisa;
  const totalTaxNoRelief = taxBeforeSurchargePaisa + surchargePaisa;
  const reliefCeiling = taxAtThresholdPaisa + incomeAboveThreshold;

  const marginalReliefPaisa = Math.max(0, totalTaxNoRelief - reliefCeiling);
  const effectiveSurchargePaisa = surchargePaisa - marginalReliefPaisa;

  return { surchargePaisa, marginalReliefPaisa, effectiveSurchargePaisa };
}

/** Returns the active bracket's lower threshold for the income — used
 *  by the regime-compare caller to compute taxAtThresholdPaisa. */
export function bracketThresholdForIncome(
  taxableIncomePaisa: number,
  regime: Regime,
): number {
  if (taxableIncomePaisa <= FIFTY_LAKH) return 0;
  const brackets = regime === 'OLD' ? OLD_BRACKETS : NEW_BRACKETS;
  return findBracket(taxableIncomePaisa, brackets).lowerPaisa;
}
