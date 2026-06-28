/**
 * GET   /api/investments/recurring-deposits      — list all RDs
 * POST  /api/investments/recurring-deposits      — register a new RD
 *
 * Body (POST, rupees for money fields):
 *   bankName, accountNumber?, monthlyInstallment, interestRate,
 *   tenureMonths, startDate,
 *   compoundingFreq?,
 *   maturityAmount?,           // optional — auto-computed if omitted
 *   status?, autoRenew?,
 *   prematureWithdrawalPenaltyPct?, jointHolderName?, notes?
 *
 * maturityDate is derived from startDate + tenureMonths.
 */

import { NextRequest, NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db, recurringDeposits, type RDCompoundingFreq, type RDStatus } from '@/db';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';
import { calculateRdMaturityPaisa, rdTotalDepositPaisa, addMonthsIso } from '@/lib/finance/rd';
import { syncRdInterest } from '@/lib/finance/rd-interest';

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const rows = await db
      .select()
      .from(recurringDeposits)
      .where(eq(recurringDeposits.userId, userId))
      .orderBy(desc(recurringDeposits.maturityDate));
    return NextResponse.json({ recurringDeposits: rows });
  } catch (err) {
    console.error('GET recurring-deposits:', err);
    return NextResponse.json(
      { error: 'Failed to fetch recurring deposits' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const body = await request.json();
    const {
      bankName,
      accountNumber,
      monthlyInstallment,
      interestRate,
      tenureMonths,
      startDate,
      compoundingFreq = 'QUARTERLY' as RDCompoundingFreq,
      maturityAmount,
      status = 'ACTIVE' as RDStatus,
      autoRenew = false,
      prematureWithdrawalPenaltyPct = 1.0,
      jointHolderName,
      notes,
    } = body;

    if (!bankName || typeof bankName !== 'string') {
      return NextResponse.json({ error: 'bankName required' }, { status: 400 });
    }
    if (typeof monthlyInstallment !== 'number' || monthlyInstallment <= 0) {
      return NextResponse.json({ error: 'monthlyInstallment must be > 0' }, { status: 400 });
    }
    if (typeof interestRate !== 'number' || interestRate <= 0) {
      return NextResponse.json({ error: 'interestRate must be > 0' }, { status: 400 });
    }
    if (!Number.isInteger(tenureMonths) || tenureMonths <= 0) {
      return NextResponse.json(
        { error: 'tenureMonths must be a positive whole number' },
        { status: 400 },
      );
    }
    if (!startDate || typeof startDate !== 'string') {
      return NextResponse.json({ error: 'startDate required' }, { status: 400 });
    }

    const installmentPaisa = Math.round(monthlyInstallment * 100);
    const maturityDate = addMonthsIso(startDate, tenureMonths);
    const totalDepositPaisa = rdTotalDepositPaisa(installmentPaisa, tenureMonths);
    const maturityPaisa =
      typeof maturityAmount === 'number' && maturityAmount > 0
        ? Math.round(maturityAmount * 100)
        : calculateRdMaturityPaisa(installmentPaisa, interestRate, tenureMonths, compoundingFreq);

    const [created] = await db
      .insert(recurringDeposits)
      .values({
        userId: userId,
        bankName: bankName.trim(),
        accountNumber: accountNumber?.trim() || null,
        monthlyInstallmentPaisa: installmentPaisa,
        interestRate,
        compoundingFreq,
        tenureMonths,
        startDate,
        maturityDate,
        totalDepositPaisa,
        maturityAmountPaisa: maturityPaisa,
        status,
        autoRenew: !!autoRenew,
        prematureWithdrawalPenaltyPct,
        jointHolderName: jointHolderName?.trim() || null,
        notes: notes?.trim() || null,
      })
      .returning();

    await syncRdInterest(userId); // refresh RD maturity interest in other income
    return NextResponse.json({ recurringDeposit: created }, { status: 201 });
  } catch (err) {
    console.error('POST recurring-deposits:', err);
    return NextResponse.json(
      { error: 'Failed to create recurring deposit' },
      { status: 500 },
    );
  }
}
