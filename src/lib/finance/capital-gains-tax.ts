/**
 * Capital-gains tax computation — Sprint 5.1c refinement.
 *
 * The Finance (No. 2) Act 2024 (effective 23-Jul-2024) overhauled
 * the CG regime. We now branch on the SALE DATE, not the FY:
 *
 *   Pre-23-Jul-2024 sales:
 *     • STCG sec 111A (equity STT-paid):  15%
 *     • LTCG sec 112A (equity STT-paid):  10% on gains > ₹1,00,000
 *     • LTCG other (indexed):             20% (CII-indexed cost)
 *     • STCG other:                       slab rate
 *
 *   Post-23-Jul-2024 sales:
 *     • STCG sec 111A (equity):           20%
 *     • LTCG sec 112A (equity):           12.5% on gains > ₹1,25,000
 *     • LTCG all (general):               12.5% (no indexation)
 *                                         — taxpayer may ELECT old
 *                                         20% indexed for property
 *                                         purchased pre-23-Jul-2024
 *     • STCG debt MF (acquired post-1-Apr-2023): slab rate
 *     • STCG other:                       slab rate
 *
 * "Per-bucket zero-tax absorption" (Yeswanth sheet rows AF85–AG87):
 * the basic-exemption threshold can absorb capital gains too. ₹2.5L
 * (OLD) or ₹4L (NEW) is applied SEPARATELY to STCG and LTCG buckets
 * — i.e. each bucket gets its own ₹4L window under NEW.
 *
 * Reference: Yeswanth TaxCalc "Capital Gains - Equity" sheet rows
 * AF85–AG87 + the cutoff annotations in the "IT 2026-27" sheet
 * (post-Jul-24 columns AC vs AD).
 *
 * Caveats:
 *  • Grandfathering for equity LTCG purchased pre-1-Feb-2018 is NOT
 *    modelled here — deferred. The user adjusts `taxableGainPaisa`
 *    manually (subtracts the grandfathered FMV).
 *  • Pre-Jul-24 ELECTION toggle on the row is auto-applied based on
 *    saleDate vs cutoff; user override of the election is deferred.
 *  • Negative `taxableGainPaisa` is treated as 0 contribution
 *    (carry-forward modelled in ITR itself).
 */

import type { CapitalGainsRules } from '@/db';

export type CgAssetType =
  | 'STOCKS'
  | 'EQUITY_MF'
  | 'DEBT_MF'
  | 'GOLD'
  | 'REAL_ESTATE'
  | 'OTHER';

export type CgGainType = 'STCG' | 'LTCG';

export interface CapitalGainRow {
  assetType: CgAssetType;
  gainType: CgGainType;
  taxableGainPaisa: number;
  /** ISO date string YYYY-MM-DD. Used to pick pre/post-Jul-24 rates.
   *  When missing, treated as POST-Jul-24 (current regime). */
  saleDate?: string;
}

export interface CapitalGainsTaxBreakdown {
  stcgEquityTaxPaisa: number;
  ltcgEquityTaxPaisa: number;
  /** Post-Jul-24: 12.5% flat on all LTCG (general, sec 112). Pre-Jul-24:
   *  20% on indexed gains. We label this `ltcgOther` for backward-compat
   *  with callers — but it represents the GENERAL LTCG bucket. */
  ltcgOtherTaxPaisa: number;
  totalCapitalGainsTaxPaisa: number;
  /** STCG other-than-111A — folded into slab gross. */
  stcgOtherAddsToSlabPaisa: number;
  buckets: {
    stcgEquityGainsPaisa: number;
    stcgOtherGainsPaisa: number;
    ltcgEquityGainsPaisa: number;
    ltcgOtherGainsPaisa: number;
  };
  cessPaisa: number;
}

/** Sec 112A exemption: ₹1L pre-Jul-2024, ₹1.25L post. */
const SEC_112A_EXEMPTION_PRE_PAISA = 1_00_000 * 100;
const SEC_112A_EXEMPTION_POST_PAISA = 1_25_000 * 100;

/** Cutoff date — Finance (No. 2) Act 2024 effective from. */
const POST_REFORM_CUTOFF = '2024-07-23';

const CESS_PCT = 4;

function isEquityBucket(t: CgAssetType): boolean {
  return t === 'STOCKS' || t === 'EQUITY_MF';
}

function isPostReform(saleDate: string | undefined, cutoff: string = POST_REFORM_CUTOFF): boolean {
  // Missing date → assume current regime (post-reform).
  if (!saleDate) return true;
  return saleDate >= cutoff;
}

export interface CapitalGainsTaxInput {
  gainsRows: CapitalGainRow[];
  fy: string;
}

