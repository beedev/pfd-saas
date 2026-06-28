/**
 * Mark the paper portfolio to market: refresh each open position's last price,
 * market value and unrealized P&L, and return total equity = cash + Σ MV.
 *
 * Futures P&L is directional: (last − avg) × qty × multiplier, signed by side
 * (LONG positive when price rises, SHORT positive when price falls). Stocks/MF
 * are LONG-only in v1. Money in paisa.
 */

import { eq } from 'drizzle-orm';
import { db, agentPositions, type AgentPortfolio } from '@/db';
import { getInstrumentQuote, type InstrumentRef } from '../market-data';

export interface MtmResult {
  equityValuePaisa: number;
  positionsMarked: number;
}

export async function markToMarket(
  userId: string,
  portfolio: AgentPortfolio,
): Promise<MtmResult> {
  const positions = await db.select().from(agentPositions).where(eq(agentPositions.portfolioId, portfolio.id));

  let positionsValue = 0;
  let marked = 0;

  for (const pos of positions) {
    const ref: InstrumentRef = {
      assetClass: pos.assetClass,
      symbol: pos.symbol || undefined,
      schemeCode: pos.schemeCode || undefined,
    };
    const quote = await getInstrumentQuote(ref);
    const last = quote?.lastPricePaisa ?? pos.lastPricePaisa ?? pos.avgPricePaisa;

    const directional = pos.side === 'SHORT' ? -1 : 1;
    const marketValue = Math.round(last * pos.quantity * pos.contractMultiplier);
    const unrealized = Math.round((last - pos.avgPricePaisa) * pos.quantity * pos.contractMultiplier) * directional;

    // For LONG equity/MF the position's market value adds to equity directly.
    // For SHORT futures we hold no asset; contribute only the P&L (notional MTM)
    // since v1 has no margin model (cash already reflects the trade legs).
    if (pos.side === 'SHORT') {
      positionsValue += unrealized;
    } else {
      positionsValue += marketValue;
    }

    if (quote) {
      await db
        .update(agentPositions)
        .set({
          lastPricePaisa: last,
          marketValuePaisa: marketValue,
          unrealizedPnlPaisa: unrealized,
          updatedAt: new Date(),
        })
        .where(eq(agentPositions.id, pos.id));
      marked += 1;
    }
  }

  // Cash already reflects buys/sells; for LONG positions equity = cash + MV.
  // (SHORT contributes P&L only, added above.)
  return { equityValuePaisa: portfolio.cashBalancePaisa + positionsValue, positionsMarked: marked };
}
