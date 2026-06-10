/**
 * Shared bits for the retirement / savings asset-aggregation routes —
 * audit A7 dedup.
 *
 * Constants + tiny helpers that were previously declared independently
 * (and identically) in the four near-twin routes:
 *
 *   • /api/finance/goals/[id]/assets
 *   • /api/finance/savings-assets
 *   • /api/finance/retirement-assets
 *   • /api/finance/retirement-corpus-breakdown
 *
 * Only PROVABLY identical code lives here. Deliberately NOT extracted:
 *
 *   • `buildLookup` (goals/[id]/assets) vs `lookupIncluded`
 *     (savings-assets) — different behaviour: the former is
 *     allocation-aware (returns allocationPct + otherAllocations,
 *     included defaults to false), the latter returns a bare boolean
 *     with a caller-supplied per-class fallback default.
 *   • `compound()` / `yearsBetween()` in retirement-corpus-breakdown —
 *     they mirror the client-side /retirement page tile math with
 *     UNROUNDED floats so the server breakdown reconciles with the
 *     browser reduction byte-for-byte. `projectFutureValue()` in
 *     asset-projection.ts rounds each component (`Math.round`) and is
 *     therefore NOT numerically identical; do not swap one for the
 *     other.
 *
 * No DB, no IO — the RetirementAssetSelection import is type-only.
 */

import type { RetirementAssetSelection } from '@/db';

/**
 * Endowment-style policy types that mature with a payout — the set the
 * asset pickers expose for savings/corpus contribution (vs. pure term
 * cover, which never pays out at maturity).
 */
export const MATURING_POLICY_TYPES = ['WHOLE_LIFE', 'ENDOWMENT', 'ULIP', 'MONEY_BACK'];

/**
 * Find the per-item retirement_asset_selection row for an
 * (assetClass, sourceId) pair. Returns undefined when the user has
 * never toggled the item — callers apply their class-specific default.
 */
export function findRetirementSelection(
  rows: RetirementAssetSelection[],
  assetClass: string,
  sourceId: number,
): RetirementAssetSelection | undefined {
  return rows.find((r) => r.assetClass === assetClass && r.sourceId === sourceId);
}
