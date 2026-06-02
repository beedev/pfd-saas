/**
 * Pure constants extracted from asset-growth-rates.ts so client
 * components can import DEFAULT_GROWTH_RATES without dragging
 * `db` (postgres) into the client bundle.
 *
 * Server-side code should still import from asset-growth-rates.ts to
 * get both the constants AND the getGrowthRates() helper.
 */

/**
 * EQUITY / DEBT — direct exposure rates (Indian equity, govt + corp
 * bonds). MUTUAL_FUNDS is the legacy umbrella rate kept for back-compat
 * (used when a fund's category is UNKNOWN). The MF_EQUITY / MF_DEBT /
 * MF_HYBRID rates are MF-subclass rates — picked when the per-fund
 * `category` column resolves to one of those. The distinction matters
 * because an MF wrapping equity carries a fee drag vs. direct equity,
 * so a slightly lower MF_EQUITY (11) vs EQUITY (12 in STOCKS below) is
 * appropriate. See Sprint 5.7.
 */
export const DEFAULT_GROWTH_RATES = {
  EQUITY: 10,
  DEBT: 7,
  GOLD: 8,
  NPS: 9,
  PF: 8.25,
  REAL_ESTATE: 5,
  CASH: 4,
  STOCKS: 12,
  MUTUAL_FUNDS: 11,
  MF_EQUITY: 11,
  MF_DEBT: 7,
  MF_HYBRID: 9,
  SMALL_SAVINGS: 7.5,
  FIXED_DEPOSITS: 7,
  CHIT_FUNDS: 6,
  INSURANCE_POLICIES: 5,
  // Sprint 5.10 — forex deposits. Conservative 5% real-return assumption
  // is a wash with INR depreciation against major currencies historically
  // (~3–4% USD vs INR drift annually) plus the deposit's own interest
  // (1–4%). Captures the "your dollars don't disappear but they don't
  // outpace inflation either" intuition. Override in /settings if you
  // believe USD/EUR appreciation is part of your thesis.
  FOREX: 5,
} as const;

export type AssetClassKey = keyof typeof DEFAULT_GROWTH_RATES;

export type AssetGrowthRates = Record<AssetClassKey, number>;
