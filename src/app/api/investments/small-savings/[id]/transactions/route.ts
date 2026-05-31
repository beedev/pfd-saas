/**
 * Small Savings — transactions for a specific account.
 *
 *   GET   ledger sorted most-recent first
 *   POST  record a deposit / interest credit / withdrawal / maturity
 *
 * POST is the only place that mutates the parent account's running
 * balance + totals. Each txn type has a well-defined effect:
 *
 *   DEPOSIT             += amount  → balance, totalDeposited
 *   INTEREST_CREDIT     += amount  → balance, totalInterest
 *   WITHDRAWAL          -= amount  → balance
 *   PARTIAL_WITHDRAWAL  -= amount  → balance
 *   MATURITY            sets status='MATURED'; amount represents the
 *                       final maturity value but does NOT change balance
 *                       (caller has already drained via a WITHDRAWAL).
 *
 * `balance_after_paisa` is stamped on the inserted row so the ledger
 * can be reconstructed without re-running the math.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import {
  db,
  smallSavingsAccounts,
  smallSavingsTransactions,
  type SmallSavingsTxnType,
} from '@/db';
import { auth } from '@/auth';

const VALID_TXN_TYPES: SmallSavingsTxnType[] = [
  'DEPOSIT',
  'INTEREST_CREDIT',
  'WITHDRAWAL',
  'PARTIAL_WITHDRAWAL',
  'MATURITY',
];

interface Params {
  params: Promise<{ id: string }>;
}

async function ensureAccount(idRaw: string, userId: string) {
  const numericId = Number(idRaw);
  if (!Number.isFinite(numericId)) {
    return { error: NextResponse.json({ error: 'Invalid id' }, { status: 400 }) };
  }
  const rows = await db
    .select()
    .from(smallSavingsAccounts)
    .where(
      and(
        eq(smallSavingsAccounts.id, numericId),
        eq(smallSavingsAccounts.userId, userId),
      ),
    )
    .limit(1);
  if (!rows.length) {
    return { error: NextResponse.json({ error: 'Account not found' }, { status: 404 }) };
  }
  return { accountId: numericId, account: rows[0] };
}

export async function GET(_request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const { id } = await params;
    const guard = await ensureAccount(id, session.user.id);
    if ('error' in guard) return guard.error;

    const transactions = await db
      .select()
      .from(smallSavingsTransactions)
      .where(
        and(
          eq(smallSavingsTransactions.accountId, guard.accountId),
          eq(smallSavingsTransactions.userId, session.user.id),
        ),
      )
      .orderBy(desc(smallSavingsTransactions.txnDate));
    return NextResponse.json({ transactions });
  } catch (err) {
    console.error('[small-savings/:id/transactions GET]', err);
    return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 });
  }
}

interface CreateBody {
  txnDate?: string;
  txnType?: SmallSavingsTxnType;
  amountRupees?: number;
  referenceNumber?: string;
  notes?: string;
}

export async function POST(request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const { id } = await params;
    const guard = await ensureAccount(id, session.user.id);
    if ('error' in guard) return guard.error;

    const body = (await request.json()) as CreateBody;
    if (!body.txnDate) {
      return NextResponse.json({ error: 'txnDate is required' }, { status: 400 });
    }
    if (!body.txnType || !VALID_TXN_TYPES.includes(body.txnType)) {
      return NextResponse.json({ error: 'txnType is required' }, { status: 400 });
    }
    if (typeof body.amountRupees !== 'number' || !Number.isFinite(body.amountRupees)) {
      return NextResponse.json({ error: 'amountRupees is required' }, { status: 400 });
    }

    const amountPaisa = Math.round(body.amountRupees * 100);
    const account = guard.account;

    // Compute the post-transaction balance + total deltas based on
    // txnType. Each branch is intentionally explicit so the rules
    // stay grep-able.
    let newBalance = account.currentBalancePaisa;
    let newTotalDeposited = account.totalDepositedPaisa;
    let newTotalInterest = account.totalInterestPaisa;
    let newStatus = account.status;

    switch (body.txnType) {
      case 'DEPOSIT':
        newBalance += amountPaisa;
        newTotalDeposited += amountPaisa;
        break;
      case 'INTEREST_CREDIT':
        newBalance += amountPaisa;
        newTotalInterest += amountPaisa;
        break;
      case 'WITHDRAWAL':
      case 'PARTIAL_WITHDRAWAL':
        newBalance -= amountPaisa;
        break;
      case 'MATURITY':
        // Maturity itself does not move the balance — the funds are
        // typically credited via a WITHDRAWAL in the same batch. We
        // just flip the account's status so it stops appearing as
        // ACTIVE in tiles/projections.
        newStatus = 'MATURED';
        break;
    }

    // Insert the txn row with the post-balance stamped on it.
    const insertResult = await db
      .insert(smallSavingsTransactions)
      .values({
        userId: session.user.id,
        accountId: guard.accountId,
        txnDate: body.txnDate,
        txnType: body.txnType,
        amountPaisa,
        balanceAfterPaisa: newBalance,
        referenceNumber: body.referenceNumber || null,
        notes: body.notes || null,
        createdAt: new Date(),
      })
      .returning();

    // Then apply the deltas to the parent account in a separate UPDATE.
    // Two round-trips but keeps the txn row consistent with the post-
    // balance even if the UPDATE fails.
    await db
      .update(smallSavingsAccounts)
      .set({
        currentBalancePaisa: newBalance,
        totalDepositedPaisa: newTotalDeposited,
        totalInterestPaisa: newTotalInterest,
        status: newStatus,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(smallSavingsAccounts.id, guard.accountId),
          eq(smallSavingsAccounts.userId, session.user.id),
        ),
      );

    return NextResponse.json({ transaction: insertResult[0] }, { status: 201 });
  } catch (err) {
    console.error('[small-savings/:id/transactions POST]', err);
    return NextResponse.json({ error: 'Failed to record transaction' }, { status: 500 });
  }
}
