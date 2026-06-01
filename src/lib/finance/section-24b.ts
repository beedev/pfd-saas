/**
 * Section 24(b) home-loan interest deduction — Sprint 5.1a.
 *
 * Pure compute. Caps the home-loan-interest deduction based on
 * occupancy + loan vintage:
 *
 *   • Self-occupied + loan disbursed on/after 1-Apr-1999 → cap ₹2,00,000
 *   • Self-occupied + loan disbursed before 1-Apr-1999  → cap ₹30,000
 *   • Let-out / deemed let-out                          → uncapped
 *
 * The let-out branch returns the full interest paid; the caller is
 * responsible for the cross-head set-off rule (loss from house property
 * can offset other heads up to ₹2L total per year). That set-off is
 * NOT applied here — this lib just gives back the deduction figure.
 *
 * Reference: Yeswanth TaxCalc "IT 2024-25" sheet row 60
 * ("Interest on housing loan") plus row 65 ("HL int exmpt limit") on
 * the OLD-scheme column.
 *
 * Caveats:
 *  • Section 24(b) is OLD-regime only (NEW regime disallows the
 *    self-occupied case entirely; let-out interest is still allowed
 *    under NEW since FY 2023-24 — the caller should toggle accordingly,
 *    this lib doesn't model regime).
 *  • Additional sec 80EEA ₹1.5L benefit on interest above the 24(b)
 *    cap is computed separately in `section-80eea.ts`.
 */

/** ₹2,00,000 cap in paisa for self-occupied post-Apr-1999 loans. */
const SELF_OCCUPIED_POST_1999_CAP_PAISA = 2_00_000 * 100;
/** ₹30,000 cap in paisa for self-occupied pre-Apr-1999 loans. */
const SELF_OCCUPIED_PRE_1999_CAP_PAISA = 30_000 * 100;

export interface Section24bInput {
  /** Annual interest paid on the home loan in paisa. */
  homeLoanInterestPaidPaisa: number;
  /** True = self-occupied (or partly self-occupied, taken as such).
   *  False = let-out / deemed let-out. */
  isSelfOccupied: boolean;
  /** True if the loan was disbursed on or after 1-Apr-1999. The
   *  pre-1999 case is increasingly rare but still legally distinct
   *  (₹30k cap). */
  loanDisbursedAfter1Apr1999: boolean;
}

/**
 * Returns the deductible interest amount in paisa. Always ≥ 0.
 */
export function computeSection24bDeduction(input: Section24bInput): number {
  const { homeLoanInterestPaidPaisa, isSelfOccupied, loanDisbursedAfter1Apr1999 } = input;

  if (homeLoanInterestPaidPaisa <= 0) return 0;

  if (!isSelfOccupied) {
    // Let-out — interest is fully deductible. Caller handles the
    // ₹2L cross-head set-off cap.
    return homeLoanInterestPaidPaisa;
  }

  const cap = loanDisbursedAfter1Apr1999
    ? SELF_OCCUPIED_POST_1999_CAP_PAISA
    : SELF_OCCUPIED_PRE_1999_CAP_PAISA;

  return Math.min(homeLoanInterestPaidPaisa, cap);
}
