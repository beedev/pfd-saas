/**
 * Section 80EEA additional home-loan interest deduction — Sprint 5.1a.
 *
 * Pure compute. Sec 80EEA provides an ADDITIONAL ₹1.5L deduction on
 * home-loan interest above the sec 24(b) cap, but only when ALL of
 * these are true:
 *
 *   • First home (i.e. taxpayer doesn't own any other residential
 *     property on the date the loan is sanctioned)
 *   • Stamp duty value of property ≤ ₹45L
 *   • Carpet area ≤ 968 sqft (~60 sqm) — metro standard, the
 *     Yeswanth FY 2026-27 template's default
 *   • Loan sanctioned between 1-Apr-2019 and 31-Mar-2022 (inclusive)
 *
 * If any condition fails → returns 0 (no 80EEA benefit; user still
 * gets sec 24(b)).
 *
 * Reference: Yeswanth TaxCalc "IT 2024-25" sheet row 66 ("80EEA
 * benefit"). The eligibility window has not been extended since
 * Finance Act 2021 — the govt has not renewed it.
 *
 * Caveats:
 *  • OLD regime only. NEW regime disallows.
 *  • The ₹1.5L cap is on the deduction itself, not the interest
 *    amount. Interest above (sec 24(b) cap + ₹1.5L) is wasted.
 *  • This is computed AFTER sec 24(b) — so the input is the
 *    interest REMAINING after the 24(b) deduction has been taken.
 */

/** ₹1,50,000 cap in paisa. */
const SECTION_80EEA_CAP_PAISA = 1_50_000 * 100;
/** ₹45,00,000 stamp duty value ceiling in paisa. */
const STAMP_VALUE_CEILING_PAISA = 45_00_000 * 100;
/** Carpet area ceiling in sqft (60 sqm ≈ 968 sqft). */
const CARPET_AREA_CEILING_SQFT = 968;
/** Loan window — disbursal must fall within this range (inclusive). */
const LOAN_WINDOW_START = '2019-04-01';
const LOAN_WINDOW_END = '2022-03-31';

export interface Section80EeaInput {
  /** Home-loan interest paid in the FY, in paisa. */
  homeLoanInterestPaidPaisa: number;
  /** Amount already deducted under sec 24(b), in paisa. The 80EEA
   *  benefit applies to interest ABOVE this. */
  section24bDeductionPaisa: number;
  /** First home flag — true if the taxpayer didn't own another
   *  residential property when the loan was sanctioned. */
  isFirstHome: boolean;
  /** Stamp duty value of the property at purchase, in paisa.
   *  NULL = not captured → fail-conservative (no 80EEA). */
  stampValuePaisa: number | null;
  /** Carpet area in sqft. NULL = not captured → fail-conservative. */
  carpetAreaSqft: number | null;
  /** ISO date string YYYY-MM-DD. NULL = not captured →
   *  fail-conservative. */
  loanDisbursedDate: string | null;
}

/**
 * Returns the deductible 80EEA amount in paisa. Always ≥ 0, capped
 * at ₹1.5L, and at the residual interest above the sec 24(b) cap.
 */
export function computeSection80EeaDeduction(input: Section80EeaInput): number {
  const {
    homeLoanInterestPaidPaisa,
    section24bDeductionPaisa,
    isFirstHome,
    stampValuePaisa,
    carpetAreaSqft,
    loanDisbursedDate,
  } = input;

  // Quick exits — any condition failure → no 80EEA.
  if (!isFirstHome) return 0;
  if (stampValuePaisa === null) return 0;
  if (stampValuePaisa > STAMP_VALUE_CEILING_PAISA) return 0;
  if (carpetAreaSqft === null) return 0;
  if (carpetAreaSqft > CARPET_AREA_CEILING_SQFT) return 0;
  if (loanDisbursedDate === null) return 0;
  if (loanDisbursedDate < LOAN_WINDOW_START) return 0;
  if (loanDisbursedDate > LOAN_WINDOW_END) return 0;

  // Eligible: 80EEA applies to interest ABOVE the 24(b) deduction,
  // capped at ₹1.5L.
  const residual = Math.max(0, homeLoanInterestPaidPaisa - section24bDeductionPaisa);
  return Math.min(residual, SECTION_80EEA_CAP_PAISA);
}
