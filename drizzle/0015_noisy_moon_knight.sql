ALTER TABLE "savings_asset_inclusion" ADD COLUMN "allocation_pct" real DEFAULT 100 NOT NULL;--> statement-breakpoint
-- Per-row sanity check. Cross-row sum-≤-100 invariant is enforced at
-- the API layer (PATCH /api/finance/goals/[id]/assets validates the
-- sum across all goal-specific rows for the same asset before writing).
ALTER TABLE "savings_asset_inclusion"
  ADD CONSTRAINT "allocation_pct_in_range"
  CHECK (allocation_pct >= 0 AND allocation_pct <= 100);--> statement-breakpoint
-- Data cleanup: any asset currently included for multiple goals (the
-- duplicate-counting bug Sprint 3.5 introduced) gets its rows split
-- equally across those goals. MUTUAL_FUNDS claimed by 2 goals → 50%
-- each; by 3 goals → 33.33% each (rounding error tolerated). Goal-NULL
-- rows (global savings toggle) are unaffected.
WITH duplicates AS (
  SELECT
    user_id,
    asset_class,
    source_id,
    count(*) AS goal_count
  FROM savings_asset_inclusion
  WHERE included = true AND goal_id IS NOT NULL
  GROUP BY user_id, asset_class, source_id
  HAVING count(*) > 1
)
UPDATE savings_asset_inclusion s
SET allocation_pct = ROUND((100.0 / d.goal_count)::numeric, 2)::real
FROM duplicates d
WHERE
  s.user_id = d.user_id
  AND s.asset_class = d.asset_class
  AND s.source_id IS NOT DISTINCT FROM d.source_id
  AND s.goal_id IS NOT NULL
  AND s.included = true;
