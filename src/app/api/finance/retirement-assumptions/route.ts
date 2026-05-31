/**
 * GET    /api/finance/retirement-assumptions   — current planning inputs
 * PATCH  /api/finance/retirement-assumptions   — partial update of any field
 *
 * Singleton row per user. Defaults applied on first use.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, retirementAssumptions } from '@/db';
import { auth } from '@/auth';

async function ensureRow(userId: string) {
  const rows = await db
    .select()
    .from(retirementAssumptions)
    .where(eq(retirementAssumptions.userId, userId))
    .limit(1);
  if (rows.length) return rows[0];
  const [inserted] = await db
    .insert(retirementAssumptions)
    .values({ userId })
    .returning();
  return inserted;
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const row = await ensureRow(session.user.id);
    return NextResponse.json(row);
  } catch (err) {
    console.error('GET retirement-assumptions:', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const body = await request.json();
    const existing = await ensureRow(session.user.id);
    const update: Partial<typeof retirementAssumptions.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (typeof body.currentAge === 'number' && body.currentAge >= 0)
      update.currentAge = Math.round(body.currentAge);
    if (typeof body.targetAge === 'number' && body.targetAge >= 0)
      update.targetAge = Math.round(body.targetAge);
    if (typeof body.monthlyExpenseRupees === 'number' && body.monthlyExpenseRupees >= 0)
      update.monthlyExpenseRupees = Math.round(body.monthlyExpenseRupees);
    if (typeof body.inflationPct === 'number' && body.inflationPct >= 0)
      update.inflationPct = body.inflationPct;
    if (typeof body.expectedReturnPct === 'number' && body.expectedReturnPct >= 0)
      update.expectedReturnPct = body.expectedReturnPct;
    if (typeof body.postRetirementReturnPct === 'number' && body.postRetirementReturnPct >= 0)
      update.postRetirementReturnPct = body.postRetirementReturnPct;
    if (typeof body.retirementDurationYears === 'number' && body.retirementDurationYears >= 0)
      update.retirementDurationYears = Math.round(body.retirementDurationYears);
    if (typeof body.npsIncomeGrows === 'boolean') update.npsIncomeGrows = body.npsIncomeGrows;
    if (typeof body.annuityIncomeGrows === 'boolean') update.annuityIncomeGrows = body.annuityIncomeGrows;
    if (typeof body.insuranceLadderIncomeGrows === 'boolean')
      update.insuranceLadderIncomeGrows = body.insuranceLadderIncomeGrows;
    if (typeof body.rentalIncomeGrows === 'boolean') update.rentalIncomeGrows = body.rentalIncomeGrows;
    if (typeof body.ladderStartAge === 'number' && body.ladderStartAge >= 0)
      update.ladderStartAge = Math.round(body.ladderStartAge);
    if (typeof body.bucketEnabled === 'boolean') update.bucketEnabled = body.bucketEnabled;
    if (typeof body.liquidPct === 'number' && body.liquidPct >= 0) update.liquidPct = body.liquidPct;
    if (typeof body.stablePct === 'number' && body.stablePct >= 0) update.stablePct = body.stablePct;
    if (typeof body.growthPct === 'number' && body.growthPct >= 0) update.growthPct = body.growthPct;
    if (typeof body.liquidReturnPct === 'number' && body.liquidReturnPct >= 0)
      update.liquidReturnPct = body.liquidReturnPct;
    if (typeof body.stableReturnPct === 'number' && body.stableReturnPct >= 0)
      update.stableReturnPct = body.stableReturnPct;
    if (typeof body.growthReturnPct === 'number' && body.growthReturnPct >= 0)
      update.growthReturnPct = body.growthReturnPct;
    if (typeof body.liquidYrsHeld === 'number' && body.liquidYrsHeld >= 0)
      update.liquidYrsHeld = body.liquidYrsHeld;
    if (typeof body.stableYrsHeld === 'number' && body.stableYrsHeld >= 0)
      update.stableYrsHeld = body.stableYrsHeld;

    const [updated] = await db
      .update(retirementAssumptions)
      .set(update)
      .where(and(eq(retirementAssumptions.id, existing.id), eq(retirementAssumptions.userId, session.user.id)))
      .returning();
    return NextResponse.json(updated);
  } catch (err) {
    console.error('PATCH retirement-assumptions:', err);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}