export function computeCapitalGainsTax(
  input: CapitalGainsTaxInput,
): CapitalGainsTaxBreakdown {
  void input.fy; // FY carried for future enhancements

  // Split each gain into pre vs post-Jul-2024 sub-buckets so we apply
  // the right rate.
  let stcgEquityPre = 0;
  let stcgEquityPost = 0;
  let stcgOther = 0;
  let ltcgEquityPre = 0;
  let ltcgEquityPost = 0;
  let ltcgOtherPre = 0;  // pre: 20% with indexation (caller pre-indexed)
  let ltcgOtherPost = 0; // post: 12.5% flat, no indexation

  for (const r of input.gainsRows) {
    const g = Math.max(0, r.taxableGainPaisa);
    if (g === 0) continue;
    const post = isPostReform(r.saleDate);
    const equity = isEquityBucket(r.assetType);
    if (r.gainType === 'STCG') {
      if (equity) {
        if (post) stcgEquityPost += g;
        else stcgEquityPre += g;
      } else {
        stcgOther += g;
      }
    } else {
      // LTCG
      if (equity) {
        if (post) ltcgEquityPost += g;
        else ltcgEquityPre += g;
      } else {
        if (post) ltcgOtherPost += g;
        else ltcgOtherPre += g;
      }
    }
  }

  // STCG sec 111A rates: 15% pre, 20% post.
  const stcgEquityTaxPre = Math.round(stcgEquityPre * 0.15);
  const stcgEquityTaxPost = Math.round(stcgEquityPost * 0.20);
  const stcgEquityTax = stcgEquityTaxPre + stcgEquityTaxPost;

  // LTCG sec 112A — equity STT-paid:
  //   Pre: 10% on (sum > ₹1L)
  //   Post: 12.5% on (sum > ₹1.25L)
  const ltcgEquityTaxablePre = Math.max(0, ltcgEquityPre - SEC_112A_EXEMPTION_PRE_PAISA);
  const ltcgEquityTaxPre = Math.round(ltcgEquityTaxablePre * 0.10);
  const ltcgEquityTaxablePost = Math.max(0, ltcgEquityPost - SEC_112A_EXEMPTION_POST_PAISA);
  const ltcgEquityTaxPost = Math.round(ltcgEquityTaxablePost * 0.125);
  const ltcgEquityTax = ltcgEquityTaxPre + ltcgEquityTaxPost;

  // LTCG general (other) — pre: 20% (indexed cost basis from caller),
  // post: 12.5% flat (no indexation).
  const ltcgOtherTaxPre = Math.round(ltcgOtherPre * 0.20);
  const ltcgOtherTaxPost = Math.round(ltcgOtherPost * 0.125);
  const ltcgOtherTax = ltcgOtherTaxPre + ltcgOtherTaxPost;

  const totalCapitalGainsTax = stcgEquityTax + ltcgEquityTax + ltcgOtherTax;
  const cess = Math.round((totalCapitalGainsTax * CESS_PCT) / 100);

  return {
    stcgEquityTaxPaisa: stcgEquityTax,
    ltcgEquityTaxPaisa: ltcgEquityTax,
    ltcgOtherTaxPaisa: ltcgOtherTax,
    totalCapitalGainsTaxPaisa: totalCapitalGainsTax,
    stcgOtherAddsToSlabPaisa: stcgOther,
    buckets: {
      stcgEquityGainsPaisa: stcgEquityPre + stcgEquityPost,
      stcgOtherGainsPaisa: stcgOther,
      ltcgEquityGainsPaisa: ltcgEquityPre + ltcgEquityPost,
      ltcgOtherGainsPaisa: ltcgOtherPre + ltcgOtherPost,
    },
    cessPaisa: cess,
  };
}

// ────────────────────────────────────────────────────────────────────
// Aggregate (per-FY) capital-gains tax — the CORRECT model.
//
// Equity LTCG (sec 112A) and equity STCG (sec 111A) are taxed on the
// NET of all gains AND losses for the FY, with the ₹1L/₹1.25L sec-112A
// annual exemption applied ONCE per period — NOT per row. The per-row
// `tax_amount` stored at insert is a DISPLAY estimate only; this is the
// authoritative figure used by the regime comparison.
//
// We split equity buckets by the pre/post-23-Jul-2024 reform cutoff
// (different rate AND different exemption ceiling per period) and net
// within each period.
//
// Non-equity (sec 112) LTCG + STCG are KEPT per-row: each carries its
// own indexed/slab tax with no aggregate annual exemption, so summing
// their stored `tax_amount` is correct.
// ────────────────────────────────────────────────────────────────────

