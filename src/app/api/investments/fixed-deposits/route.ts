/**
 * GET   /api/investments/fixed-deposits         — list all FDs
 * POST  /api/investments/fixed-deposits         — register a new FD
 *
 * Body (POST, rupees for money fields):
 *   bankName, accountNumber?, principal, interestRate,
 *   compoundingFreq?, interestType?,
 *   startDate, maturityDate,
 *   maturityAmount?,           // optional — auto-computed if omitted
 *   status?, isTaxSaver?, autoRenew?,
 *   prematureWithdrawalPenaltyPct?, jointHolderName?, notes?
 */

import { NextRequest, NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import {
  db,
  fixedDeposits,
  type FDCompoundingFreq,
  type FDInterestType,
  type FDStatus,
} from '@/db';
import { auth } from '@/auth';
import { calculateFdMaturityPaisa, monthsBetween } from '@/lib/finance/fd';

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const rows = await db
      .select()
      .from(fixedDeposits)
      .where(eq(fixedDeposits.userId, session.user.id))
      .orderBy(desc(fixedDeposits.maturityDate));
    return NextResponse.json({ fixedDeposits: rows });
  } catch (err) {
    console.error('GET fixed-deposits:', err);
    return NextResponse.json(
      { error: 'Failed to fetch fixed deposits' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const body = await request.json();
    const {
      bankName,
      accountNumber,
      principal,
      interestRate,
      compoundingFreq = 'QUARTERLY' as FDCompoundingFreq,
      interestType = 'CUMULATIVE' as FDInterestType,
      startDate,
      maturityDate,
      maturityAmount,
      status = 'ACTIVE' as FDStatus,
      isTaxSaver = false,
      autoRenew = false,
      prematureWithdrawalPenaltyPct = 1.0,
      jointHolderName,
      notes,
    } = body;

    if (!bankName || typeof bankName !== 'string') {
      return NextResponse.json({ error: 'bankName required' }, { status: 400 });
    }
    if (typeof principal !== 'number' || principal <= 0) {
      return NextResponse.json({ error: 'principal must be > 0' }, { status: 400 });
    }
    if (typeof interestRate !== 'number' || interestRate <= 0) {
      return NextResponse.json({ error: 'interestRate must be > 0' }, { status: 400 });
    }
    if (!startDate || !maturityDate) {
      return NextResponse.json(
        { error: 'startDate and maturityDate required' },
        { status: 400 },
      );
    }
    if (new Date(maturityDate) <= new Date(startDate)) {
      return NextResponse.json(
        { error: 'maturityDate must be after startDate' },
        { status: 400 },
      );
    }

    const principalPaisa = Math.round(principal * 100);
    const tenureMonths = monthsBetween(startDate, maturityDate);
    const maturityPaisa =
      typeof maturityAmount === 'number' && maturityAmount > 0
        ? Math.round(maturityAmount * 100)
        : calculateFdMaturityPaisa(
            principalPaisa,
            interestRate,
            tenureMonths,
            compoundingFreq,
            interestType,
          );

    const [created] = await db
      .insert(fixedDeposits)
      .values({
        userId: session.user.id,
        bankName: bankName.trim(),
        accountNumber: accountNumber?.trim() || null,
        principalPaisa,
        interestRate,
        compoundingFreq,
        interestType,
        startDate,
        maturityDate,
        tenureMonths,
        maturityAmountPaisa: maturityPaisa,
        status,
        isTaxSaver: !!isTaxSaver,
        autoRenew: !!autoRenew,
        prematureWithdrawalPenaltyPct,
        jointHolderName: jointHolderName?.trim() || null,
        notes: notes?.trim() || null,
      })
      .returning();

    return NextResponse.json({ fixedDeposit: created }, { status: 201 });
  } catch (err) {
    console.error('POST fixed-deposits:', err);
    return NextResponse.json(
      { error: 'Failed to create fixed deposit' },
      { status: 500 },
    );
  }
}
