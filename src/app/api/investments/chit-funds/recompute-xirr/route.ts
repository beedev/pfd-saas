/**
 * POST /api/investments/chit-funds/recompute-xirr
 *
 * Recomputes the stored XIRR for every chit fund using its current summary
 * state (start/end dates, installments paid, total paid, monthly installment,
 * chit value, status). Uses the worst-case-win projection from
 * `calculateChitXirrFromSummary`.
 *
 * Idempotent — safe to call any time. Used to backfill chits that were
 * imported before the import commit endpoint started computing XIRR, and
 * to refresh after manual edits to the underlying summary fields.
 */

import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, chitFunds } from '@/db';
import { auth } from '@/auth';
import { calculateChitXirrFromSummary } from '@/lib/finance/chit-xirr';

export const runtime = 'nodejs';

export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const rows = await db.select().from(chitFunds).where(eq(chitFunds.userId, session.user.id));
    let updated = 0;
    let skipped = 0;

    for (const c of rows) {
      // Lifetime average dividend as a percentage of monthly installment.
      // Used to project realistic future net outgo (esp. for WON chits where
      // the subscriber keeps receiving dividend share post-win).
      const paidCount = c.installmentsPaid ?? 0;
      const lifetimeDivPct =
        paidCount > 0 && c.monthlyInstallment > 0
          ? ((c.totalDividends ?? 0) / (c.monthlyInstallment * paidCount)) * 100
          : 0;

      const xirr = calculateChitXirrFromSummary({
        startDate: c.startDate,
        expectedEndDate: c.expectedEndDate,
        durationMonths: c.durationMonths,
        installmentsPaid: paidCount,
        monthlyInstallmentPaisa: c.monthlyInstallment,
        totalPaidPaisa: c.totalPaid ?? 0,
        chitValuePaisa: c.chitValue,
        status: c.status ?? 'ACTIVE',
        winDate: c.winDate,
        winAmountReceivedPaisa: c.winAmountReceived,
        futureDividendStartPct: lifetimeDivPct,
      });

      if (xirr === null) {
        skipped++;
        continue;
      }

      await db
        .update(chitFunds)
        .set({ xirr, updatedAt: new Date() })
        .where(and(eq(chitFunds.id, c.id), eq(chitFunds.userId, session.user.id)));
      updated++;
    }

    return NextResponse.json({ updated, skipped, total: rows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Recompute failed';
    console.error('Chit XIRR recompute failed:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
