/**
 * Daily analyst-agent run: refresh quotes → compute signals → decide + execute
 * paper trades → mark-to-market → snapshot equity vs benchmark → compose digest
 * → notify. Idempotent per (user, IST date) via the agent_runs unique index.
 *
 * SAFETY: paper trading only — touches agent* tables + price_snapshots(AGENT_*).
 */

import { and, asc, eq } from 'drizzle-orm';
import {
  db,
  agentPortfolios,
  agentWatchlist,
  agentRuns,
  agentSignals,
  agentPositions,
  priceSnapshots,
  type AgentPortfolio,
} from '@/db';
import { getQuote } from '@/lib/services/yahoo-finance';
import { getInstrumentQuote, getInstrumentHistory, type InstrumentRef } from '@/lib/agent/market-data';
import { computeEquitySignals } from '@/lib/agent/signals/equities';
import { computeMfSignals } from '@/lib/agent/signals/mutual-funds';
import { computeFuturesSignals } from '@/lib/agent/signals/futures';
import { scoreToRecommendation, scoreToConfidence } from '@/lib/agent/signals/score';
import { decide, type DecisionInputItem } from '@/lib/agent/engine/decide';
import { executeDecisions } from '@/lib/agent/engine/execute';
import { markToMarket } from '@/lib/agent/engine/mark-to-market';
import { snapshotEquity, agentBenchmarkSymbol } from '@/lib/agent/engine/equity-curve';
import { composeAdvisory, buildDeterministicDigest, type DigestDecision } from '@/lib/agent/llm/compose-advisory';
import { sendTelegramToUser } from '@/lib/services/telegram';

export interface AgentRunResult {
  status: 'COMPLETED' | 'SKIPPED' | 'FAILED';
  reason?: string;
  runDate: string;
  tradesExecuted?: number;
  equityValuePaisa?: number;
}

/** IST calendar date (YYYY-MM-DD). */
function istDate(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date()); // en-CA → YYYY-MM-DD
}

