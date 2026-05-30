import { NextRequest, NextResponse } from 'next/server';
import { eq, asc } from 'drizzle-orm';
import { db, chitFunds, chitFundInstallments } from '@/db';

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
    const rows = await db.select().from(chitFunds).where(eq(chitFunds.id, numericId)).limit(1);
    if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const installments = await db
      .select()
      .from(chitFundInstallments)
      .where(eq(chitFundInstallments.chitFundId, numericId))
      .orderBy(asc(chitFundInstallments.monthNumber));
    return NextResponse.json({ chitFund: rows[0], installments });
  } catch (error) {
    console.error('Error fetching chit fund:', error);
    return NextResponse.json({ error: 'Failed to fetch chit fund' }, { status: 500 });
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
      .from(chitFunds)
      .where(eq(chitFunds.id, numericId))
      .limit(1);
    if (!existing.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const current = existing[0];

    const update: Partial<typeof chitFunds.$inferInsert> = { updatedAt: new Date() };
    if (body.status !== undefined) update.status = body.status;
    if (typeof body.foremanName === 'string') update.foremanName = body.foremanName;
    if (typeof body.schemeName === 'string') update.schemeName = body.schemeName;
    if (typeof body.registrationNumber === 'string') update.registrationNumber = body.registrationNumber || null;
    if (typeof body.ticketNumber === 'string') update.ticketNumber = body.ticketNumber || null;
    if (typeof body.chitValueRupees === 'number') update.chitValue = Math.round(body.chitValueRupees * 100);
    if (typeof body.monthlyInstallmentRupees === 'number') update.monthlyInstallment = Math.round(body.monthlyInstallmentRupees * 100);
    if (typeof body.durationMonths === 'number') update.durationMonths = body.durationMonths;
    if (typeof body.groupSize === 'number') update.groupSize = body.groupSize;
    if (typeof body.startDate === 'string') update.startDate = body.startDate;
    if (typeof body.expectedEndDate === 'string') update.expectedEndDate = body.expectedEndDate;
    if (typeof body.foremanCommissionPct === 'number') update.foremanCommissionPct = body.foremanCommissionPct;
    if (typeof body.documentChargesRupees === 'number') {
      update.documentChargesPaisa = Math.round(body.documentChargesRupees * 100);
    }
    if (body.nextDueDate !== undefined) update.nextDueDate = body.nextDueDate;
    if (body.notes !== undefined) update.notes = body.notes;

    // Win-detail edits — accept the same shape as the /win endpoint:
    //   winBidRupees (bid amount, preferred) or winAmountRupees (cheque override)
    //   plus winMonth, winDate. Used after marking as won to correct entries.
    // Bid → cheque derivation: cheque = V − bid − doc (foreman is INSIDE the bid).
    const chitValuePaisa =
      typeof update.chitValue === 'number' ? update.chitValue : current.chitValue;
    const docChargesPaisa =
      typeof update.documentChargesPaisa === 'number'
        ? update.documentChargesPaisa
        : current.documentChargesPaisa ?? 0;
    let bidPaisa: number | null = null;
    if (typeof body.winBidRupees === 'number' && body.winBidRupees >= 0) {
      bidPaisa = Math.round(body.winBidRupees * 100);
    } else if (typeof body.winBidDiscountPct === 'number' && body.winBidDiscountPct >= 0) {
      bidPaisa = Math.round((body.winBidDiscountPct / 100) * chitValuePaisa);
    }
    if (bidPaisa != null) {
      update.winBidDiscountPct = (bidPaisa / chitValuePaisa) * 100;
      // Derive cheque unless caller explicitly overrides
      if (typeof body.winAmountRupees === 'number' && body.winAmountRupees >= 0) {
        update.winAmountReceived = Math.round(body.winAmountRupees * 100);
      } else {
        update.winAmountReceived = Math.max(0, chitValuePaisa - bidPaisa - docChargesPaisa);
      }
    } else if (typeof body.winAmountRupees === 'number' && body.winAmountRupees >= 0) {
      // Cheque-only edit — derive bid back from cheque.
      const cheque = Math.round(body.winAmountRupees * 100);
      update.winAmountReceived = cheque;
      const derivedBid = Math.max(0, chitValuePaisa - cheque - docChargesPaisa);
      update.winBidDiscountPct = (derivedBid / chitValuePaisa) * 100;
    }
    if (typeof body.winMonth === 'number' && body.winMonth > 0) update.winMonth = body.winMonth;
    if (typeof body.winDate === 'string') update.winDate = body.winDate;

    const result = await db
      .update(chitFunds)
      .set(update)
      .where(eq(chitFunds.id, numericId))
      .returning();
    return NextResponse.json({ chitFund: result[0] });
  } catch (error) {
    console.error('Error updating chit fund:', error);
    return NextResponse.json({ error: 'Failed to update chit fund' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    await db.delete(chitFunds).where(eq(chitFunds.id, numericId));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting chit fund:', error);
    return NextResponse.json({ error: 'Failed to delete chit fund' }, { status: 500 });
  }
}
