/**
 * ITR-1 (Sahaj) summary computation — Sprint 4.1.
 *
 * Pure compute mirroring the Sahaj form's three-block structure:
 *   1. Income from Salary
 *   2. Income from House Property (single house only — ITR-1 cap)
 *   3. Income from Other Sources (interest only — bank/FD/PF)
 *
 * No business income, no capital gains, no multiple houses, no foreign
 * assets, total ≤ ₹50L. The wizard already routes those filers to
 * ITR-2/3/4, but we still validate the ₹50L cap server-side and
 * surface `exceedsCap=true` so the UI can nudge the user upward.
 *
 * Inputs are all paisa-denominated. The caller is responsible for
 * fetching and passing the right rows; this lib does no I/O.
 *
 * Tax computation reuses `computeTax()` from tax-slabs.ts so the
 * standard-deduction / 87A / cess math stays single-sourced.
 *
 * Edge cases:
 *   • House property income is computed net of:
 *       – 30% std maintenance deduction on net annual value
 *       – Municipal taxes paid (if provided)
 *       – Home loan interest (cap ₹2L for self-occupied — caller
 *         already enforces the cap via the 24B deduction row)
 *     For ITR-1 we only accept ONE row.
 *   • Other sources income filters out tax-exempt (e.g. PF interest
 *     up to threshold under specific conditions).
 *   • Regime: caller passes the right slabs/config; we don't gate
 *     deductions here (the caller passed the regime-eligible total).
 */

import { computeTax, type TaxSlabRow, type TaxRegimeConfigRow } from './tax-slabs';

/** ₹50L cap for ITR-1 eligibility. */
const FIFTY_LAKH_PAISA = 50_00_000 * 100;

export interface Itr1SinglePropertyInput {
  /** Annual rent received (₹). For self-occupied → 0. */
  annualRentPaisa: number;
  /** Municipal taxes paid during the FY (₹). Subtracted from gross
   *  before the 30% std-maintenance deduction. */
  municipalTaxesPaisa: number;
  /** Home loan interest (₹). Capped at ₹2L for self-occupied; let
   *  through as-is for let-out. ITR-1 only allows one property, so
   *  the caller decides which cap applies. */
  homeLoanInterestPaisa: number;
}

export interface Itr1SummaryInput {
  /** Sum of gross-salary across employers (paisa). */
  salaryGrossPaisa: number;
  /** Tax-deductible exemptions claimed in Schedule S (paisa). HRA,
   *  LTA, etc. Passed in pre-summed by the caller. */
  salaryExemptionsPaisa: number;
  /** Single ITR-1 house property (or null for no property). */
  property: Itr1SinglePropertyInput | null;
  /** Other-sources income (interest, dividends) net of exempt rows. */
  otherInterestIncomePaisa: number;
  /** Section-80 / chapter VI-A deductions regime-eligible total. */
  deductionsPaisa: number;
  slabs: TaxSlabRow[];
  config: TaxRegimeConfigRow;
  /** Regime label, surfaced in the result but unused for math. */
  regime: 'OLD' | 'NEW';
}

export interface Itr1SummaryResult {
  /** Income from Salary (post-exemptions, pre-std-deduction). */
  salaryIncomePaisa: number;
  /** Income from House Property (post 30% std + municipal − interest). */
  housePropertyIncomePaisa: number;
  /** Income from Other Sources. */
  otherSourcesPaisa: number;
  /** Sum of the three above — pre-standard-deduction headline. */
  grossTotalIncomePaisa: number;
  /** Taxable income (post std deduction + section 80). From computeTax. */
  taxableIncomePaisa: number;
  /** Slab tax before 87A. */
  slabTaxPaisa: number;
  /** 87A rebate applied. */
  rebatePaisa: number;
  /** Tax after rebate. */
  taxAfterRebatePaisa: number;
  /** 4% cess on (slab tax − rebate). */
  cessPaisa: number;
  /** Final total tax. */
  totalTaxPaisa: number;
  /** Effective rate vs gross. */
  effectiveRatePct: number;
  /** True if grossTotalIncome > ₹50L — surfaces a "switch to ITR-2"
   *  banner on the page. The math still completes; the flag is a
   *  *recommendation*, not a hard block. */
  exceedsCap: boolean;
  regime: 'OLD' | 'NEW';
}

/** Compute House Property income per Section 24:
 *    GAV = annual rent
 *    NAV = GAV − municipal taxes
 *    Income = NAV − 30% std − interest
 *
 *  For self-occupied where rent = 0, NAV = 0 and the result is
 *  negative interest (capped at ₹2L by caller's 24B claim).
 */
function computeHousePropertyIncome(p: Itr1SinglePropertyInput): number {
  const gav = p.annualRentPaisa;
  const nav = Math.max(0, gav - p.municipalTaxesPaisa);
  const stdMaintenance = Math.round(nav * 0.30);
  return nav - stdMaintenance - p.homeLoanInterestPaisa;
}

export function computeItr1Summary(input: Itr1SummaryInput): Itr1SummaryResult {
  const salaryIncome = Math.max(
    0,
    input.salaryGrossPaisa - input.salaryExemptionsPaisa,
  );
  const housePropertyIncome = input.property
    ? computeHousePropertyIncome(input.property)
    : 0;
  const grossTotalIncome =
    salaryIncome + housePropertyIncome + input.otherInterestIncomePaisa;

  // Tax via standard slab engine. Note: computeTax applies standard
  // deduction *inside*; we pass gross-of-std and let it subtract.
  const tax = computeTax({
    grossIncomePaisa: grossTotalIncome,
    deductionsPaisa: input.deductionsPaisa,
    slabs: input.slabs,
    config: input.config,
  });

  return {
    salaryIncomePaisa: salaryIncome,
    housePropertyIncomePaisa: housePropertyIncome,
    otherSourcesPaisa: input.otherInterestIncomePaisa,
    grossTotalIncomePaisa: grossTotalIncome,
    taxableIncomePaisa: tax.taxablePaisa,
    slabTaxPaisa: tax.taxBeforeRebatePaisa,
    rebatePaisa: tax.rebatePaisa,
    taxAfterRebatePaisa: tax.taxAfterRebatePaisa,
    cessPaisa: tax.cessPaisa,
    totalTaxPaisa: tax.totalTaxPaisa,
    effectiveRatePct: tax.effectiveRatePct,
    exceedsCap: grossTotalIncome > FIFTY_LAKH_PAISA,
    regime: input.regime,
  };
}
