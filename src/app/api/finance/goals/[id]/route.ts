/**
 * Financial Goal — single-record detail + partial update + soft-delete.
 *
 * GET    → goal + asset mapping rows + earmarked cashflow events
 * PATCH  → diff-update (only the fields you send are touched)
 * DELETE → soft delete (sets is_active = false). The
 *          savings_asset_inclusion FK has ON DELETE CASCADE on goal_id
 *          but since we're soft-deleting, the rows stay around if the
 *          user reactivates.
 *
 * Money convention here matches /api/finance/goals: PAISA on the wire
 * for targetAmount + disbursementAmountPerYrPaisa.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';
import {
  db,
  financialGoals,
  savingsAssetInclusion,
  cashflowEvents,
  type GoalType,
  type DisbursementType,
} from '@/db';
import { auth } from '@/auth';

const VALID_GOAL_TYPES: GoalType[] = [
  'HOUSE', 'CAR', 'EDUCATION', 'TRAVEL',
  'EMERGENCY', 'WEDDING', 'BUSINESS', 'OTHER',
];

const VALID_DISBURSEMENT_TYPES: DisbursementType[] = [
  'LUMPSUM', 'FIXED_PERIOD_SWP', 'INFLATION_SWP',
];

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

    const inclusionRows = await db
      .select()
      .from(savingsAssetInclusion)
      .where(
        and(
          eq(savingsAssetInclusion.goalId, numericId),
          eq(savingsAssetInclusion.userId, session.user.id),
        ),
      );

    const earmarked = await db
      .select()
      .from(cashflowEvents)
      .where(
        and(
          eq(cashflowEvents.goalId, numericId),
          eq(cashflowEvents.userId, session.user.id),
        ),
      )
      .orderBy(asc(cashflowEvents.startDate));

    return NextResponse.json({
      goal: rows[0],
      inclusions: inclusionRows,
      earmarkedEvents: earmarked,
    });
  } catch (err) {
    console.error('[goals/:id GET]', err);
    return NextResponse.json({ error: 'Failed to fetch goal' }, { status: 500 });
  }
}

interface PatchBody {
  name?: string;
  targetAmount?: number;      // paisa
  targetDate?: string | null;
  color?: string;
  currentAmount?: number;     // paisa
  isActive?: boolean;
  goalType?: GoalType;
  disbursementType?: DisbursementType;
  disbursementAmountPerYrPaisa?: number | null;
  disbursementYears?: number | null;
  disbursementStartDate?: string | null;
  growthPctPerYr?: number;
  expectedReturnPct?: number;
  inflationPct?: number;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    const existing = await db
      .select()
      .from(financialGoals)
      .where(
        and(
          eq(financialGoals.id, numericId),
          eq(financialGoals.userId, session.user.id),
        ),
      )
      .limit(1);
    if (!existing.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body = (await request.json()) as PatchBody;

    if (body.goalType !== undefined && !VALID_GOAL_TYPES.includes(body.goalType)) {
      return NextResponse.json({ error: 'Invalid goalType' }, { status: 400 });
    }
    if (
      body.disbursementType !== undefined &&
      !VALID_DISBURSEMENT_TYPES.includes(body.disbursementType)
    ) {
      return NextResponse.json({ error: 'Invalid disbursementType' }, { status: 400 });
    }

    const update: Partial<typeof financialGoals.$inferInsert> = {};
    if (body.name !== undefined) update.name = body.name;
    if (body.targetAmount !== undefined) update.targetAmount = body.targetAmount;
    if (body.targetDate !== undefined) update.targetDate = body.targetDate;
    if (body.color !== undefined) update.color = body.color;
    if (body.currentAmount !== undefined) update.currentAmount = body.currentAmount;
    if (body.isActive !== undefined) update.isActive = body.isActive;
    if (body.goalType !== undefined) update.goalType = body.goalType;
    if (body.disbursementType !== undefined) update.disbursementType = body.disbursementType;
    if (body.disbursementAmountPerYrPaisa !== undefined) {
      update.disbursementAmountPerYrPaisa = body.disbursementAmountPerYrPaisa;
    }
    if (body.disbursementYears !== undefined) update.disbursementYears = body.disbursementYears;
    if (body.disbursementStartDate !== undefined) {
      update.disbursementStartDate = body.disbursementStartDate;
    }
    if (body.growthPctPerYr !== undefined) update.growthPctPerYr = body.growthPctPerYr;
    if (body.expectedReturnPct !== undefined) update.expectedReturnPct = body.expectedReturnPct;
    if (body.inflationPct !== undefined) update.inflationPct = body.inflationPct;

    const result = await db
      .update(financialGoals)
      .set(update)
      .where(
        and(
          eq(financialGoals.id, numericId),
          eq(financialGoals.userId, session.user.id),
        ),
      )
      .returning();
    return NextResponse.json({ goal: result[0] });
  } catch (err) {
    console.error('[goals/:id PATCH]', err);
    return NextResponse.json({ error: 'Failed to update goal' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    // Soft delete: keep inclusion rows in place so the user can
    // reactivate without losing their asset mappings.
    await db
      .update(financialGoals)
      .set({ isActive: false })
      .where(
        and(
          eq(financialGoals.id, numericId),
          eq(financialGoals.userId, session.user.id),
        ),
      );
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[goals/:id DELETE]', err);
    return NextResponse.json({ error: 'Failed to delete goal' }, { status: 500 });
  }
}
