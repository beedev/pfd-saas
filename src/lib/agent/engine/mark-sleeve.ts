/**
 * Mark a sleeve's open positions to market and return its equity
 * (cash + Σ market value). Reuses the live quote feed (cached). Money in paisa.
 */

import { and, eq } from 'drizzle-orm';
import { db, agentPositions, type AgentPosition } from '@/db';
import { getInstrumentQuote, getInstrumentQuotes, refKey, type InstrumentRef } from '../market-data';

/**
 * Mark ALL of a user's open positions to live prices and return them with fresh
 * marketValue / unrealized P&L (and persist the update). Called on dashboard
 * reads so tiles + holdings show CURRENT worth between agent runs, not the price
 * frozen at the last run. MF marks use the latest (EOD) NAV. Best-effort: a
 * position whose quote can't be fetched keeps its last mark.
 */
export async function markUserPositions(userId: string): Promise<AgentPosition[]> {
  const positions = await db.select().from(agentPositions).where(eq(agentPositions.userId, userId));
  if (!positions.length) return positions;
  // Batch ALL quotes in one shot — getInstrumentQuotes pulls every stock through a
  // single Yahoo getQuotes() call (no per-symbol NSE-first hop, which hangs from
  // the container). Replaces the old N-sequential loop that made the page crawl.
  const refOf = (pos: AgentPosition): InstrumentRef => ({ assetClass: pos.assetClass, symbol: pos.symbol || undefined, schemeCode: pos.schemeCode || undefined });
  const quotes = await getInstrumentQuotes(positions.map(refOf));
  for (const pos of positions) {
    const quote = quotes.get(refKey(refOf(pos)));
    if (!quote) continue; // best-effort: a position whose quote is missing keeps its last mark
    const last = quote.lastPricePaisa;
    const directional = pos.side === 'SHORT' ? -1 : 1;
    pos.marketValuePaisa = Math.round(last * pos.quantity * pos.contractMultiplier);
    pos.lastPricePaisa = last;
    pos.unrealizedPnlPaisa = Math.round((last - pos.avgPricePaisa) * pos.quantity * pos.contractMultiplier) * directional;
    await db.update(agentPositions).set({ lastPricePaisa: last, marketValuePaisa: pos.marketValuePaisa, unrealizedPnlPaisa: pos.unrealizedPnlPaisa, updatedAt: new Date() }).where(eq(agentPositions.id, pos.id));
  }
  return positions;
}

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
