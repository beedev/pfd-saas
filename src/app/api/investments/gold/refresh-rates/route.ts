import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, goldHoldings, type GoldPurity } from '@/db';
import { getCurrentGoldRate, calculateValue } from '@/lib/services/ibja';
import { getQuote } from '@/lib/services/yahoo-finance';

// POST /api/investments/gold/refresh-rates — refresh current rate for every holding
export async function POST() {
  try {
    const all = await db.select().from(goldHoldings);
    let updated = 0;
    let failed = 0;

    // Fetch IBJA rate once, reuse for every non-ETF row.
    const ibjaRate = await getCurrentGoldRate();

    for (const row of all) {
      try {
        let currentRatePerGramPaisa = row.currentRatePerGram ?? 0;
        let currentValuePaisa = row.currentValue ?? 0;
        let lastRateUpdate = row.lastRateUpdate;

        if (row.type === 'ETF' && row.etfSymbol && row.etfUnits) {
          const quote = await getQuote(row.etfSymbol);
          if (!quote?.regularMarketPrice) {
            failed += 1;
            continue;
          }
          currentRatePerGramPaisa = Math.round(quote.regularMarketPrice * 100);
          currentValuePaisa = Math.round(row.etfUnits * quote.regularMarketPrice * 100);
          lastRateUpdate = new Date(
            (quote.regularMarketTime || Math.floor(Date.now() / 1000)) * 1000
          )
            .toISOString()
            .slice(0, 10);
        } else {
          const grams = row.grams ?? row.quantity;
          const purity = (row.purity ?? '999') as GoldPurity;
          if (!grams) {
            failed += 1;
            continue;
          }
          currentRatePerGramPaisa = Math.round(ibjaRate.ratePerGram24K * 100);
          const valueRupees = calculateValue(grams, purity, ibjaRate.ratePerGram24K);
          currentValuePaisa = Math.round(valueRupees * 100);
          lastRateUpdate = ibjaRate.asOfDate;
        }

        const totalInvestmentPaisa = row.totalInvestment ?? 0;
        const gainLossPaisa = currentValuePaisa - totalInvestmentPaisa;
        const gainLossPercent =
          totalInvestmentPaisa > 0 ? (gainLossPaisa / totalInvestmentPaisa) * 100 : 0;

        await db
          .update(goldHoldings)
          .set({
            currentRatePerGram: currentRatePerGramPaisa,
            currentPrice: currentRatePerGramPaisa,
            currentValue: currentValuePaisa,
            totalValue: currentValuePaisa,
            gainLoss: gainLossPaisa,
            gainLossPercent,
            lastRateUpdate,
            lastPriceUpdate: lastRateUpdate,
            updatedAt: new Date(),
          })
          .where(eq(goldHoldings.id, row.id));
        updated += 1;
      } catch (err) {
        console.error(`refresh failed for gold ${row.id}:`, err);
        failed += 1;
      }
    }

    return NextResponse.json({
      updated,
      failed,
      total: all.length,
      rate: ibjaRate,
    });
  } catch (err) {
    console.error('Failed to refresh gold rates:', err);
    return NextResponse.json({ error: 'Failed to refresh gold rates' }, { status: 500 });
  }
}
