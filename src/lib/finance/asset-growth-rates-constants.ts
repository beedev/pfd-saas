/**
 * Pure constants extracted from asset-growth-rates.ts so client
 * components can import DEFAULT_GROWTH_RATES without dragging
 * `db` (postgres) into the client bundle.
 *
 * Server-side code should still import from asset-growth-rates.ts to
 * get both the constants AND the getGrowthRates() helper.
 */

/**
 * EPF annual interest rate (%). Single source of truth — consumed by the
 * /retirement top-tile projection (page.tsx), the retirement-corpus-
 * breakdown endpoint, and the asset-class-returns seed so the three
 * surfaces can never drift apart.
 */
export const PF_ANNUAL_RATE_PCT = 8.25;

/**
 * EQUITY / DEBT — direct exposure rates (Indian equity, govt + corp
 * bonds). MUTUAL_FUNDS is the legacy umbrella rate kept for back-compat
 * (used when a fund's category is UNKNOWN). The MF_EQUITY / MF_DEBT /
 * MF_HYBRID rates are MF-subclass rates — picked when the per-fund
 * `category` column resolves to one of those. The distinction matters
 * because an MF wrapping equity carries a fee drag vs. direct equity,
 * so a slightly lower MF_EQUITY (11) vs EQUITY (12 in STOCKS below) is
 * appropriate. See Sprint 5.7.
 *
 * DRIFT NOTE (audit A7, 2026-06 — determined from git history, numbers
 * deliberately left untouched): GOLD 8 / NPS 9 / REAL_ESTATE 5 here do
 * NOT match the per-user seed in
 * src/app/api/settings/asset-class-returns/route.ts (GOLD 9 / NPS 9.5 /
 * REAL_ESTATE 6 — which matches goal-corpus.ts
 * DEFAULT_RETURN_PCT_BY_CLASS). This is ACCIDENTAL drift, not two
 * intentional rate sets: this constant was introduced (Sprint 5.5b,
 * f5f47f4) claiming "values match the seed", but the seed already
 * carried 9 / 9.5 / 6 at that point. In effect the lower values here
 * only apply BEFORE the lazy per-user seed runs (first GET of
 * /api/settings/asset-class-returns) or for keys the seed never inserts
 * (EQUITY / DEBT / CASH). Reconciling the numbers would change
 * projections for un-seeded users, so it is out of scope for a
 * behavior-preserving pass.
 */
export const DEFAULT_GROWTH_RATES = {
  EQUITY: 10,
  DEBT: 7,
  GOLD: 8,
  NPS: 9,
  PF: PF_ANNUAL_RATE_PCT,
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
