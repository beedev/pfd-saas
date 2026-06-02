/**
 * Small Savings — account detail + partial update + delete.
 *
 * GET returns the account plus its transaction ledger ordered most-recent
 * first. PATCH is field-diff — callers can ship a single key and we'll
 * leave the rest alone. DELETE relies on FK ON DELETE CASCADE to remove
 * transactions in a single statement.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import {
  db,
  smallSavingsAccounts,
  smallSavingsTransactions,
  type SmallSavingsStatus,
  type InterestCompounding,
} from '@/db';
import { auth } from '@/auth';

const VALID_STATUSES: SmallSavingsStatus[] = ['ACTIVE', 'MATURED', 'CLOSED', 'EXTENDED'];
const VALID_COMPOUNDING: InterestCompounding[] = ['YEARLY', 'HALF_YEARLY', 'QUARTERLY'];

interface Params {
  params: Promise<{ id: string }>;
}

function rupeesToPaisa(n: unknown): number | undefined {
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
  return Math.round(n * 100);
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

    const accountRows = await db
      .select()
      .from(smallSavingsAccounts)
      .where(
        and(
          eq(smallSavingsAccounts.id, numericId),
          eq(smallSavingsAccounts.userId, session.user.id),
        ),
      )
      .limit(1);
    if (!accountRows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Transactions also scoped by userId — defence in depth in case a
    // stale FK ever survives a delete race.
    const transactions = await db
      .select()
      .from(smallSavingsTransactions)
      .where(
        and(
          eq(smallSavingsTransactions.accountId, numericId),
          eq(smallSavingsTransactions.userId, session.user.id),
        ),
      )
      .orderBy(desc(smallSavingsTransactions.txnDate));

    return NextResponse.json({ account: accountRows[0], transactions });
  } catch (err) {
    console.error('[small-savings/:id GET]', err);
    return NextResponse.json({ error: 'Failed to fetch account' }, { status: 500 });
  }
}

interface PatchBody {
  accountNumber?: string;
  holderName?: string;
  holderDob?: string | null;
  pan?: string | null;
  institution?: string | null;
  openingDate?: string;
  maturityDate?: string;
  extensionBlocksUsed?: number;
  depositAmountRupees?: number;
  currentBalanceRupees?: number;
  interestRatePercent?: number;
  interestCompounding?: InterestCompounding;
  lockInEndDate?: string | null;
  totalDepositedRupees?: number;
  totalInterestRupees?: number;
  status?: SmallSavingsStatus;
  notes?: string | null;
  /** Sprint 5.5e — recurring contribution (paisa per period) used by
   *  the contribution-aware projection on the cashflow timeline. */
  periodicContributionRupees?: number;
  /** MONTHLY or YEARLY. PPF / SSY typically monthly; some users do one
   *  annual PPF deposit (April 1st) — use YEARLY for those. */
  contributionFrequency?: 'MONTHLY' | 'YEARLY';
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
      .from(smallSavingsAccounts)
      .where(
        and(
          eq(smallSavingsAccounts.id, numericId),
          eq(smallSavingsAccounts.userId, session.user.id),
        ),
      )
      .limit(1);
    if (!existing.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body = (await request.json()) as PatchBody;

    if (body.status !== undefined && !VALID_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }
    if (
      body.interestCompounding !== undefined &&
      !VALID_COMPOUNDING.includes(body.interestCompounding)
    ) {
      return NextResponse.json({ error: 'Invalid interestCompounding' }, { status: 400 });
    }

    const update: Partial<typeof smallSavingsAccounts.$inferInsert> = { updatedAt: new Date() };
    if (typeof body.accountNumber === 'string' && body.accountNumber.trim()) {
      update.accountNumber = body.accountNumber.trim();
    }
    if (typeof body.holderName === 'string' && body.holderName.trim()) {
      update.holderName = body.holderName.trim();
    }
    if (body.holderDob !== undefined) update.holderDob = body.holderDob;
    if (body.pan !== undefined) update.pan = body.pan;
    if (body.institution !== undefined) update.institution = body.institution;
    if (typeof body.openingDate === 'string' && body.openingDate) {
      update.openingDate = body.openingDate;
    }
    if (typeof body.maturityDate === 'string' && body.maturityDate) {
      update.maturityDate = body.maturityDate;
    }
    if (typeof body.extensionBlocksUsed === 'number') {
      update.extensionBlocksUsed = body.extensionBlocksUsed;
    }
    const deposit = rupeesToPaisa(body.depositAmountRupees);
    if (deposit !== undefined) update.depositAmountPaisa = deposit;
    const currentBalance = rupeesToPaisa(body.currentBalanceRupees);
    if (currentBalance !== undefined) update.currentBalancePaisa = currentBalance;
    if (typeof body.interestRatePercent === 'number') {
      update.interestRatePercent = body.interestRatePercent;
    }
    if (body.interestCompounding !== undefined) update.interestCompounding = body.interestCompounding;
    if (body.lockInEndDate !== undefined) update.lockInEndDate = body.lockInEndDate;
    const totalDeposited = rupeesToPaisa(body.totalDepositedRupees);
    if (totalDeposited !== undefined) update.totalDepositedPaisa = totalDeposited;
    const totalInterest = rupeesToPaisa(body.totalInterestRupees);
    if (totalInterest !== undefined) update.totalInterestPaisa = totalInterest;
    if (body.status !== undefined) update.status = body.status;
    if (body.notes !== undefined) update.notes = body.notes;
    const periodic = rupeesToPaisa(body.periodicContributionRupees);
    if (periodic !== undefined) update.periodicContributionPaisa = periodic;
    if (body.contributionFrequency === 'MONTHLY' || body.contributionFrequency === 'YEARLY') {
      update.contributionFrequency = body.contributionFrequency;
    }

    const result = await db
      .update(smallSavingsAccounts)
      .set(update)
      .where(
        and(
          eq(smallSavingsAccounts.id, numericId),
          eq(smallSavingsAccounts.userId, session.user.id),
        ),
      )
      .returning();
    return NextResponse.json({ account: result[0] });
  } catch (err) {
    console.error('[small-savings/:id PATCH]', err);
    return NextResponse.json({ error: 'Failed to update account' }, { status: 500 });
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
    // FK ON DELETE CASCADE handles transactions automatically.
    await db
      .delete(smallSavingsAccounts)
      .where(
        and(
          eq(smallSavingsAccounts.id, numericId),
          eq(smallSavingsAccounts.userId, session.user.id),
        ),
      );
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[small-savings/:id DELETE]', err);
    return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 });
  }
}
