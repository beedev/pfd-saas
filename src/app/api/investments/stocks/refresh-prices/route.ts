import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, holdings } from '@/db';
import { getQuote } from '@/lib/services/yahoo-finance';

// POST /api/investments/stocks/refresh-prices — refresh live price for every
// holding via Yahoo v8 chart endpoint. Idempotent.
export async function POST() {
  try {
    const rows = await db.select().from(holdings);
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
          .where(eq(holdings.id, h.id));
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
