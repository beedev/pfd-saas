/**
 * Paper-trade execution. Turns DecisionIntents into agent_trades + agent_positions
 * + agent_decisions rows and adjusts the portfolio cash balance.
 *
 * SAFETY INVARIANT: imports ONLY agent* tables — never real holdings /
 * mutualFunds / investmentTransactions. Paper trading with virtual money only.
 *
 * Phase A fills every asset class immediately at the latest price/NAV. (Phase B
 * switches MF to deferred next-NAV fills via settle-worker.ts.) Money in paisa.
 */

import { and, eq } from 'drizzle-orm';
import {
  db,
  agentTrades,
  agentPositions,
  agentDecisions,
  agentPortfolios,
  type AgentPortfolio,
} from '@/db';
import type { DecisionIntent } from './decide';

export interface ExecuteResult {
  tradesExecuted: number;
  cashBalancePaisa: number;
}

const posWhere = (portfolioId: number, assetClass: string, symbol: string, schemeCode: string) =>
  assetClass === 'MF'
    ? and(eq(agentPositions.portfolioId, portfolioId), eq(agentPositions.assetClass, 'MF'), eq(agentPositions.schemeCode, schemeCode))
    : and(eq(agentPositions.portfolioId, portfolioId), eq(agentPositions.assetClass, assetClass as 'STOCK' | 'FUTURE'), eq(agentPositions.symbol, symbol));

export async function executeDecisions(
  userId: string,
  portfolio: AgentPortfolio,
  intents: DecisionIntent[],
  runId: number,
  runDate: string,
): Promise<ExecuteResult> {
  let cash = portfolio.cashBalancePaisa;
  let tradesExecuted = 0;

  for (const intent of intents) {
    // Always log the decision; only BUY/SELL produce a trade.
    const [decision] = await db
      .insert(agentDecisions)
      .values({
        userId,
        portfolioId: portfolio.id,
        runId,
        signalId: intent.signalId ?? undefined,
        action: intent.action,
        assetClass: intent.assetClass,
        symbol: intent.symbol,
        name: intent.name,
        quantity: intent.quantity || undefined,
        pricePaisa: intent.pricePaisa,
        amountPaisa: intent.amountPaisa || undefined,
        confidence: intent.confidence,
        executed: intent.action === 'BUY' || intent.action === 'SELL',
      })
      .returning();

    if (intent.action !== 'BUY' && intent.action !== 'SELL') continue;

    const gross = intent.amountPaisa;
    const net = gross; // no brokerage modelled in paper trading
    let realizedPnl: number | null = null;

    if (intent.action === 'BUY') {
      const [trade] = await db
        .insert(agentTrades)
        .values({
          userId,
          portfolioId: portfolio.id,
          decisionId: decision.id,
          runId,
          type: 'BUY',
          assetClass: intent.assetClass,
          symbol: intent.symbol,
          schemeCode: intent.schemeCode,
          name: intent.name,
          side: intent.side,
          quantity: intent.quantity,
          contractMultiplier: intent.contractMultiplier,
          pricePerUnitPaisa: intent.pricePaisa,
          grossAmountPaisa: gross,
          netAmountPaisa: net,
          status: 'FILLED',
          tradeDate: runDate,
          fillDate: runDate,
        })
        .returning();

      // Upsert position (average cost if somehow already held).
      const existing = (await db.select().from(agentPositions).where(posWhere(portfolio.id, intent.assetClass, intent.symbol, intent.schemeCode)).limit(1))[0];
      if (existing) {
        const newQty = existing.quantity + intent.quantity;
        const newAvg = Math.round(
          (existing.avgPricePaisa * existing.quantity + intent.pricePaisa * intent.quantity) / newQty,
        );
        await db.update(agentPositions).set({ quantity: newQty, avgPricePaisa: newAvg, updatedAt: new Date() }).where(eq(agentPositions.id, existing.id));
      } else {
        await db.insert(agentPositions).values({
          userId,
          portfolioId: portfolio.id,
          assetClass: intent.assetClass,
          symbol: intent.symbol,
          schemeCode: intent.schemeCode,
          name: intent.name,
          side: intent.side,
          quantity: intent.quantity,
          contractMultiplier: intent.contractMultiplier,
          avgPricePaisa: intent.pricePaisa,
          lastPricePaisa: intent.pricePaisa,
          openedDate: runDate,
        });
      }
      cash -= net;
      tradesExecuted += 1;
      await db.update(agentDecisions).set({ tradeId: trade.id }).where(eq(agentDecisions.id, decision.id));
    } else {
      // SELL: close the position, book realized P&L.
      const existing = (await db.select().from(agentPositions).where(posWhere(portfolio.id, intent.assetClass, intent.symbol, intent.schemeCode)).limit(1))[0];
      if (!existing) continue; // nothing to sell
      const qty = Math.min(intent.quantity, existing.quantity);
      realizedPnl = Math.round((intent.pricePaisa - existing.avgPricePaisa) * qty * existing.contractMultiplier);
      const [trade] = await db
        .insert(agentTrades)
        .values({
          userId,
          portfolioId: portfolio.id,
          decisionId: decision.id,
          runId,
          type: 'SELL',
          assetClass: intent.assetClass,
          symbol: intent.symbol,
          schemeCode: intent.schemeCode,
          name: intent.name,
          side: existing.side,
          quantity: qty,
          contractMultiplier: existing.contractMultiplier,
          pricePerUnitPaisa: intent.pricePaisa,
          grossAmountPaisa: gross,
          netAmountPaisa: net,
          status: 'FILLED',
          tradeDate: runDate,
          fillDate: runDate,
          realizedPnlPaisa: realizedPnl,
        })
        .returning();

      const remaining = existing.quantity - qty;
      if (remaining <= 0.0000001) {
        await db.delete(agentPositions).where(eq(agentPositions.id, existing.id));
      } else {
        await db.update(agentPositions).set({ quantity: remaining, updatedAt: new Date() }).where(eq(agentPositions.id, existing.id));
      }
      cash += net;
      tradesExecuted += 1;
      await db.update(agentDecisions).set({ tradeId: trade.id }).where(eq(agentDecisions.id, decision.id));
    }
  }

  await db.update(agentPortfolios).set({ cashBalancePaisa: cash, updatedAt: new Date() }).where(eq(agentPortfolios.id, portfolio.id));
  return { tradesExecuted, cashBalancePaisa: cash };
}
