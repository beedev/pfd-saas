/**
 * Small Savings — update or delete a single transaction.
 *
 * DELETE rolls back the txn's effect on the parent account. We rebuild
 * the parent's totals/balance from the original txn type rather than
 * recomputing the entire ledger so the cost stays O(1).
 *
 * PATCH only touches fields that don't change the txn's financial
 * effect (date, reference, notes). Mutating amount/type would require
 * a full ledger replay; callers should delete + recreate instead.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import {
  db,
  smallSavingsAccounts,
  smallSavingsTransactions,
} from '@/db';
import { auth } from '@/auth';

interface Params {
  params: Promise<{ id: string }>;
}

interface PatchBody {
  txnDate?: string;
  referenceNumber?: string | null;
  notes?: string | null;
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
      .from(smallSavingsTransactions)
      .where(
        and(
          eq(smallSavingsTransactions.id, numericId),
          eq(smallSavingsTransactions.userId, session.user.id),
        ),
      )
      .limit(1);
    if (!existing.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body = (await request.json()) as PatchBody;

    const update: Partial<typeof smallSavingsTransactions.$inferInsert> = {};
    if (typeof body.txnDate === 'string' && body.txnDate) update.txnDate = body.txnDate;
    if (body.referenceNumber !== undefined) update.referenceNumber = body.referenceNumber;
    if (body.notes !== undefined) update.notes = body.notes;

    const result = await db
      .update(smallSavingsTransactions)
      .set(update)
      .where(
        and(
          eq(smallSavingsTransactions.id, numericId),
          eq(smallSavingsTransactions.userId, session.user.id),
        ),
      )
      .returning();
    return NextResponse.json({ transaction: result[0] });
  } catch (err) {
    console.error('[small-savings/transactions/:id PATCH]', err);
    return NextResponse.json({ error: 'Failed to update transaction' }, { status: 500 });
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
    // Fetch the txn before deletion so we know how to reverse its effect.
    const existing = await db
      .select()
      .from(smallSavingsTransactions)
      .where(
        and(
          eq(smallSavingsTransactions.id, numericId),
          eq(smallSavingsTransactions.userId, session.user.id),
        ),
      )
      .limit(1);
    if (!existing.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const txn = existing[0];

    // Load parent account to rebalance.
    const acctRows = await db
      .select()
      .from(smallSavingsAccounts)
      .where(
        and(
          eq(smallSavingsAccounts.id, txn.accountId),
          eq(smallSavingsAccounts.userId, session.user.id),
        ),
      )
      .limit(1);

    // Delete the txn row first — if the rebalance UPDATE fails we'd
    // rather end up with a consistent (just-stale) totals row than a
    // ghost txn.
    await db
      .delete(smallSavingsTransactions)
      .where(
        and(
          eq(smallSavingsTransactions.id, numericId),
          eq(smallSavingsTransactions.userId, session.user.id),
        ),
      );

    // Reverse the txn's effect on the parent account.
    if (acctRows.length) {
      const acct = acctRows[0];
      let balance = acct.currentBalancePaisa;
      let totalDeposited = acct.totalDepositedPaisa;
      let totalInterest = acct.totalInterestPaisa;

      switch (txn.txnType) {
        case 'DEPOSIT':
          balance -= txn.amountPaisa;
          totalDeposited -= txn.amountPaisa;
          break;
        case 'INTEREST_CREDIT':
          balance -= txn.amountPaisa;
          totalInterest -= txn.amountPaisa;
          break;
        case 'WITHDRAWAL':
        case 'PARTIAL_WITHDRAWAL':
          balance += txn.amountPaisa;
          break;
        case 'MATURITY':
          // Note: we don't auto-unMATURE the account on maturity-txn
          // delete. If a user deleted the maturity row in error they
          // can flip the status back via the account PATCH endpoint.
          break;
      }

      await db
        .update(smallSavingsAccounts)
        .set({
          currentBalancePaisa: balance,
          totalDepositedPaisa: totalDeposited,
          totalInterestPaisa: totalInterest,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(smallSavingsAccounts.id, txn.accountId),
            eq(smallSavingsAccounts.userId, session.user.id),
          ),
        );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[small-savings/transactions/:id DELETE]', err);
    return NextResponse.json({ error: 'Failed to delete transaction' }, { status: 500 });
  }
}
