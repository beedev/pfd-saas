/**
 * ITR-4 (Sugam) summary computation — Sprint 4.1.
 *
 * Salary + presumptive business/profession income + other sources.
 * Total income capped at ₹50L for ITR-4 eligibility (presumptive
 * gross receipts caps are separate — 44AD ₹2cr, 44ADA ₹50L, 44AE
 * per-vehicle).
 *
 * Presumptive sections we model:
 *   • 44AD — small businesses. Deemed profit:
 *       – DIGITAL receipts: 6% of gross
 *       – CASH receipts:    8% of gross
 *       – MIXED:            treated as CASH (conservative — caller
 *                           is expected to split into two rows if
 *                           they want the cheaper math)
 *     Limit: gross receipts ≤ ₹2cr (₹2,00,00,000) per FY.
 *   • 44ADA — professionals (consultants, doctors, lawyers, etc.).
 *     Deemed profit: 50% of gross receipts.
 *     Limit: gross receipts ≤ ₹75L (₹75,00,000) per FY [updated by
 *     Finance Act 2023]. We use ₹50L as the conservative ITR-4-form
 *     cap — over ₹50L total income disqualifies ITR-4 anyway, so
 *     either threshold blocks. Validation here uses ₹50L total-income
 *     cap and surfaces gross-receipts via `exceedsCap` only when
 *     a 44AD row exceeds ₹2cr.
 *   • 44AE — goods-carriage operators. Per-vehicle math (e.g. ₹1k
 *     per tonne per month for heavy goods vehicles). We do NOT model
 *     vehicle-level math here — caller passes `declaredProfit`
 *     directly. Deferred per CLAUDE.md "44AE per-vehicle math".
 *
 * Declared profit MUST be ≥ deemed profit for 44AD/44ADA; lower
 * declared profit triggers mandatory tax-audit under sec 44AB(e).
 * This lib does NOT auto-reject lower declarations — it surfaces
 * the minimum so the route handler / UI can validate.
 *
 * Tax = slab tax on (salary + declared presumptive + other) + cess.
 * No separate CG handling here (CG → ITR-2/3).
 */

import { computeTax, type TaxSlabRow, type TaxRegimeConfigRow } from './tax-slabs';
import type { PresumptiveRules } from '@/db';

/** Section 44AD gross-receipts limit: ₹2cr. */
const SEC_44AD_LIMIT_PAISA = 2_00_00_000 * 100;
/** ITR-4 total-income cap (₹50L). Beyond this → ITR-3. */
const FIFTY_LAKH_PAISA = 50_00_000 * 100;

export type PresumptiveSection = '44AD' | '44ADA' | '44AE';
export type ReceiptMode = 'DIGITAL' | 'CASH' | 'MIXED';

export interface PresumptiveLineInput {
  section: PresumptiveSection;
  grossReceiptsPaisa: number;
  /** Only meaningful for 44AD (drives 6% vs 8% deemed-profit pct).
   *  For 44ADA / 44AE, ignored. */
  receiptMode: ReceiptMode;
  declaredProfitPaisa: number;
}

export interface PresumptiveLineResult {
  section: PresumptiveSection;
  grossReceiptsPaisa: number;
  receiptMode: ReceiptMode;
  /** The deemed-profit % per section + receipt mode. */
  deemedProfitPct: number;
  /** Minimum profit the filer must declare to avoid sec 44AB(e)
   *  audit. For 44AE we surface the declared profit itself (no
   *  minimum modelled). */
  minimumProfitPaisa: number;
  declaredProfitPaisa: number;
  /** True if declared < minimum (audit-trigger). The CRUD route
   *  rejects this with 422; the lib still computes a result so
   *  UI dry-runs can preview. */
  belowMinimum: boolean;
  /** True if grossReceipts exceeds the section's eligibility cap
   *  (₹2cr for 44AD). 44ADA / 44AE: always false here — we rely
   *  on the overall ₹50L total-income gate. */
  exceedsCap: boolean;
}

export interface Itr4SummaryInput {
  salaryGrossPaisa: number;
  salaryExemptionsPaisa: number;
  presumptiveLines: PresumptiveLineInput[];
  otherIncomePaisa: number;
  deductionsPaisa: number;
  slabs: TaxSlabRow[];
  config: TaxRegimeConfigRow;
  regime: 'OLD' | 'NEW';
  /** FY-configurable presumptive percentages (44AD/44ADA). When omitted,
   *  the historical literals (6%/8%, 50%) are used. */
  presumptive?: PresumptiveRules;
}