export async function runAgentDailyRun(
  userId: string,
  opts: { manual?: boolean } = {},
): Promise<AgentRunResult> {
  const runDate = istDate();

  const portfolio = (await db.select().from(agentPortfolios).where(eq(agentPortfolios.userId, userId)).limit(1))[0];
  if (!portfolio) return { status: 'SKIPPED', reason: 'no-portfolio', runDate };
  if (!portfolio.enabled && !opts.manual) return { status: 'SKIPPED', reason: 'disabled', runDate };

  // Idempotency: one run per user per IST day. Insert RUNNING; conflict = already ran.
  const inserted = await db
    .insert(agentRuns)
    .values({ userId, portfolioId: portfolio.id, runDate, status: 'RUNNING' })
    .onConflictDoNothing({ target: [agentRuns.userId, agentRuns.runDate] })
    .returning();
  if (!inserted.length) {
    const existing = (await db.select().from(agentRuns).where(and(eq(agentRuns.userId, userId), eq(agentRuns.runDate, runDate))).limit(1))[0];
    return { status: 'SKIPPED', reason: existing?.status === 'COMPLETED' ? 'already-ran' : 'in-progress', runDate };
  }
  const run = inserted[0];

  try {
    const watchlist = await db
      .select()
      .from(agentWatchlist)
      .where(and(eq(agentWatchlist.userId, userId), eq(agentWatchlist.enabled, true)));

    let quotesFetched = 0;
    let signalsComputed = 0;
    const decisionItems: DecisionInputItem[] = [];

    for (const w of watchlist) {
      const ref: InstrumentRef = {
        assetClass: w.assetClass,
        symbol: w.symbol || undefined,
        schemeCode: w.schemeCode || undefined,
        isin: w.isin || undefined,
        contractMultiplier: w.contractMultiplier,
      };
      const quote = await getInstrumentQuote(ref);
      if (!quote) continue; // skip instruments with no fresh quote
      quotesFetched += 1;
      const history = await getInstrumentHistory(ref);

      let score = 0;
      let signalsJson;
      if (w.assetClass === 'MF') {
        const r = computeMfSignals(history.map((p) => ({ dateIso: p.date, nav: p.closePaisa })));
        score = r.score;
        signalsJson = r.signals;
      } else if (w.assetClass === 'FUTURE') {
        const r = computeFuturesSignals(history.map((p) => p.closePaisa), quote.lastPricePaisa);
        score = r.score;
        signalsJson = r.signals;
      } else {
        const r = computeEquitySignals(history.map((p) => p.closePaisa), {
          lastPricePaisa: quote.lastPricePaisa,
          fiftyTwoWkHighPaisa: quote.fiftyTwoWkHighPaisa,
          fiftyTwoWkLowPaisa: quote.fiftyTwoWkLowPaisa,
        });
        score = r.score;
        signalsJson = r.signals;
      }

      const recommendation = scoreToRecommendation(score, portfolio.riskProfile);
      const confidence = scoreToConfidence(score);

      const [sig] = await db
        .insert(agentSignals)
        .values({
          userId,
          portfolioId: portfolio.id,
          runId: run.id,
          runDate,
          assetClass: w.assetClass,
          symbol: w.symbol || w.schemeCode || w.name,
          name: w.name,
          lastPricePaisa: quote.lastPricePaisa,
          score,
          recommendation,
          signalsJson,
        })
        .onConflictDoUpdate({
          target: [agentSignals.runId, agentSignals.symbol],
          set: { score, recommendation, lastPricePaisa: quote.lastPricePaisa, signalsJson },
        })
        .returning();
      signalsComputed += 1;

      decisionItems.push({
        assetClass: w.assetClass,
        symbol: w.symbol,
        schemeCode: w.schemeCode,
        name: w.name,
        contractMultiplier: w.contractMultiplier,
        signalId: sig?.id ?? null,
        score,
        recommendation,
        confidence,
        lastPricePaisa: quote.lastPricePaisa,
      });
    }

    // Decide + execute against current positions and cash.
    const positions = await db.select().from(agentPositions).where(eq(agentPositions.portfolioId, portfolio.id));
    const intents = decide(
      {
        startingCapitalPaisa: portfolio.startingCapitalPaisa,
        maxPositions: portfolio.maxPositions,
        perPositionPct: portfolio.perPositionPct,
        cashBufferPct: portfolio.cashBufferPct,
      },
      portfolio.cashBalancePaisa,
      positions.map((p) => ({ assetClass: p.assetClass, symbol: p.symbol, schemeCode: p.schemeCode, quantity: p.quantity })),
      decisionItems,
    );
    const exec = await executeDecisions(userId, portfolio, intents, run.id, runDate);

    // Mark-to-market with fresh cash balance.
    const fresh: AgentPortfolio = { ...portfolio, cashBalancePaisa: exec.cashBalancePaisa };
    const mtm = await markToMarket(userId, fresh);

    // Benchmark + equity-curve snapshot.
    const benchQuote = await getQuote(portfolio.benchmarkSymbol);
    const benchPricePaisa = benchQuote && Number.isFinite(benchQuote.regularMarketPrice)
      ? Math.round(benchQuote.regularMarketPrice * 100)
      : null;
    await snapshotEquity(userId, portfolio, mtm.equityValuePaisa, benchPricePaisa, runDate);

    // Returns for the digest.
    const portfolioReturnPct = portfolio.startingCapitalPaisa > 0
      ? ((mtm.equityValuePaisa - portfolio.startingCapitalPaisa) / portfolio.startingCapitalPaisa) * 100
      : 0;
    const baseline = (await db
      .select()
      .from(priceSnapshots)
      .where(and(eq(priceSnapshots.userId, userId), eq(priceSnapshots.assetSymbol, agentBenchmarkSymbol(portfolio.id))))
      .orderBy(asc(priceSnapshots.priceDate))
      .limit(1))[0];
    const benchmarkReturnPct = baseline && benchPricePaisa && baseline.price > 0
      ? ((benchPricePaisa - baseline.price) / baseline.price) * 100
      : 0;

    // Digest (LLM grounded, deterministic fallback).
    const digestDecisions: DigestDecision[] = intents.map((i) => ({
      action: i.action,
      assetClass: i.assetClass,
      symbol: i.symbol,
      name: i.name,
      quantity: i.quantity,
      amountPaisa: i.amountPaisa,
      score: i.score,
      recommendation: i.confidence,
    }));
    const digestInput = {
      portfolioName: portfolio.name,
      startingCapitalPaisa: portfolio.startingCapitalPaisa,
      cashPaisa: exec.cashBalancePaisa,
      equityPaisa: mtm.equityValuePaisa,
      benchmarkSymbol: portfolio.benchmarkSymbol,
      benchmarkReturnPct,
      portfolioReturnPct,
      decisions: digestDecisions,
      todayISO: runDate,
    };
    const digest = (await composeAdvisory(digestInput)) ?? buildDeterministicDigest(digestInput);

    await db.update(agentRuns).set({
      status: 'COMPLETED',
      finishedAt: new Date(),
      quotesFetched,
      signalsComputed,
      tradesExecuted: exec.tradesExecuted,
      equityValuePaisa: mtm.equityValuePaisa,
      benchmarkValuePaisa: benchPricePaisa ?? undefined,
      digestText: digest,
    }).where(eq(agentRuns.id, run.id));

    await db.update(agentPortfolios).set({ lastRunDate: runDate, updatedAt: new Date() }).where(eq(agentPortfolios.id, portfolio.id));

    if (portfolio.telegramEnabled) {
      await sendTelegramToUser(userId, digest).catch(() => {});
    }

    return { status: 'COMPLETED', runDate, tradesExecuted: exec.tradesExecuted, equityValuePaisa: mtm.equityValuePaisa };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(agentRuns).set({ status: 'FAILED', finishedAt: new Date(), error: message }).where(eq(agentRuns.id, run.id));
    console.error('agent-run failed:', err);
    return { status: 'FAILED', reason: message, runDate };
  }
}