/** Minimal row shape from the capital_gains table needed for aggregation. */
export interface AggregateCgRow {
  assetType: CgAssetType;
  holdingPeriod: CgGainType;
  saleDate?: string | null;
  /** NET gain in paisa — can be negative (a loss). */
  capitalGain: number;
  /** Per-row stored tax (paisa) — used only for the non-equity bucket. */
  taxAmount: number;
}

export interface CgBreakdownLine {
  label: string;
  gainPaisa: number;
  exemptionPaisa: number;
  taxPaisa: number;
}

export interface AggregateCapitalGainsTax {
  totalTaxPaisa: number;
  /** Equity LTCG portion only (for callers that want the headline figure). */
  ltcgEquityTaxPaisa: number;
  breakdown: CgBreakdownLine[];
}

/** Equity LTCG rate by period: 10% pre-reform, 12.5% post. */
const LTCG_EQUITY_RATE_PRE = 0.10;
const LTCG_EQUITY_RATE_POST = 0.125;
/** Equity STCG (sec 111A) rate by period: 15% pre-reform, 20% post. */
const STCG_EQUITY_RATE_PRE = 0.15;
const STCG_EQUITY_RATE_POST = 0.20;

/**
 * Compute aggregate capital-gains tax for a financial year.
 *
 * @param rows     capital_gains rows for the FY (paisa, gains may be negative)
 * @param fy       financial year (carried for audit; rate selection is by
 *                 SALE DATE, not FY, per the Finance Act 2024 transition)
 * @param cgRules  optional FY-configurable rates/exemptions/cutoff. When
 *                 provided, overrides the module constants — rates in the
 *                 rules object are PERCENTAGES (e.g. 12.5), so divided by 100.
 *                 Defaults to the historical hardcoded constants.
 */
