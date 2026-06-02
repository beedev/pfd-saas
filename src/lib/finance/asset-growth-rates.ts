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
 * defaults defined in asset-growth-rates-constants.ts.
 *
 * IMPORTANT: the seed defaults in
 * src/app/api/settings/asset-class-returns/route.ts must stay aligned
 * with DEFAULT_GROWTH_RATES. If you change a default, change both.
 *
 * NOTE: This file imports `db` and is therefore server-only. Client
 * components that just need the static defaults must import from
 * './asset-growth-rates-constants' instead to keep `postgres` out of
 * the client bundle.
 */

import { eq } from 'drizzle-orm';
import { db, assetClassReturns } from '@/db';
import {
  DEFAULT_GROWTH_RATES,
  type AssetClassKey,
  type AssetGrowthRates,
} from './asset-growth-rates-constants';

// Re-export so existing server-side imports `from '@/lib/finance/asset-growth-rates'`
// keep working without churn.
export { DEFAULT_GROWTH_RATES };
export type { AssetClassKey, AssetGrowthRates };

/**
 * Resolve the right growth rate for a single MF based on its category.
 *
 * EQUITY → MF_EQUITY, DEBT → MF_DEBT, HYBRID → MF_HYBRID. UNKNOWN funds
 * (default for newly-imported funds before the user categorises them)
 * fall back to the EQUITY rate — the most common case and conservative
 * relative to the umbrella MUTUAL_FUNDS rate (which is also 11 by default
 * but is intended for genuinely uncategorised aggregate reporting). The
 * fallback chain is documented here so callers don't have to re-derive
 * it.
 *
 * The umbrella `MUTUAL_FUNDS` rate stays in `rates` for code paths that
 * still aggregate at the class level (e.g. `weightedReturnForGoal` when
 * the goal has an aggregate MUTUAL_FUNDS inclusion with no per-fund
 * sourceId). This helper is for the per-fund path where category drives
 * the bucket.
 */
export function getMfRate(
  category: 'EQUITY' | 'DEBT' | 'HYBRID' | 'UNKNOWN' | null | undefined,
  rates: AssetGrowthRates,
): number {
  switch (category) {
    case 'EQUITY':
      return rates.MF_EQUITY;
    case 'DEBT':
      return rates.MF_DEBT;
    case 'HYBRID':
      return rates.MF_HYBRID;
    case 'UNKNOWN':
    case null:
    case undefined:
    default:
      return rates.MF_EQUITY;
  }
}

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
