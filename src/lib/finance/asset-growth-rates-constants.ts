/**
 * Pure constants extracted from asset-growth-rates.ts so client
 * components can import DEFAULT_GROWTH_RATES without dragging
 * `db` (postgres) into the client bundle.
 *
 * Server-side code should still import from asset-growth-rates.ts to
 * get both the constants AND the getGrowthRates() helper.
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
  SMALL_SAVINGS: 7.5,
  FIXED_DEPOSITS: 7,
  CHIT_FUNDS: 6,
  INSURANCE_POLICIES: 5,
} as const;

export type AssetClassKey = keyof typeof DEFAULT_GROWTH_RATES;

export type AssetGrowthRates = Record<AssetClassKey, number>;