export function computeAggregateCapitalGainsTax(
  rows: AggregateCgRow[],
  fy: string,
  cgRules?: CapitalGainsRules,
): AggregateCapitalGainsTax {
  void fy; // rate selection is sale-date driven; fy retained for audit

  // Resolve rates/exemptions/cutoff from the injected rules (percentages →
  // fractions) or fall back to the module constants. Pure refactor — the
  // seeded values equal the constants, so results stay byte-identical.
  const ltcgEquityRatePre = cgRules ? cgRules.ltcgEquityRatePrePct / 100 : LTCG_EQUITY_RATE_PRE;
  const ltcgEquityRatePost = cgRules ? cgRules.ltcgEquityRatePostPct / 100 : LTCG_EQUITY_RATE_POST;
  const stcgEquityRatePre = cgRules ? cgRules.stcgEquityRatePrePct / 100 : STCG_EQUITY_RATE_PRE;
  const stcgEquityRatePost = cgRules ? cgRules.stcgEquityRatePostPct / 100 : STCG_EQUITY_RATE_POST;
  const sec112aExemptionPre = cgRules ? cgRules.sec112aExemptionPrePaisa : SEC_112A_EXEMPTION_PRE_PAISA;
  const sec112aExemptionPost = cgRules ? cgRules.sec112aExemptionPostPaisa : SEC_112A_EXEMPTION_POST_PAISA;
  const reformCutoff = cgRules ? cgRules.reformCutoff : POST_REFORM_CUTOFF;

  // Net per (equity-class × gain-type × period) bucket.
  let ltcgEquityNetPre = 0;
  let ltcgEquityNetPost = 0;
  let stcgEquityNetPre = 0;
  let stcgEquityNetPost = 0;
  let nonEquityPerRowTax = 0;

  for (const r of rows) {
    const equity = isEquityBucket(r.assetType);
    const saleDate = r.saleDate ?? undefined;
    const post = isPostReform(saleDate, reformCutoff);
    if (equity) {
      if (r.holdingPeriod === 'LTCG') {
        if (post) ltcgEquityNetPost += r.capitalGain;
        else ltcgEquityNetPre += r.capitalGain;
      } else {
        if (post) stcgEquityNetPost += r.capitalGain;
        else stcgEquityNetPre += r.capitalGain;
      }
    } else {
      // Non-equity (sec 112) LTCG/STCG — keep the per-row stored tax.
      // Long-term loss set-off WITHIN the non-equity bucket is out of
      // scope (per-row tax never goes negative); noted limitation.
      nonEquityPerRowTax += r.taxAmount;
    }
  }

  const breakdown: CgBreakdownLine[] = [];

  // ── Equity LTCG (sec 112A): net per period, ONE exemption per period,
  // tax positive excess. Negative net → 0 (carry-forward not modelled). ──
  const ltcgEquityTaxablePre = Math.max(0, ltcgEquityNetPre - sec112aExemptionPre);
  const ltcgEquityTaxPre = Math.round(ltcgEquityTaxablePre * ltcgEquityRatePre);
  const ltcgEquityTaxablePost = Math.max(0, ltcgEquityNetPost - sec112aExemptionPost);
  const ltcgEquityTaxPost = Math.round(ltcgEquityTaxablePost * ltcgEquityRatePost);
  const ltcgEquityTax = ltcgEquityTaxPre + ltcgEquityTaxPost;

  if (ltcgEquityNetPre !== 0 || ltcgEquityTaxPre > 0) {
    breakdown.push({
      label: 'Equity LTCG (sec 112A, pre-23-Jul-2024 @ 10%)',
      gainPaisa: ltcgEquityNetPre,
      exemptionPaisa: ltcgEquityNetPre > 0 ? Math.min(ltcgEquityNetPre, sec112aExemptionPre) : 0,
      taxPaisa: ltcgEquityTaxPre,
    });
  }
  if (ltcgEquityNetPost !== 0 || ltcgEquityTaxPost > 0) {
    breakdown.push({
      label: 'Equity LTCG (sec 112A, post-23-Jul-2024 @ 12.5%)',
      gainPaisa: ltcgEquityNetPost,
      exemptionPaisa: ltcgEquityNetPost > 0 ? Math.min(ltcgEquityNetPost, sec112aExemptionPost) : 0,
      taxPaisa: ltcgEquityTaxPost,
    });
  }

  // ── Equity STCG (sec 111A): net per period, no exemption. ──
  const stcgEquityTaxPre = Math.round(Math.max(0, stcgEquityNetPre) * stcgEquityRatePre);
  const stcgEquityTaxPost = Math.round(Math.max(0, stcgEquityNetPost) * stcgEquityRatePost);
  const stcgEquityTax = stcgEquityTaxPre + stcgEquityTaxPost;

  if (stcgEquityNetPre !== 0 || stcgEquityTaxPre > 0) {
    breakdown.push({
      label: 'Equity STCG (sec 111A, pre-23-Jul-2024 @ 15%)',
      gainPaisa: stcgEquityNetPre,
      exemptionPaisa: 0,
      taxPaisa: stcgEquityTaxPre,
    });
  }
  if (stcgEquityNetPost !== 0 || stcgEquityTaxPost > 0) {
    breakdown.push({
      label: 'Equity STCG (sec 111A, post-23-Jul-2024 @ 20%)',
      gainPaisa: stcgEquityNetPost,
      exemptionPaisa: 0,
      taxPaisa: stcgEquityTaxPost,
    });
  }

  // ── Non-equity (sec 112) — sum of stored per-row tax. ──
  if (nonEquityPerRowTax > 0) {
    breakdown.push({
      label: 'Non-equity (sec 112) — per-row indexed/slab tax',
      gainPaisa: 0, // mixed per-row; gain not aggregated here
      exemptionPaisa: 0,
      taxPaisa: nonEquityPerRowTax,
    });
  }

  const totalTaxPaisa = ltcgEquityTax + stcgEquityTax + nonEquityPerRowTax;

  return {
    totalTaxPaisa,
    ltcgEquityTaxPaisa: ltcgEquityTax,
    breakdown,
  };
}

/**
 * Sprint 5.1c — Basic-exemption absorption of CG income.
 *
 * If the taxpayer's slab income is below the basic exemption limit,
 * the unused window can absorb capital gains (LTCG sec 112A + STCG
 * sec 111A + general LTCG). Applied SEPARATELY to STCG and LTCG —
 * each bucket gets its own ₹2.5L (OLD) or ₹4L (NEW) window.
 *
 * Reference: Yeswanth TaxCalc rows AF85–AG87.
 */
export function basicExemptionAbsorption(input: {
  unusedExemptionPaisa: number;
  stcgGainsPaisa: number;
  ltcgGainsPaisa: number;
  regime: 'OLD' | 'NEW';
}): {
  stcgAbsorbed: number;
  ltcgAbsorbed: number;
} {
  // Each bucket gets its own absorption — independently capped at the
  // unused exemption window. Per the sheet, you don't subtract from
  // one to use on the other.
  const stcg = Math.min(input.unusedExemptionPaisa, Math.max(0, input.stcgGainsPaisa));
  const ltcg = Math.min(input.unusedExemptionPaisa, Math.max(0, input.ltcgGainsPaisa));
  return { stcgAbsorbed: stcg, ltcgAbsorbed: ltcg };
}
