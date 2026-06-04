/**
 * Financial Goals — list + create + update + soft-delete.
 *
 * Sprint 3.5 Phase 3 expanded the schema with disbursement fields
 * (goal_type, disbursement_type, …). This route was already wired
 * into /projections so the existing GET/POST/PUT/DELETE shape stays
 * intact; we just extend the payloads to round-trip the new fields.
 *
 * Money convention here is PAISA on the wire for `targetAmount` and
 * `disbursementAmountPerYrPaisa` — kept that way for backwards-compat
 * with the projections page that already calls in with paisa. New
 * callers (the dedicated /goals UI) convert at the client edge.
 *
 * GET returns each goal enriched with:
 *   • currentCorpusPaisa     — sum of values of assets mapped to the
 *                              goal via savings_asset_inclusion.
 *   • yearlyContributionPaisa — estimated annual inflows from SIPs of
 *                              mapped MFs + recurring cashflow events
 *                              earmarked to this goal.
 *   • plus legacy fields (currentAmount/progress/monthsRemaining/
 *     monthlyRequired/linkedCategories) for the /projections page.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  db,
  financialGoals,
  projectionCategories,
  carryforwardBalances,
  projectionEntries,
  cashflowEvents,
  type GoalType,
  type DisbursementType,
} from '@/db';
import { eq, and, lte, asc, sum } from 'drizzle-orm';
import { auth } from '@/auth';
import {
  loadCorpusContext,
  corpusForGoal,
  yearlyContributionForGoal,
} from '@/lib/finance/goal-corpus';

const VALID_GOAL_TYPES: GoalType[] = [
  'HOUSE', 'CAR', 'EDUCATION', 'TRAVEL',
  'EMERGENCY', 'WEDDING', 'BUSINESS', 'OTHER',
];

const VALID_DISBURSEMENT_TYPES: DisbursementType[] = [
  'LUMPSUM', 'FIXED_PERIOD_SWP', 'INFLATION_SWP',
];

/* ──────────────────────────────────────────────────────────────────── */
/* GET                                                                 */
/* ──────────────────────────────────────────────────────────────────── */

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const goals = await db
      .select()
      .from(financialGoals)
      .where(and(eq(financialGoals.isActive, true), eq(financialGoals.userId, session.user.id)))
      .orderBy(asc(financialGoals.id));

    // Legacy projection-category linkage (kept for /projections backward-compat)
    const linkedCategories = await db
      .select({
        goalId: projectionCategories.goalId,
        categoryId: projectionCategories.id,
        categoryName: projectionCategories.name,
        isInflow: projectionCategories.isInflow,
      })
      .from(projectionCategories)
      .where(and(eq(projectionCategories.isActive, true), eq(projectionCategories.userId, session.user.id)));

    const carryforwards = await db
      .select()
      .from(carryforwardBalances)
      .where(eq(carryforwardBalances.userId, session.user.id));

    const now = new Date();
    const currentPeriod = `${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getFullYear()}`;

    const contributions = await db
      .select({
        categoryId: projectionEntries.categoryId,
        totalAmount: sum(projectionEntries.amount),
      })
      .from(projectionEntries)
      .where(and(lte(projectionEntries.period, currentPeriod), eq(projectionEntries.userId, session.user.id)))
      .groupBy(projectionEntries.categoryId);

    // Phase 3 enrichment: load corpus context + recurring earmarked events
    const ctx = await loadCorpusContext(session.user.id);
    const events = await db
      .select()
      .from(cashflowEvents)
      .where(eq(cashflowEvents.userId, session.user.id));

    const goalDetails = goals.map(goal => {
      const goalCategories = linkedCategories.filter(c => c.goalId === goal.id);

      let amountSaved = 0;
      let amountFunded = 0;
      goalCategories.forEach(cat => {
        const carryforward = carryforwards.find(c => c.categoryId === cat.categoryId);
        const contribution = contributions.find(c => c.categoryId === cat.categoryId);
        if (carryforward) amountSaved += carryforward.amount;
        if (contribution && contribution.totalAmount) {
          amountFunded += Number(contribution.totalAmount);
        }
      });

      const currentAmount = amountFunded;
      const progress = goal.targetAmount > 0
        ? Math.min(100, Math.round((currentAmount / goal.targetAmount) * 100))
        : 0;

      let monthsRemaining: number | null = null;
      if (goal.targetDate) {
        const targetDate = new Date(goal.targetDate);
        const monthsDiff = (targetDate.getFullYear() - now.getFullYear()) * 12
          + (targetDate.getMonth() - now.getMonth());
        monthsRemaining = Math.max(0, monthsDiff);
      }

      const amountRemaining = Math.max(0, goal.targetAmount - currentAmount);
      const monthlyRequired = monthsRemaining && monthsRemaining > 0
        ? Math.round(amountRemaining / monthsRemaining)
        : null;

      // Phase 3: asset-mapped corpus + estimated yearly contribution
      const currentCorpusPaisa = corpusForGoal(ctx, goal.id);
      const yearlyContributionPaisa = yearlyContributionForGoal(
        ctx,
        goal.id,
        events.map((e) => ({
          amountPaisa: e.amountPaisa,
          frequency: e.frequency,
          goalId: e.goalId ?? null,
          sourceKind: e.sourceKind ?? null,
          autoDerived: e.autoDerived ?? false,
        })),
      );

      return {
        ...goal,
        currentAmount,
        progress,
        monthsRemaining,
        monthlyRequired,
        linkedCategories: goalCategories.map(c => c.categoryName),
        currentCorpusPaisa,
        yearlyContributionPaisa,
        amountSaved,
      };
    });

    return NextResponse.json({ goals: goalDetails });
  } catch (error) {
    console.error('Error fetching goals:', error);
    return NextResponse.json(
      { error: 'Failed to fetch goals' },
      { status: 500 }
    );
  }
}

