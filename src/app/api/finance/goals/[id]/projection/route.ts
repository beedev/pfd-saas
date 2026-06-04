/**
 * Goal Projection — year-by-year corpus simulation.
 *
 * GET /api/finance/goals/[id]/projection
 *
 * Pipeline:
 *   1. Load the goal.
 *   2. Compute initial corpus = sum of values of all mapped assets
 *      (savings_asset_inclusion.included = true for this goal).
 *   3. Compute baseline yearly contribution from active SIPs of
 *      mapped MFs + recurring earmarked cashflow events.
 *   4. Pull one-time + recurring cashflow events earmarked to this
 *      goal (the engine handles one-time vs recurring internally).
 *   5. Hand off to projectGoal() and return the resulting projection.
 *
 * Pure read — no mutations. Math lives in
 * src/lib/finance/goal-projection.ts.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, financialGoals, cashflowEvents } from '@/db';
import { auth } from '@/auth';
import {
  loadCorpusContext,
  corpusForGoal,
  yearlyContributionForGoal,
  weightedReturnForGoal,
} from '@/lib/finance/goal-corpus';
import { projectGoal } from '@/lib/finance/goal-projection';
import { projectAnnualTax } from '@/lib/finance/tax-projection';

/** Indian FY string for "today" — April–March cycle. */
function currentFy(): string {
  const now = new Date();
  const m = now.getMonth() + 1;
  const y = now.getFullYear();
  const startYear = m >= 4 ? y : y - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    const rows = await db
      .select()
      .from(financialGoals)
      .where(
        and(
          eq(financialGoals.id, numericId),
          eq(financialGoals.userId, session.user.id),
        ),
      )
      .limit(1);
    if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const goal = rows[0];

    const [ctx, allEvents, earmarked] = await Promise.all([
      loadCorpusContext(session.user.id),
      db
        .select()
        .from(cashflowEvents)
        .where(eq(cashflowEvents.userId, session.user.id)),
      db
        .select()
        .from(cashflowEvents)
        .where(
          and(
            eq(cashflowEvents.goalId, numericId),
            eq(cashflowEvents.userId, session.user.id),
          ),
        ),
    ]);

    const initialCorpusPaisa = corpusForGoal(ctx, numericId);
    const yearlyContributionPaisa = yearlyContributionForGoal(
      ctx,
      numericId,
      allEvents.map((e) => ({
        amountPaisa: e.amountPaisa,
        frequency: e.frequency,
        goalId: e.goalId ?? null,
        sourceKind: e.sourceKind ?? null,
        autoDerived: e.autoDerived ?? false,
      })),
    );

    // Per-asset-class growth rates → value-weighted average. Gold isn't
    // 8%, chits aren't 8%, equity isn't 8% — the goal's flat
    // expected_return_pct is a poor model when the mix is heterogeneous.
    // When ANY asset is mapped, override the goal's stored rate with the
    // weighted blend computed from the mix. When nothing's mapped yet,
    // fall back to the goal's stored expected_return_pct.
    const returnBreakdown = weightedReturnForGoal(ctx, numericId);
    const projectionGoal = returnBreakdown.bands.length > 0
      ? { ...goal, expectedReturnPct: returnBreakdown.weightedReturnPct }
      : goal;

    // Sprint 4 Phase 5 — pull the user's effective tax rate for the
    // current FY as a proxy for marginal rate. SIMPLIFICATION: marginal
    // rate would ideally be derived per-projection-year from projected
    // income at that year's slabs; that's a future refinement. Today
    // we use the effectiveRatePct under the recommended regime — a
    // conservative under-estimate for high earners (real marginal is
    // typically higher than effective) but it's directionally right
    // and stable across the projection horizon.
    const taxProjection = await projectAnnualTax(session.user.id, currentFy());
    const marginalRatePct = taxProjection?.effectiveRatePct ?? 0;

    const projection = projectGoal({
      goal: projectionGoal,
      initialCorpusPaisa,
      // The engine treats yearly contribution and earmarked events as
      // separate inputs. The yearlyContribution captures recurring
      // MONTHLY/YEARLY earmarks already (so we don't double-count by
      // also passing those into earmarkedEvents). The earmarkedEvents
      // input is therefore only the one-time events plus any growth-
      // adjusted recurring streams the engine will apply per year.
      //
      // To keep behaviour predictable: pass only ONE_TIME earmarked
      // events here. Recurring earmarks live in yearlyContribution.
      yearlyContributionPaisa,
      earmarkedEvents: earmarked.filter((e) => e.frequency === 'ONE_TIME'),
      today: new Date().toISOString().slice(0, 10),
      marginalRatePct,
    });

    return NextResponse.json({
      projection,
      seed: {
        initialCorpusPaisa,
        yearlyContributionPaisa,
        oneTimeEarmarksCount: earmarked.filter((e) => e.frequency === 'ONE_TIME').length,
        recurringEarmarksCount: earmarked.filter((e) => e.frequency !== 'ONE_TIME').length,
      },
      // Per-class growth breakdown — UI surfaces "Stocks ₹34K @ 12% ·
      // MFs ₹52L @ 11% · weighted: 11.0%" so the user sees WHY the
      // projection compounds at the rate it does.
      returnBreakdown,
      // Indicates whether the projection used the weighted blend or
      // fell back to the goal's stored expected_return_pct (when no
      // assets are mapped yet).
      returnSource: returnBreakdown.bands.length > 0 ? 'weighted-mix' : 'goal-default',
    });
  } catch (err) {
    console.error('[goals/:id/projection GET]', err);
    return NextResponse.json({ error: 'Failed to compute projection' }, { status: 500 });
  }
}
