import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, holdings } from '@/db';
import { auth } from '@/auth';
import { getQuote } from '@/lib/services/yahoo-finance';

// POST /api/investments/stocks/refresh-prices — refresh live price for every
// holding via Yahoo v8 chart endpoint. Idempotent.
export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const rows = await db.select().from(holdings).where(eq(holdings.userId, session.user.id));
    let updated = 0;
    let failed = 0;

    for (const h of rows) {
      try {
        const quote = await getQuote(h.symbol);
        if (!quote?.regularMarketPrice) {
          failed += 1;
          continue;
        }
        const currentPricePaisa = Math.round(quote.regularMarketPrice * 100);
        const currentValuePaisa = Math.round(h.quantity * currentPricePaisa);
        const gainLossPaisa = currentValuePaisa - h.totalInvestment;
        const gainLossPercent =
          h.totalInvestment > 0 ? (gainLossPaisa / h.totalInvestment) * 100 : 0;

        await db
          .update(holdings)
          .set({
            currentPrice: currentPricePaisa,
            currentValue: currentValuePaisa,
            gainLoss: gainLossPaisa,
            gainLossPercent,
            updatedAt: new Date(),
          })
          .where(and(eq(holdings.id, h.id), eq(holdings.userId, session.user.id)));
        updated += 1;
      } catch (e) {
        console.error(`refresh failed for stock ${h.symbol}:`, e);
        failed += 1;
      }
    }

    return NextResponse.json({ updated, failed, total: rows.length });
  } catch (error) {
    console.error('Error refreshing stock prices:', error);
    return NextResponse.json({ error: 'Failed to refresh prices' }, { status: 500 });
  }
}
