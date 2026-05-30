import { NextRequest, NextResponse } from 'next/server';
import { eq, and, asc } from 'drizzle-orm';
import { db, sips, mutualFunds, investmentTransactions } from '@/db';

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    const sipRows = await db
      .select()
      .from(sips)
      .where(eq(sips.id, numericId))
      .limit(1);
    if (!sipRows.length) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const sip = sipRows[0];

    const mfRows = await db
      .select()
      .from(mutualFunds)
      .where(eq(mutualFunds.id, sip.mutualFundId))
      .limit(1);
    const mf = mfRows[0] ?? null;

    const txns = await db
      .select()
      .from(investmentTransactions)
      .where(
        and(
          eq(investmentTransactions.assetType, 'MUTUAL_FUND'),
          eq(investmentTransactions.assetId, sip.mutualFundId)
        )
      )
      .orderBy(asc(investmentTransactions.transactionDate));

    return NextResponse.json({ sip, mutualFund: mf, transactions: txns });
  } catch (error) {
    console.error('Error fetching SIP:', error);
    return NextResponse.json({ error: 'Failed to fetch SIP' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    const body = await request.json();

    const existing = await db
      .select()
      .from(sips)
      .where(eq(sips.id, numericId))
      .limit(1);
    if (!existing.length) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const current = existing[0];

    const update: Partial<typeof sips.$inferInsert> = { updatedAt: new Date() };
    if (body.status !== undefined) update.status = body.status;
    if (typeof body.monthlyAmountRupees === 'number') {
      update.monthlyAmount = Math.round(body.monthlyAmountRupees * 100);
    } else if (typeof body.monthlyAmount === 'number') {
      // Legacy: amount already in rupees from old callers
      update.monthlyAmount = Math.round(body.monthlyAmount * 100);
    }
    if (typeof body.frequency === 'string') update.frequency = body.frequency as 'MONTHLY' | 'QUARTERLY';
    if (typeof body.startDate === 'string') update.startDate = body.startDate;
    if (body.endDate !== undefined) update.endDate = body.endDate;
    if (body.nextExecutionDate !== undefined) update.nextExecutionDate = body.nextExecutionDate;
    if (typeof body.startingUnits === 'number') update.startingUnits = body.startingUnits;
    if (typeof body.startingNavRupees === 'number') {
      update.startingNav = Math.round(body.startingNavRupees * 100);
    }
    if (typeof body.totalInvestedSoFarRupees === 'number') {
      update.totalInvestedSoFar = Math.round(body.totalInvestedSoFarRupees * 100);
    }
    if (body.notes !== undefined) update.notes = body.notes;

    const result = await db
      .update(sips)
      .set(update)
      .where(eq(sips.id, numericId))
      .returning();

    return NextResponse.json({ sip: result[0] });
  } catch (error) {
    console.error('Error updating SIP:', error);
    return NextResponse.json({ error: 'Failed to update SIP' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    await db.delete(sips).where(eq(sips.id, numericId));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting SIP:', error);
    return NextResponse.json({ error: 'Failed to delete SIP' }, { status: 500 });
  }
}
