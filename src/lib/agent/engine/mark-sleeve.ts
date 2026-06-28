/**
 * Mark a sleeve's open positions to market and return its equity
 * (cash + Σ market value). Reuses the live quote feed (cached). Money in paisa.
 */

import { and, eq } from 'drizzle-orm';
import { db, agentPositions } from '@/db';
import { getInstrumentQuote, type InstrumentRef } from '../market-data';

export async function markSleeveToMarket(
  userId: string,
  sleeveId: number,
  cashPaisa: number,
): Promise<number> {
  const positions = await db
    .select()
    .from(agentPositions)
    .where(and(eq(agentPositions.userId, userId), eq(agentPositions.sleeveId, sleeveId)));

  let positionsValue = 0;
  for (const pos of positions) {
    const ref: InstrumentRef = { assetClass: pos.assetClass, symbol: pos.symbol || undefined, schemeCode: pos.schemeCode || undefined };
    const quote = await getInstrumentQuote(ref);
    const last = quote?.lastPricePaisa ?? pos.lastPricePaisa ?? pos.avgPricePaisa;
    const directional = pos.side === 'SHORT' ? -1 : 1;
    const marketValue = Math.round(last * pos.quantity * pos.contractMultiplier);
    const unrealized = Math.round((last - pos.avgPricePaisa) * pos.quantity * pos.contractMultiplier) * directional;
    positionsValue += pos.side === 'SHORT' ? unrealized : marketValue;
    if (quote) {
      await db.update(agentPositions).set({ lastPricePaisa: last, marketValuePaisa: marketValue, unrealizedPnlPaisa: unrealized, updatedAt: new Date() }).where(eq(agentPositions.id, pos.id));
    }
  }
  return cashPaisa + positionsValue;
}
