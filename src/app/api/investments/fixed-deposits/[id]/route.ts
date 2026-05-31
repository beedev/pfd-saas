/**
 * GET    /api/investments/fixed-deposits/[id]   — one FD
 * PATCH  /api/investments/fixed-deposits/[id]   — partial update (rupees for money)
 * DELETE /api/investments/fixed-deposits/[id]   — hard delete
 *
 * PATCH recomputes maturity_amount_paisa whenever any of principal,
 * interestRate, dates, or compounding/interest type change — unless
 * maturityAmount is explicitly supplied, in which case the user's value wins.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import {
  db,
  fixedDeposits,
  type FDCompoundingFreq,
  type FDInterestType,
  type FDStatus,
} from '@/db';
import { auth } from '@/auth';
import { calculateFdMaturityPaisa, monthsBetween } from '@/lib/finance/fd';

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
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
      .from(fixedDeposits)
      .where(and(eq(fixedDeposits.id, numericId), eq(fixedDeposits.userId, session.user.id)))
      .limit(1);
    if (!rows.length) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ fixedDeposit: rows[0] });
  } catch (err) {
    console.error('GET fd by id:', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    const existing = (
      await db
        .select()
        .from(fixedDeposits)
        .where(and(eq(fixedDeposits.id, numericId), eq(fixedDeposits.userId, session.user.id)))
        .limit(1)
    )[0];
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const body = await req.json();
    const update: Partial<typeof fixedDeposits.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (typeof body.bankName === 'string') update.bankName = body.bankName.trim();
    if (body.accountNumber !== undefined)
      update.accountNumber = body.accountNumber?.trim() || null;
    if (typeof body.principal === 'number' && body.principal > 0)
      update.principalPaisa = Math.round(body.principal * 100);
    if (typeof body.interestRate === 'number' && body.interestRate > 0)
      update.interestRate = body.interestRate;
    if (
      body.compoundingFreq === 'MONTHLY' ||
      body.compoundingFreq === 'QUARTERLY' ||
      body.compoundingFreq === 'HALF_YEARLY' ||
      body.compoundingFreq === 'YEARLY'
    )
      update.compoundingFreq = body.compoundingFreq as FDCompoundingFreq;
    if (body.interestType === 'CUMULATIVE' || body.interestType === 'NON_CUMULATIVE')
      update.interestType = body.interestType as FDInterestType;
    if (typeof body.startDate === 'string') update.startDate = body.startDate;
    if (typeof body.maturityDate === 'string') update.maturityDate = body.maturityDate;
    if (body.status === 'ACTIVE' || body.status === 'MATURED' || body.status === 'BROKEN')
      update.status = body.status as FDStatus;
    if (typeof body.isTaxSaver === 'boolean') update.isTaxSaver = body.isTaxSaver;
    if (typeof body.autoRenew === 'boolean') update.autoRenew = body.autoRenew;
    if (typeof body.prematureWithdrawalPenaltyPct === 'number')
      update.prematureWithdrawalPenaltyPct = body.prematureWithdrawalPenaltyPct;
    if (body.jointHolderName !== undefined)
      update.jointHolderName = body.jointHolderName?.trim() || null;
    if (body.notes !== undefined) update.notes = body.notes?.trim() || null;

    // Recompute tenure + maturity amount if any economic input changed and the
    // user didn't explicitly supply maturityAmount.
    const principal = update.principalPaisa ?? existing.principalPaisa;
    const rate = update.interestRate ?? existing.interestRate;
    const startDate = update.startDate ?? existing.startDate;
    const maturityDate = update.maturityDate ?? existing.maturityDate;
    const compFreq =
      (update.compoundingFreq as FDCompoundingFreq | undefined) ??
      (existing.compoundingFreq as FDCompoundingFreq | null) ??
      'QUARTERLY';
    const intType =
      (update.interestType as FDInterestType | undefined) ??
      (existing.interestType as FDInterestType | null) ??
      'CUMULATIVE';
    const tenureMonths = monthsBetween(startDate, maturityDate);
    update.tenureMonths = tenureMonths;

    if (typeof body.maturityAmount === 'number' && body.maturityAmount > 0) {
      update.maturityAmountPaisa = Math.round(body.maturityAmount * 100);
    } else {
      update.maturityAmountPaisa = calculateFdMaturityPaisa(
        principal,
        rate,
        tenureMonths,
        compFreq,
        intType,
      );
    }

    const [updated] = await db
      .update(fixedDeposits)
      .set(update)
      .where(and(eq(fixedDeposits.id, numericId), eq(fixedDeposits.userId, session.user.id)))
      .returning();
    return NextResponse.json({ fixedDeposit: updated });
  } catch (err) {
    console.error('PATCH fd:', err);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    await db.delete(fixedDeposits).where(and(eq(fixedDeposits.id, numericId), eq(fixedDeposits.userId, session.user.id)));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('DELETE fd:', err);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
