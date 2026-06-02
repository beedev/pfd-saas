/**
 * Single source of truth for asset-class growth rates.
 *
 * Both the cashflow derivation layer AND the retirement-assets endpoint
 * read forward-projection rates from here. Without this helper they'd
 * each maintain their own copy of the asset_class_returns query +
 * fallback defaults, and the two surfaces would silently drift.
 *
 * The persisted source is the `asset_class_returns` table (per-user,
 * one row per asset class). When a key is missing from the table (e.g.
 * a class the user hasn't touched yet), we fall back to the conservative
 * defaults defined here.
 *
 * IMPORTANT: the seed defaults in
 * src/app/api/settings/asset-class-returns/route.ts must stay aligned
 * with DEFAULT_GROWTH_RATES here. If you change a default, change both.
 */

import { eq } from 'drizzle-orm';
import { db, assetClassReturns } from '@/db';

/**
 * Conservative starting assumptions when nothing's set per-user yet.
 * Values match the seed in settings/asset-class-returns/route.ts. NPS
 * 9 / PF 8.25 reflect long-run historical means (NPS Tier-I aggressive
 * mix; EPFO declared rates 2014-2024). Real estate held intentionally
 * conservative since most users overestimate.
 */
export const DEFAULT_GROWTH_RATES = {
  EQUITY: 10,
  DEBT: 7,
  GOLD: 8,
  NPS: 9,
  PF: 8.25,
  REAL_ESTATE: 5,
  CASH: 4,
  // Below mirror the seed in the settings endpoint — included so the
  // helper handles every key the seed inserts.
  STOCKS: 12,
  MUTUAL_FUNDS: 11,
  SMALL_SAVINGS: 7.5,
  FIXED_DEPOSITS: 7,
  CHIT_FUNDS: 6,
  INSURANCE_POLICIES: 5,
} as const;

export type AssetClassKey = keyof typeof DEFAULT_GROWTH_RATES;

export type AssetGrowthRates = Record<AssetClassKey, number>;

/**
 * Load per-user growth rates. Always returns a complete record — any
 * keys missing from the DB fall back to DEFAULT_GROWTH_RATES.
 *
 * Multi-tenant: scoped by userId.
 */
export async function getGrowthRates(userId: string): Promise<AssetGrowthRates> {
  const rows = await db
    .select()
    .from(assetClassReturns)
    .where(eq(assetClassReturns.userId, userId));

  const byClass = new Map<string, number>();
  for (const r of rows) {
    byClass.set(r.assetClass, r.returnPct);
  }

  const result = { ...DEFAULT_GROWTH_RATES } as AssetGrowthRates;
  for (const key of Object.keys(DEFAULT_GROWTH_RATES) as AssetClassKey[]) {
    const persisted = byClass.get(key);
    if (typeof persisted === 'number' && Number.isFinite(persisted)) {
      // Defensive: ignore zero or negative rates from the table — they
      // indicate a botched user override and the default is safer.
      if (persisted > 0) result[key] = persisted;
    }
  }
  return result;
}
