/**
 * Section 80G donations — Sprint 5.1c.
 *
 * Pure compute. Sec 80G classifies donations into four categories:
 *
 *   • 100_NO_LIMIT  — PMNRF, National Defence Fund, etc.
 *                     100% deduction, no cap. Pass-through.
 *
 *   • 50_NO_LIMIT   — PM CARES (in some years), Jawaharlal Nehru
 *                     Memorial Fund, etc. 50% deduction, no cap.
 *                     Pass-through at 50%.
 *
 *   • 100_WITH_LIMIT — Local-body donations like family planning,
 *                     Indian Olympic Association. 100% deduction
 *                     but the donation is capped at 10% of adjusted
 *                     gross.
 *
 *   • 50_WITH_LIMIT  — Most other approved trusts. 50% deduction,
 *                     also subject to the shared 10% cap.
 *
 * The two _WITH_LIMIT categories SHARE a single 10% cap. We sum
 * face values of both, cap that sum at 10% of adjusted gross, then
 * split the cap proportionally to the original face-value split,
 * applying each category's rate.
 *
 * Reference: Yeswanth TaxCalc "IT 2026-27" sheet 80G block. Four-
 * category structure is the standard CBDT classification and has
 * been stable for years.
 *
 * Caveats:
 *  • OLD regime only. NEW regime disallows 80G.
 *  • "Adjusted gross" = gross total income − all chapter VI-A
 *    deductions OTHER than 80G itself − LTCG (under 112A) − STCG
 *    (under 111A). For the v1 we use a simpler proxy: caller
 *    passes adjustedGrossPaisa = slab-taxable income before 80G.
 *  • Cash donations > ₹2k must be made via cheque/digital to
 *    qualify — we do NOT model this gate (UI hint only).
 */

export type EightyGCategory =
  | '100_NO_LIMIT'
  | '50_NO_LIMIT'
  | '100_WITH_LIMIT'
  | '50_WITH_LIMIT';

export interface Section80gRow {
  category: EightyGCategory;
  amountPaisa: number;
}

export interface Section80gInput {
  rows: Section80gRow[];
  /** Income figure used for the 10% cap on _WITH_LIMIT categories.
   *  Should be gross total income MINUS other VI-A deductions and
   *  capital gains. Caller's responsibility — we treat it as opaque. */
  adjustedGrossPaisa: number;
}

export interface Section80gResult {
  /** Per-category breakdown after caps & rates. Useful for ITR Sch 80G. */
  byCategory: Record<EightyGCategory, number>;
  /** Sum across all four categories. The deduction that lands in slab. */
  totalDeductionPaisa: number;
}

/** 10% adjusted-gross cap applied to (sum of WITH_LIMIT donations). */
const WITH_LIMIT_CAP_PCT = 10;

export function computeSection80g(input: Section80gInput): Section80gResult {
  const { rows, adjustedGrossPaisa } = input;

  let noLimit100 = 0;
  let noLimit50 = 0;
  let withLimit100 = 0;
  let withLimit50 = 0;

  for (const r of rows) {
    const a = Math.max(0, r.amountPaisa);
    if (r.category === '100_NO_LIMIT') noLimit100 += a;
    else if (r.category === '50_NO_LIMIT') noLimit50 += a;
    else if (r.category === '100_WITH_LIMIT') withLimit100 += a;
    else if (r.category === '50_WITH_LIMIT') withLimit50 += a;
  }

  // Pass-through (no-limit) categories — straight pass at their rate.
  const noLimit100Deduction = noLimit100;
  const noLimit50Deduction = Math.round(noLimit50 * 0.5);

  // With-limit: share a single 10%-of-adjusted-gross cap.
  const withLimitTotal = withLimit100 + withLimit50;
  const cap = Math.max(0, Math.round(adjustedGrossPaisa * WITH_LIMIT_CAP_PCT / 100));
  const cappedTotal = Math.min(withLimitTotal, cap);

  // Split the cap proportionally to the original face-value split.
  let withLimit100Deduction = 0;
  let withLimit50Deduction = 0;
  if (withLimitTotal > 0) {
    const share100 = withLimit100 / withLimitTotal;
    const share50 = withLimit50 / withLimitTotal;
    // Each category's capped face value, then × its deduction rate.
    withLimit100Deduction = Math.round(cappedTotal * share100 * 1.0);
    withLimit50Deduction = Math.round(cappedTotal * share50 * 0.5);
  }

  const byCategory: Record<EightyGCategory, number> = {
    '100_NO_LIMIT': noLimit100Deduction,
    '50_NO_LIMIT': noLimit50Deduction,
    '100_WITH_LIMIT': withLimit100Deduction,
    '50_WITH_LIMIT': withLimit50Deduction,
  };

  const total =
    noLimit100Deduction + noLimit50Deduction + withLimit100Deduction + withLimit50Deduction;

  return { byCategory, totalDeductionPaisa: total };
}
