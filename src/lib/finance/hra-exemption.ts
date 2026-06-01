/**
 * HRA exemption under sec 10(13A) — Sprint 5.1a.
 *
 * Pure compute. The exemption is the LEAST of three quantities:
 *
 *   1. HRA actually received in the FY.
 *   2. Rent paid in excess of 10% of (Basic + DA) — the key economic
 *      test that the rent must "bite" beyond a reasonable salary
 *      percentage to qualify.
 *   3. 50% of (Basic + DA) for metro cities (Mumbai, Delhi, Kolkata,
 *      Chennai), 40% for non-metro.
 *
 * Reference: Yeswanth TaxCalc "IT 2024-25" sheet row 101
 * ("HRA Exempt") and supporting row 105 ("HRA Empt limit"). The same
 * formula is enshrined in CBDT circulars going back decades — has not
 * changed across recent finance acts.
 *
 * Caveats:
 *  • All amounts in paisa, annual basis.
 *  • Quantity 2 can go negative when rent <= 10% of basic+DA; we clamp
 *    to zero so it just stops contributing (doesn't subtract).
 *  • This exemption is allowed ONLY under the OLD regime. The caller
 *    is expected to apply it conditionally.
 *  • Whether DA forms part of salary for HRA purposes depends on the
 *    employment contract. We sum basic+DA unconditionally — matches the
 *    sheet's behaviour. Users with DA-excluded contracts should
 *    enter DA = 0.
 */

export interface HraExemptionInput {
  /** Annual HRA actually received from employer in paisa. */
  hraReceivedPaisa: number;
  /** Annual (Basic + DA) in paisa. */
  basicPlusDaPaisa: number;
  /** Annual rent paid in paisa. */
  rentPaidPaisa: number;
  /** Metro = 50% of basic+DA; Non-metro = 40%. */
  isMetro: boolean;
}

/**
 * Returns the HRA exemption amount in paisa. Always ≥ 0, never exceeds
 * hraReceivedPaisa (you can't exempt more than you received).
 */
export function computeHraExemption(input: HraExemptionInput): number {
  const { hraReceivedPaisa, basicPlusDaPaisa, rentPaidPaisa, isMetro } = input;

  if (hraReceivedPaisa <= 0) return 0;

  // Quantity 2: rent paid in excess of 10% of basic+DA, clamped at 0.
  const rentMinus10Pct = Math.max(0, rentPaidPaisa - basicPlusDaPaisa * 0.1);

  // Quantity 3: 50% (metro) or 40% (non-metro) of basic+DA.
  const cityCapPct = isMetro ? 0.5 : 0.4;
  const cityCap = basicPlusDaPaisa * cityCapPct;

  // Exemption is the minimum of all three. Round to paisa.
  return Math.round(Math.min(hraReceivedPaisa, rentMinus10Pct, cityCap));
}
