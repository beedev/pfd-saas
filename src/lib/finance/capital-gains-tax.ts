/**
 * Capital-gains tax computation — Sprint 4.1.
 *
 * Pure compute over realised-gain rows. Tax law (current FY 2025-26
 * onwards) splits realised gains into four "buckets" with different
 * tax treatments:
 *
 *   • STCG sec 111A (equity STT-paid) — flat 15%
 *   • STCG (other / non-equity)        — added to slab income, taxed
 *                                        at the user's slab rate.
 *                                        We return 0 tax here and set
 *                                        `addsToSlabPaisa.stcgOther`
 *                                        so the caller can fold it
 *                                        into slab gross.
 *   • LTCG sec 112A (equity STT-paid)  — 10% on gains > ₹1L per FY.
 *                                        The ₹1L exemption is applied
 *                                        across the bucket (NOT per
 *                                        row) — we sum equity LTCG
 *                                        first, then subtract ₹1L,
 *                                        then 10%.
 *   • LTCG (other, indexed)            — flat 20% (FY 2025-26+).
 *                                        We do NOT apply the cost-
 *                                        inflation-index lookup here
 *                                        (deferred — see CLAUDE.md
 *                                        "Deferred from Sprint 4.1");
 *                                        rows already carry the
 *                                        post-index `taxableGain`.
 *
 * Health & Education Cess (4% in current law) applies on top of the
 * total capital-gains tax. We return it separately so callers can
 * sum into the form-specific summary (which adds its own slab-tax
 * cess — different number; we don't want to double-cess on equity
 * LTCG).
 *
 * Equity classification: assetType ∈ { EQUITY, EQUITY_MF } → equity
 * bucket. Everything else (DEBT_MF, GOLD, REAL_ESTATE, OTHER) → "other".
 *
 * Edge cases:
 *   • Negative `taxableGain` (loss) — treated as 0 contribution.
 *     Carry-forward of capital losses is NOT modelled here; the user
 *     handles that in the ITR itself.
 *   • Empty input → all-zeros result.
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
  /** Matches `capital_gains.assetType` in schema.ts. STOCKS and EQUITY_MF
   *  are treated as the "equity bucket"; everything else is "other". */
  assetType: CgAssetType;
  /** STCG or LTCG. Caller is expected to compute holding-period
   *  classification before passing rows in (the schema's
   *  `holdingPeriod` column already encodes this). */
  gainType: CgGainType;
  /** Taxable gain in paisa, post-exemption, post-indexation. Can be
   *  negative (a loss) — treated as 0 here. */
  taxableGainPaisa: number;
}

export interface CapitalGainsTaxBreakdown {
  /** Tax on STCG sec 111A (equity, flat 15%). Paisa. */
  stcgEquityTaxPaisa: number;
  /** Tax on LTCG sec 112A (equity over ₹1L, flat 10%). Paisa. */
  ltcgEquityTaxPaisa: number;
  /** Tax on LTCG other (flat 20%). Paisa. */
  ltcgOtherTaxPaisa: number;
  /** Total of the three above. Caller adds slab tax + cess upstream. */
  totalCapitalGainsTaxPaisa: number;
  /** STCG other-than-111A — to be folded into the user's slab gross
   *  by the caller (added to taxable income for slab-rate treatment).
   *  Always 0 if no such rows present. */
  stcgOtherAddsToSlabPaisa: number;
  /** Bucket totals (post-loss-elimination) for surfacing in UI. */
  buckets: {
    stcgEquityGainsPaisa: number;
    stcgOtherGainsPaisa: number;
    ltcgEquityGainsPaisa: number;
    ltcgOtherGainsPaisa: number;
  };
  /** Health & Education Cess (4%) on capital-gains tax. Separate from
   *  slab-tax cess so callers don't double-count. */
  cessPaisa: number;
}

/** ₹1,00,000 = 1,00,00,000 paisa. Sec 112A exemption threshold. */
const SEC_112A_EXEMPTION_PAISA = 1_00_000 * 100;
/** Health & Education Cess — current law (FY 2025-26+). */
const CESS_PCT = 4;

function isEquityBucket(t: CgAssetType): boolean {
  return t === 'STOCKS' || t === 'EQUITY_MF';
}

export interface CapitalGainsTaxInput {
  gainsRows: CapitalGainRow[];
  /** FY identifier (e.g. "2025-26"). Currently unused — the engine
   *  hard-codes current rates. Carried so callers can pass it
   *  through; future LTCG-other slab change (e.g. removal of
   *  indexation post-Budget-2024) will branch on FY here. */
  fy: string;
}

export function computeCapitalGainsTax(
  input: CapitalGainsTaxInput,
): CapitalGainsTaxBreakdown {
  void input.fy; // see comment above — reserved for future FY branching

  let stcgEquityGains = 0;
  let stcgOtherGains = 0;
  let ltcgEquityGains = 0;
  let ltcgOtherGains = 0;

  for (const r of input.gainsRows) {
    const g = Math.max(0, r.taxableGainPaisa);
    if (g === 0) continue;
    if (r.gainType === 'STCG') {
      if (isEquityBucket(r.assetType)) stcgEquityGains += g;
      else stcgOtherGains += g;
    } else {
      if (isEquityBucket(r.assetType)) ltcgEquityGains += g;
      else ltcgOtherGains += g;
    }
  }

  // STCG sec 111A — flat 15% on equity STT-paid short-term gains.
  const stcgEquityTax = Math.round(stcgEquityGains * 0.15);

  // LTCG sec 112A — 10% on (equity LTCG above ₹1L). The ₹1L exemption
  // applies once across all 112A gains for the FY, not per row.
  const ltcgEquityTaxable = Math.max(0, ltcgEquityGains - SEC_112A_EXEMPTION_PAISA);
  const ltcgEquityTax = Math.round(ltcgEquityTaxable * 0.10);

  // LTCG other — flat 20% on indexed gains (caller already supplies
  // post-indexed `taxableGain`). Cost-inflation-index lookup deferred.
  const ltcgOtherTax = Math.round(ltcgOtherGains * 0.20);

  const totalCapitalGainsTax = stcgEquityTax + ltcgEquityTax + ltcgOtherTax;
  const cess = Math.round((totalCapitalGainsTax * CESS_PCT) / 100);

  return {
    stcgEquityTaxPaisa: stcgEquityTax,
    ltcgEquityTaxPaisa: ltcgEquityTax,
    ltcgOtherTaxPaisa: ltcgOtherTax,
    totalCapitalGainsTaxPaisa: totalCapitalGainsTax,
    stcgOtherAddsToSlabPaisa: stcgOtherGains,
    buckets: {
      stcgEquityGainsPaisa: stcgEquityGains,
      stcgOtherGainsPaisa: stcgOtherGains,
      ltcgEquityGainsPaisa: ltcgEquityGains,
      ltcgOtherGainsPaisa: ltcgOtherGains,
    },
    cessPaisa: cess,
  };
}
