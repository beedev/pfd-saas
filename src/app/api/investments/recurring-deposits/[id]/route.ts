/**
 * GET    /api/investments/recurring-deposits/[id]   — one RD
 * PATCH  /api/investments/recurring-deposits/[id]   — partial update (rupees for money)
 * DELETE /api/investments/recurring-deposits/[id]   — hard delete
 *
 * PATCH recomputes maturityDate, totalDeposit and maturityAmount whenever any
 * of installment, interestRate, tenure, startDate or compounding change —
 * unless maturityAmount is explicitly supplied, in which case the user wins.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, recurringDeposits, type RDCompoundingFreq, type RDStatus } from '@/db';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';
import { calculateRdMaturityPaisa, rdTotalDepositPaisa, addMonthsIso } from '@/lib/finance/rd';
import { syncRdInterest } from '@/lib/finance/rd-interest';

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    const rows = await db
      .select()
      .from(recurringDeposits)
      .where(and(eq(recurringDeposits.id, numericId), eq(recurringDeposits.userId, userId)))
      .limit(1);
    if (!rows.length) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ recurringDeposit: rows[0] });
  } catch (err) {
    console.error('GET rd by id:', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    const existing = (
      await db
        .select()
        .from(recurringDeposits)
        .where(and(eq(recurringDeposits.id, numericId), eq(recurringDeposits.userId, userId)))
        .limit(1)
    )[0];
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const body = await req.json();
    const update: Partial<typeof recurringDeposits.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (typeof body.bankName === 'string') update.bankName = body.bankName.trim();
    if (body.accountNumber !== undefined)
      update.accountNumber = body.accountNumber?.trim() || null;
    if (typeof body.monthlyInstallment === 'number' && body.monthlyInstallment > 0)
      update.monthlyInstallmentPaisa = Math.round(body.monthlyInstallment * 100);
    if (typeof body.interestRate === 'number' && body.interestRate > 0)
      update.interestRate = body.interestRate;
    if (Number.isInteger(body.tenureMonths) && body.tenureMonths > 0)
      update.tenureMonths = body.tenureMonths;
    if (
      body.compoundingFreq === 'MONTHLY' ||
      body.compoundingFreq === 'QUARTERLY' ||
      body.compoundingFreq === 'HALF_YEARLY' ||
      body.compoundingFreq === 'YEARLY'
    )
      update.compoundingFreq = body.compoundingFreq as RDCompoundingFreq;
    if (typeof body.startDate === 'string') update.startDate = body.startDate;
    if (body.status === 'ACTIVE' || body.status === 'MATURED' || body.status === 'BROKEN')
      update.status = body.status as RDStatus;
    if (typeof body.autoRenew === 'boolean') update.autoRenew = body.autoRenew;
    if (typeof body.prematureWithdrawalPenaltyPct === 'number')
      update.prematureWithdrawalPenaltyPct = body.prematureWithdrawalPenaltyPct;
    if (body.jointHolderName !== undefined)
      update.jointHolderName = body.jointHolderName?.trim() || null;
    if (body.notes !== undefined) update.notes = body.notes?.trim() || null;

    // Recompute derived fields from the merged values.
    const installment = update.monthlyInstallmentPaisa ?? existing.monthlyInstallmentPaisa;
    const rate = update.interestRate ?? existing.interestRate;
    const tenure = update.tenureMonths ?? existing.tenureMonths;
    const startDate = update.startDate ?? existing.startDate;
    const compFreq =
      (update.compoundingFreq as RDCompoundingFreq | undefined) ??
      (existing.compoundingFreq as RDCompoundingFreq | null) ??
      'QUARTERLY';

    update.maturityDate = addMonthsIso(startDate, tenure);
    update.totalDepositPaisa = rdTotalDepositPaisa(installment, tenure);

    if (typeof body.maturityAmount === 'number' && body.maturityAmount > 0) {
      update.maturityAmountPaisa = Math.round(body.maturityAmount * 100);
    } else {
      update.maturityAmountPaisa = calculateRdMaturityPaisa(installment, rate, tenure, compFreq);
    }

    const [updated] = await db
      .update(recurringDeposits)
      .set(update)
      .where(and(eq(recurringDeposits.id, numericId), eq(recurringDeposits.userId, userId)))
      .returning();
    await syncRdInterest(userId); // refresh RD maturity interest (handles closure)
    return NextResponse.json({ recurringDeposit: updated });
  } catch (err) {
    console.error('PATCH rd:', err);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    await db
      .delete(recurringDeposits)
      .where(and(eq(recurringDeposits.id, numericId), eq(recurringDeposits.userId, userId)));
    await syncRdInterest(userId); // remove this RD's auto interest row
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('DELETE rd:', err);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
