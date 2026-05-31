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
} from '@/lib/finance/goal-corpus';
import { projectGoal } from '@/lib/finance/goal-projection';

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
      })),
    );

    const projection = projectGoal({
      goal,
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
    });

    return NextResponse.json({
      projection,
      seed: {
        initialCorpusPaisa,
        yearlyContributionPaisa,
        oneTimeEarmarksCount: earmarked.filter((e) => e.frequency === 'ONE_TIME').length,
        recurringEarmarksCount: earmarked.filter((e) => e.frequency !== 'ONE_TIME').length,
      },
    });
  } catch (err) {
    console.error('[goals/:id/projection GET]', err);
    return NextResponse.json({ error: 'Failed to compute projection' }, { status: 500 });
  }
}