export interface Itr4SummaryResult {
  salaryIncomePaisa: number;
  presumptiveLines: PresumptiveLineResult[];
  /** Sum of declared profits across presumptive lines. */
  totalPresumptiveProfitPaisa: number;
  otherSourcesPaisa: number;
  /** salary + presumptive + other. */
  grossTotalIncomePaisa: number;
  taxableIncomePaisa: number;
  slabTaxPaisa: number;
  rebatePaisa: number;
  taxAfterRebatePaisa: number;
  cessPaisa: number;
  totalTaxPaisa: number;
  effectiveRatePct: number;
  /** True if grossTotalIncome > ₹50L OR any 44AD line exceeds ₹2cr.
   *  UI surfaces "switch to ITR-3" recommendation. */
  exceedsCap: boolean;
  regime: 'OLD' | 'NEW';
}

/** Per section + receipt mode, the deemed-profit % the filer must
 *  declare *at minimum*. Returns null for 44AE (no auto-minimum).
 *
 *  @param presumptive  FY-configurable 44AD/44ADA percentages. When
 *                      provided, uses presumptive.ad.digitalPct/cashPct
 *                      and presumptive.ada.pct. Defaults to the historical
 *                      literals (6%/8% for 44AD, 50% for 44ADA). */
export function deemedProfitPctFor(
  section: PresumptiveSection,
  receiptMode: ReceiptMode,
  presumptive?: PresumptiveRules,
): number | null {
  if (section === '44AD') {
    // MIXED → conservative cash %.
    if (presumptive) {
      return receiptMode === 'DIGITAL' ? presumptive.ad.digitalPct : presumptive.ad.cashPct;
    }
    return receiptMode === 'DIGITAL' ? 6 : 8;
  }
  if (section === '44ADA') return presumptive ? presumptive.ada.pct : 50;
  if (section === '44AE') return null;
  return null;
}

function evaluatePresumptiveLine(
  line: PresumptiveLineInput,
  presumptive?: PresumptiveRules,
): PresumptiveLineResult {
  const pct = deemedProfitPctFor(line.section, line.receiptMode, presumptive);
  const minimumProfit =
    pct != null
      ? Math.round((line.grossReceiptsPaisa * pct) / 100)
      : line.declaredProfitPaisa; // 44AE — no auto-minimum
  const belowMinimum =
    pct != null && line.declaredProfitPaisa < minimumProfit;
  const exceedsCap =
    line.section === '44AD' && line.grossReceiptsPaisa > SEC_44AD_LIMIT_PAISA;
  return {
    section: line.section,
    grossReceiptsPaisa: line.grossReceiptsPaisa,
    receiptMode: line.receiptMode,
    deemedProfitPct: pct ?? 0,
    minimumProfitPaisa: minimumProfit,
    declaredProfitPaisa: line.declaredProfitPaisa,
    belowMinimum,
    exceedsCap,
  };
}

export function computeItr4Summary(input: Itr4SummaryInput): Itr4SummaryResult {
  const salaryIncome = Math.max(
    0,
    input.salaryGrossPaisa - input.salaryExemptionsPaisa,
  );

  const presumptiveLines = input.presumptiveLines.map((line) =>
    evaluatePresumptiveLine(line, input.presumptive),
  );
  const totalPresumptiveProfit = presumptiveLines.reduce(
    (s, r) => s + r.declaredProfitPaisa,
    0,
  );

  const grossTotalIncome =
    salaryIncome + totalPresumptiveProfit + input.otherIncomePaisa;

  const tax = computeTax({
    grossIncomePaisa: grossTotalIncome,
    deductionsPaisa: input.deductionsPaisa,
    slabs: input.slabs,
    config: input.config,
  });

  const exceedsCap =
    grossTotalIncome > FIFTY_LAKH_PAISA ||
    presumptiveLines.some((r) => r.exceedsCap);

  return {
    salaryIncomePaisa: salaryIncome,
    presumptiveLines,
    totalPresumptiveProfitPaisa: totalPresumptiveProfit,
    otherSourcesPaisa: input.otherIncomePaisa,
    grossTotalIncomePaisa: grossTotalIncome,
    taxableIncomePaisa: tax.taxablePaisa,
    slabTaxPaisa: tax.taxBeforeRebatePaisa,
    rebatePaisa: tax.rebatePaisa,
    taxAfterRebatePaisa: tax.taxAfterRebatePaisa,
    cessPaisa: tax.cessPaisa,
    totalTaxPaisa: tax.totalTaxPaisa,
    effectiveRatePct: tax.effectiveRatePct,
    exceedsCap,
    regime: input.regime,
  };
}
