/**
 * Equity-curve snapshots. Reuses price_snapshots (no new table) with agent-
 * specific sources, one row per portfolio per day (idempotent via the existing
 * unique index userId+assetSymbol+priceDate). The UI rebases both series to a
 * common base for comparison. Money in paisa.
 */

import { db, priceSnapshots, type AgentPortfolio } from '@/db';

export const AGENT_EQUITY_SOURCE = 'AGENT_EQUITY';
export const AGENT_BENCHMARK_SOURCE = 'AGENT_BENCHMARK';

export const agentEquitySymbol = (portfolioId: number) => `AGENT:${portfolioId}`;
export const agentBenchmarkSymbol = (portfolioId: number) => `AGENTBM:${portfolioId}`;

export async function snapshotEquity(
  userId: string,
  portfolio: AgentPortfolio,
  equityValuePaisa: number,
  benchmarkPricePaisa: number | null,
  runDate: string,
): Promise<void> {
  await db
    .insert(priceSnapshots)
    .values({
      userId,
      assetType: 'AGENT',
      assetSymbol: agentEquitySymbol(portfolio.id),
      assetName: portfolio.name,
      price: equityValuePaisa,
      priceDate: runDate,
      source: AGENT_EQUITY_SOURCE,
    })
    .onConflictDoUpdate({
      target: [priceSnapshots.userId, priceSnapshots.assetSymbol, priceSnapshots.priceDate],
      set: { price: equityValuePaisa },
    });

  if (benchmarkPricePaisa != null && benchmarkPricePaisa > 0) {
    await db
      .insert(priceSnapshots)
      .values({
        userId,
        assetType: 'AGENT',
        assetSymbol: agentBenchmarkSymbol(portfolio.id),
        assetName: portfolio.benchmarkSymbol,
        price: benchmarkPricePaisa,
        priceDate: runDate,
        source: AGENT_BENCHMARK_SOURCE,
      })
      .onConflictDoUpdate({
        target: [priceSnapshots.userId, priceSnapshots.assetSymbol, priceSnapshots.priceDate],
        set: { price: benchmarkPricePaisa },
      });
  }
}
