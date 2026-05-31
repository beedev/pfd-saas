import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, mutualFunds } from '@/db';
import { auth } from '@/auth';
import { getByIsin } from '@/lib/services/amfi';

// POST /api/investments/mutual-funds/refresh-navs — refresh NAV for every MF
export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const all = await db.select().from(mutualFunds).where(eq(mutualFunds.userId, session.user.id));
    let updated = 0;
    let failed = 0;

    for (const mf of all) {
      try {
        const fund = await getByIsin(mf.isin);
        if (!fund || !fund.nav) {
          failed += 1;
          continue;
        }
        const navPaisa = Math.round(fund.nav * 100);
        const currentValuePaisa = Math.round(mf.units * navPaisa);
        const gainLossPaisa = currentValuePaisa - mf.totalInvestment;
        const gainLossPercent =
          mf.totalInvestment > 0 ? (gainLossPaisa / mf.totalInvestment) * 100 : 0;

        await db
          .update(mutualFunds)
          .set({
            nav: navPaisa,
            currentValue: currentValuePaisa,
            gainLoss: gainLossPaisa,
            gainLossPercent,
            lastNavDate: fund.navDate || null,
            updatedAt: new Date(),
          })
          .where(and(eq(mutualFunds.id, mf.id), eq(mutualFunds.userId, session.user.id)));
        updated += 1;
      } catch (e) {
        console.error(`refresh failed for MF ${mf.id}:`, e);
        failed += 1;
      }
    }

    return NextResponse.json({ updated, failed, total: all.length });
  } catch (error) {
    console.error('Error refreshing NAVs:', error);
    return NextResponse.json({ error: 'Failed to refresh NAVs' }, { status: 500 });
  }
}
