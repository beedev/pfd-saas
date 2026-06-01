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

function isPostReform(saleDate: string | undefined): boolean {
  // Missing date → assume current regime (post-reform).
  if (!saleDate) return true;
  return saleDate >= POST_REFORM_CUTOFF;
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
