/**
 * Retirement tax bracket compute lib — Sprint 5.8b.
 *
 * Applies user-configurable slab brackets to a single year's
 * retirement-income gross. Each bracket is `{threshold, ratePct}`
 * where `threshold` is the LOWER bound of the band in PAISA (the
 * compute side uses paisa; the DB stores rupees for user readability,
 * and the route layer converts on the way in).
 *
 * Slab math (standard):
 *   • Sort brackets ascending by threshold.
 *   • For each band, take the slice of income that lives inside it,
 *     multiply by the band's rate.
 *   • Sum the per-band tax for the total.
 *
 * Why this is separate from `tax-slabs.ts`:
 *   • `tax-slabs.ts` models the GOVT Indian-FY slab system with std
 *     deduction, 87A rebate, cess, surcharge, etc. — a real tax
 *     engine for the working-life FY filing.
 *   • This lib models the user's PLANNING assumption for retirement
 *     income only: simple flat brackets to estimate how much of the
 *     yearly retirement gross will land in their pocket after tax.
 *     No std deduction, no rebate, no cess — those are the engine's
 *     job, not the planning proxy's.
 *
 * Returns per-bracket attribution so the UI tooltip can show:
 *   "₹10L at 0% = ₹0, ₹20L at 15% = ₹3L, ₹5L at 25% = ₹1.25L → ₹4.25L"
 */

export interface RetirementTaxBracket {
  /** Lower threshold of the band — in RUPEES as stored in the DB. The
   *  compute lib handles the paisa conversion internally. */
  threshold: number;
  /** Marginal rate for income in this band, percent (e.g. 15 → 15%). */
  ratePct: number;
}

export interface PerBracketTax {
  /** Bracket index (0-based, ascending). */
  bracket: number;
  /** Lower threshold of this band (paisa). */
  lowerPaisa: number;
  /** Upper threshold of this band (paisa) — Infinity for top band. */
  upperPaisa: number;
  /** Income slice that fell inside this band (paisa). */
  taxableAtThisBracket: number;
  /** Rate applied (echoed). */
  rate: number;
  /** Tax contribution from this band (paisa). */
  tax: number;
}

export interface RetirementTaxResult {
  taxPaisa: number;
  netPaisa: number;
  perBracketTax: PerBracketTax[];
  /** Echoed input so callers can audit. */
  grossPaisa: number;
  /** Effective rate across the whole gross (tax / gross × 100). 0 when
   *  gross is 0. */
  effectiveRatePct: number;
  /** Diagnostic — non-empty when brackets were malformed. Caller can
   *  surface a warning; the math still produced a defensible result
   *  (zero tax when there are no brackets). */
  warnings: string[];
}

/**
 * Validate and normalise a brackets array. Returns the brackets
 * sorted ascending and a list of warnings for any issues.
 */
function normaliseBrackets(
  brackets: ReadonlyArray<RetirementTaxBracket>,
): { sorted: RetirementTaxBracket[]; warnings: string[] } {
  const warnings: string[] = [];
  if (!Array.isArray(brackets) || brackets.length === 0) {
    return { sorted: [], warnings: ['No brackets provided — zero tax assumed.'] };
  }

  // Filter out malformed entries (NaN, negative rate, etc.).
  const valid = brackets.filter(
    (b) =>
      b != null &&
      Number.isFinite(b.threshold) &&
      Number.isFinite(b.ratePct) &&
      b.threshold >= 0 &&
      b.ratePct >= 0 &&
      b.ratePct <= 100,
  );
  if (valid.length < brackets.length) {
    warnings.push(`Discarded ${brackets.length - valid.length} malformed bracket(s).`);
  }

  const sorted = [...valid].sort((a, b) => a.threshold - b.threshold);

  // The first bracket SHOULD start at 0. If not, prepend a zero-rate
  // band so we don't silently miss income below the user's first
  // threshold (which would otherwise be untaxed by construction).
  if (sorted.length === 0 || sorted[0].threshold !== 0) {
    warnings.push('Brackets do not start at 0 — prepending {threshold:0, ratePct:0}.');
    sorted.unshift({ threshold: 0, ratePct: 0 });
  }

  // Strictly ascending check
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].threshold <= sorted[i - 1].threshold) {
      warnings.push(
        `Bracket ${i} threshold ${sorted[i].threshold} is not strictly greater than ${sorted[i - 1].threshold} — collapsing.`,
      );
    }
  }

  return { sorted, warnings };
}

/**
 * Apply retirement tax brackets to gross income.
 *
 * @param grossIncomePaisa  Total retirement-year gross income (paisa).
 * @param brackets          User-configured brackets. Each `threshold` is in
 *                          RUPEES (matches DB storage) so we convert internally.
 */
export function applyRetirementTaxBrackets(
  grossIncomePaisa: number,
  brackets: ReadonlyArray<RetirementTaxBracket>,
): RetirementTaxResult {
  // Edge: negative gross — never tax negative income.
  if (!Number.isFinite(grossIncomePaisa) || grossIncomePaisa <= 0) {
    return {
      taxPaisa: 0,
      netPaisa: Math.max(0, grossIncomePaisa || 0),
      perBracketTax: [],
      grossPaisa: grossIncomePaisa || 0,
      effectiveRatePct: 0,
      warnings: [],
    };
  }

  const { sorted, warnings } = normaliseBrackets(brackets);
  if (sorted.length === 0) {
    return {
      taxPaisa: 0,
      netPaisa: grossIncomePaisa,
      perBracketTax: [],
      grossPaisa: grossIncomePaisa,
      effectiveRatePct: 0,
      warnings,
    };
  }

  // Convert thresholds: DB stores rupees, math uses paisa. Build the
  // [lower, upper) bands. The last band's upper is +Infinity.
  const bands = sorted.map((b, i) => {
    const lower = Math.round(b.threshold * 100);
    const upper =
      i + 1 < sorted.length ? Math.round(sorted[i + 1].threshold * 100) : Infinity;
    return { lower, upper, rate: b.ratePct };
  });

  let totalTax = 0;
  const perBracketTax: PerBracketTax[] = [];
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i];
    if (grossIncomePaisa <= b.lower) break; // remaining bands are above the income
    const sliceUpper = Math.min(grossIncomePaisa, b.upper);
    const slice = Math.max(0, sliceUpper - b.lower);
    const tax = Math.round((slice * b.rate) / 100);
    totalTax += tax;
    perBracketTax.push({
      bracket: i,
      lowerPaisa: b.lower,
      upperPaisa: b.upper === Infinity ? Number.POSITIVE_INFINITY : b.upper,
      taxableAtThisBracket: slice,
      rate: b.rate,
      tax,
    });
  }

  // Cap so net never goes negative even with pathological brackets.
  const netPaisa = Math.max(0, grossIncomePaisa - totalTax);
  const effectiveRatePct = (totalTax / grossIncomePaisa) * 100;

  return {
    taxPaisa: totalTax,
    netPaisa,
    perBracketTax,
    grossPaisa: grossIncomePaisa,
    effectiveRatePct,
    warnings,
  };
}

/** Default brackets matching the migration's column default. Exported
 *  so server and client code can render the same fallback when a
 *  user-prefs row hasn't been seeded yet. */
export const DEFAULT_RETIREMENT_TAX_BRACKETS: RetirementTaxBracket[] = [
  { threshold: 0, ratePct: 0 },
  { threshold: 1000000, ratePct: 15 },
  { threshold: 3000000, ratePct: 25 },
];
