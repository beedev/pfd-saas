/**
 * GET /api/investments/chit-funds/recent-installments
 *
 * Returns chit fund installments from the past 30 days, enriched with
 * scheme name for the "Paid in past 30 days" panel.
 */

import { NextResponse } from 'next/server';
import { and, eq, gte, desc } from 'drizzle-orm';
import { db, chitFundInstallments, chitFunds } from '@/db';
import { auth } from '@/auth';

export const runtime = 'nodejs';

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    // Current month only: 1st of this month
    const now = new Date();
    const cutoffIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    const installments = await db
      .select()
      .from(chitFundInstallments)
      .where(and(eq(chitFundInstallments.userId, session.user.id), gte(chitFundInstallments.paidOn, cutoffIso)))
      .orderBy(desc(chitFundInstallments.paidOn));

    const chits = await db
      .select({ id: chitFunds.id, schemeName: chitFunds.schemeName })
      .from(chitFunds)
      .where(eq(chitFunds.userId, session.user.id));
    const chitMap = new Map(chits.map((c) => [c.id, c.schemeName]));

    const result = installments.map((i) => ({
      chitId: i.chitFundId,
      schemeName: chitMap.get(i.chitFundId) ?? 'Unknown',
      monthNumber: i.monthNumber,
      installmentPaid: i.installmentPaid,
      dividendReceived: i.dividendReceived ?? 0,
      netOutgo: i.netOutgo,
      paidOn: i.paidOn,
    }));

    return NextResponse.json({ installments: result });
  } catch (err) {
    console.error('Failed to fetch recent chit installments:', err);
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}