/* ──────────────────────────────────────────────────────────────────── */
/* POST                                                                */
/* ──────────────────────────────────────────────────────────────────── */

interface GoalBody {
  name?: string;
  targetAmount?: number;       // paisa (backwards-compat — projections page)
  targetDate?: string | null;
  color?: string;
  currentAmount?: number;       // paisa
  goalType?: GoalType;
  disbursementType?: DisbursementType;
  disbursementAmountPerYrPaisa?: number | null;
  disbursementYears?: number | null;
  disbursementStartDate?: string | null;
  growthPctPerYr?: number;
  expectedReturnPct?: number;
  inflationPct?: number;
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const body = (await request.json()) as GoalBody;
    const { name, targetAmount } = body;

    if (!name || typeof targetAmount !== 'number') {
      return NextResponse.json(
        { error: 'Name and target amount are required' },
        { status: 400 }
      );
    }

    if (body.goalType !== undefined && !VALID_GOAL_TYPES.includes(body.goalType)) {
      return NextResponse.json({ error: 'Invalid goalType' }, { status: 400 });
    }
    if (
      body.disbursementType !== undefined &&
      !VALID_DISBURSEMENT_TYPES.includes(body.disbursementType)
    ) {
      return NextResponse.json({ error: 'Invalid disbursementType' }, { status: 400 });
    }

    const [goal] = await db.insert(financialGoals).values({
      userId: session.user.id,
      name,
      targetAmount,
      targetDate: body.targetDate || null,
      color: body.color || '#4CAF50',
      currentAmount: 0,
      isActive: true,
      goalType: body.goalType ?? 'OTHER',
      disbursementType: body.disbursementType ?? 'LUMPSUM',
      disbursementAmountPerYrPaisa: body.disbursementAmountPerYrPaisa ?? null,
      disbursementYears: body.disbursementYears ?? null,
      disbursementStartDate: body.disbursementStartDate ?? null,
      growthPctPerYr:
        typeof body.growthPctPerYr === 'number' ? body.growthPctPerYr : 0,
      expectedReturnPct:
        typeof body.expectedReturnPct === 'number' ? body.expectedReturnPct : 8,
      inflationPct:
        typeof body.inflationPct === 'number' ? body.inflationPct : 6,
    }).returning();

    return NextResponse.json({ goal }, { status: 201 });
  } catch (error) {
    console.error('Error creating goal:', error);
    return NextResponse.json(
      { error: 'Failed to create goal' },
      { status: 500 }
    );
  }
}

/* ──────────────────────────────────────────────────────────────────── */
/* PUT                                                                 */
/* ──────────────────────────────────────────────────────────────────── */

export async function PUT(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const body = (await request.json()) as GoalBody & { id?: number };
    const { id } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'Goal ID is required' },
        { status: 400 }
      );
    }

    if (body.goalType !== undefined && !VALID_GOAL_TYPES.includes(body.goalType)) {
      return NextResponse.json({ error: 'Invalid goalType' }, { status: 400 });
    }
    if (
      body.disbursementType !== undefined &&
      !VALID_DISBURSEMENT_TYPES.includes(body.disbursementType)
    ) {
      return NextResponse.json({ error: 'Invalid disbursementType' }, { status: 400 });
    }

    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.targetAmount !== undefined) updateData.targetAmount = body.targetAmount;
    if (body.targetDate !== undefined) updateData.targetDate = body.targetDate;
    if (body.color !== undefined) updateData.color = body.color;
    if (body.currentAmount !== undefined) updateData.currentAmount = body.currentAmount;
    if (body.goalType !== undefined) updateData.goalType = body.goalType;
    if (body.disbursementType !== undefined) updateData.disbursementType = body.disbursementType;
    if (body.disbursementAmountPerYrPaisa !== undefined) {
      updateData.disbursementAmountPerYrPaisa = body.disbursementAmountPerYrPaisa;
    }
    if (body.disbursementYears !== undefined) updateData.disbursementYears = body.disbursementYears;
    if (body.disbursementStartDate !== undefined) {
      updateData.disbursementStartDate = body.disbursementStartDate;
    }
    if (body.growthPctPerYr !== undefined) updateData.growthPctPerYr = body.growthPctPerYr;
    if (body.expectedReturnPct !== undefined) updateData.expectedReturnPct = body.expectedReturnPct;
    if (body.inflationPct !== undefined) updateData.inflationPct = body.inflationPct;

    await db
      .update(financialGoals)
      .set(updateData)
      .where(and(eq(financialGoals.id, id), eq(financialGoals.userId, session.user.id)));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating goal:', error);
    return NextResponse.json(
      { error: 'Failed to update goal' },
      { status: 500 }
    );
  }
}

/* ──────────────────────────────────────────────────────────────────── */
/* DELETE                                                              */
/* ──────────────────────────────────────────────────────────────────── */

export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'Goal ID is required' },
        { status: 400 }
      );
    }

    await db
      .update(financialGoals)
      .set({ isActive: false })
      .where(and(eq(financialGoals.id, parseInt(id)), eq(financialGoals.userId, session.user.id)));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting goal:', error);
    return NextResponse.json(
      { error: 'Failed to delete goal' },
      { status: 500 }
    );
  }
}
