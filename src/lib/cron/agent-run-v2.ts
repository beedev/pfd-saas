/**
 * v2 orchestrator: seed the equal 4-way sleeve split on first run, then loop
 * each enabled sleeve through its strategy (runSleeve), mark to market, snapshot
 * per-sleeve + total equity vs benchmark, and notify. Idempotent per IST day.
 *
 * SAFETY: paper money only — agent_* tables + price_snapshots(AGENT_*) only.
 */

import { and, asc, eq } from 'drizzle-orm';
import {
  db, agentPortfolios, agentSleeves, agentRuns, priceSnapshots,
  type AgentPortfolio, type AgentSleeve,
} from '@/db';
import { getQuote } from '@/lib/services/yahoo-finance';
import { isMarketOpen } from '@/lib/agent/market-data';
import { runSleeve } from '@/lib/agent/engine/run-sleeve';
import { markSleeveToMarket } from '@/lib/agent/engine/mark-sleeve';
import { snapshotEquity, snapshotSleeveEquity, agentBenchmarkSymbol } from '@/lib/agent/engine/equity-curve';
import { DEFAULT_SLEEVES } from '@/lib/agent/strategies/registry';
import { sendTelegramToUser } from '@/lib/services/telegram';

export interface AgentV2Result {
  status: 'COMPLETED' | 'SKIPPED' | 'FAILED';
  reason?: string;
  runDate: string;
  totalEquityPaisa?: number;
  sleeves?: Array<{ key: string; equityPaisa: number; trades: number }>;
}

function istDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
const inr = (p: number) => '₹' + Math.round(p / 100).toLocaleString('en-IN');
const pct = (n: number | null) => (n == null ? 'n/a' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`);

export async function ensurePortfolio(userId: string): Promise<AgentPortfolio> {
  const existing = (await db.select().from(agentPortfolios).where(eq(agentPortfolios.userId, userId)).limit(1))[0];
  if (existing) return existing;
  const [created] = await db.insert(agentPortfolios).values({ userId }).returning();
  return created;
}

/** Seed the 4 equal-split sleeves if none exist. */
export async function ensureSleeves(userId: string, portfolio: AgentPortfolio): Promise<AgentSleeve[]> {
  const existing = await db.select().from(agentSleeves).where(eq(agentSleeves.portfolioId, portfolio.id));
  if (existing.length) return existing;
  const total = portfolio.startingCapitalPaisa;
  const per = Math.floor(total / DEFAULT_SLEEVES.length);
  const rows = DEFAULT_SLEEVES.map((d, i) => {
    const alloc = i === DEFAULT_SLEEVES.length - 1 ? total - per * (DEFAULT_SLEEVES.length - 1) : per;
    return { userId, portfolioId: portfolio.id, key: d.key, name: d.name, strategy: d.strategy, cadence: d.cadence, allocationPaisa: alloc, cashBalancePaisa: alloc, paramsJson: {} };
  });
  return db.insert(agentSleeves).values(rows).returning();
}

export async function runAgentV2(userId: string, opts: { manual?: boolean } = {}): Promise<AgentV2Result> {
  const runDate = istDate();
  const portfolio = await ensurePortfolio(userId);
  if (!portfolio.enabled && !opts.manual) return { status: 'SKIPPED', reason: 'disabled', runDate };

  const inserted = await db
    .insert(agentRuns)
    .values({ userId, portfolioId: portfolio.id, runDate, status: 'RUNNING' })
    .onConflictDoNothing({ target: [agentRuns.userId, agentRuns.runDate] })
    .returning();
  if (!inserted.length) {
    const ex = (await db.select().from(agentRuns).where(and(eq(agentRuns.userId, userId), eq(agentRuns.runDate, runDate))).limit(1))[0];
    return { status: 'SKIPPED', reason: ex?.status === 'COMPLETED' ? 'already-ran' : 'in-progress', runDate };
  }
  const run = inserted[0];

  try {
    const sleeves = await ensureSleeves(userId, portfolio);
    // Trades only fill when the market is open (no "monopoly-game" timing).
    // A manual run-now may fill anytime so the user can test on demand.
    const canExecute = (await isMarketOpen()) || !!opts.manual;
    let totalEquity = 0;
    let totalTrades = 0;
    const sleeveResults: Array<{ key: string; name: string; equityPaisa: number; trades: number; allocationPaisa: number }> = [];

    for (const sleeve of sleeves) {
      if (!sleeve.enabled) continue;
      const r = await runSleeve(userId, sleeve, run.id, runDate, { execute: canExecute });
      const equity = await markSleeveToMarket(userId, sleeve.id, r.cashBalancePaisa);
      await snapshotSleeveEquity(userId, portfolio.id, sleeve.id, sleeve.name, equity, runDate);
      totalEquity += equity;
      totalTrades += r.tradesExecuted;
      sleeveResults.push({ key: sleeve.key, name: sleeve.name, equityPaisa: equity, trades: r.tradesExecuted, allocationPaisa: sleeve.allocationPaisa });
    }

    // Total portfolio equity + benchmark snapshot.
    const benchQuote = await getQuote(portfolio.benchmarkSymbol);
    const benchPaisa = benchQuote && Number.isFinite(benchQuote.regularMarketPrice) ? Math.round(benchQuote.regularMarketPrice * 100) : null;
    await snapshotEquity(userId, portfolio, totalEquity, benchPaisa, runDate);

    const totalReturn = portfolio.startingCapitalPaisa > 0 ? ((totalEquity - portfolio.startingCapitalPaisa) / portfolio.startingCapitalPaisa) * 100 : 0;
    const baseline = (await db.select().from(priceSnapshots)
      .where(and(eq(priceSnapshots.userId, userId), eq(priceSnapshots.assetSymbol, agentBenchmarkSymbol(portfolio.id))))
      .orderBy(asc(priceSnapshots.priceDate)).limit(1))[0];
    const benchReturn = baseline && benchPaisa && baseline.price > 0 ? ((benchPaisa - baseline.price) / baseline.price) * 100 : 0;

    const digest = [
      `*Paper portfolio* — ${runDate}`,
      `Total ${inr(totalEquity)} (${pct(totalReturn)}) vs ${portfolio.benchmarkSymbol} ${pct(benchReturn)}. ${totalTrades} trade(s).`,
      ...sleeveResults.map((s) => {
        const ret = s.allocationPaisa > 0 ? ((s.equityPaisa - s.allocationPaisa) / s.allocationPaisa) * 100 : 0;
        return `• ${s.name}: ${inr(s.equityPaisa)} (${pct(ret)}), ${s.trades} trade(s)`;
      }),
      ...(canExecute ? [] : ['_Market closed — decisions recorded, no fills._']),
      `_Paper trading — not financial advice._`,
    ].join('\n');

    await db.update(agentRuns).set({ status: 'COMPLETED', finishedAt: new Date(), tradesExecuted: totalTrades, equityValuePaisa: totalEquity, benchmarkValuePaisa: benchPaisa ?? undefined, digestText: digest }).where(eq(agentRuns.id, run.id));
    await db.update(agentPortfolios).set({ lastRunDate: runDate, updatedAt: new Date() }).where(eq(agentPortfolios.id, portfolio.id));
    if (portfolio.telegramEnabled) await sendTelegramToUser(userId, digest).catch(() => {});

    return { status: 'COMPLETED', runDate, totalEquityPaisa: totalEquity, sleeves: sleeveResults.map((s) => ({ key: s.key, equityPaisa: s.equityPaisa, trades: s.trades })) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(agentRuns).set({ status: 'FAILED', finishedAt: new Date(), error: message }).where(eq(agentRuns.id, run.id));
    console.error('agent-run-v2 failed:', err);
    return { status: 'FAILED', reason: message, runDate };
  }
}

/** IST timestamp 'YYYY-MM-DDTHH:MM' for uniquely keying intraday runs. */
function istStamp(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}

/**
 * Intraday run: only the INTRADAY-cadence sleeves (the 2-3d mean-reversion
 * sleeve), only while the market is open. Runs several times a day; each tick is
 * its own run row (timestamped) so it isn't blocked by the daily idempotency.
 * Equity snapshots use the plain date (one point/day, upserted).
 */
export async function runAgentIntraday(userId: string): Promise<AgentV2Result> {
  const runDate = istDate();
  if (!(await isMarketOpen())) return { status: 'SKIPPED', reason: 'market-closed', runDate };
  const portfolio = (await db.select().from(agentPortfolios).where(eq(agentPortfolios.userId, userId)).limit(1))[0];
  if (!portfolio || !portfolio.enabled) return { status: 'SKIPPED', reason: 'disabled', runDate };
  const all = await db.select().from(agentSleeves).where(eq(agentSleeves.portfolioId, portfolio.id));
  const sleeves = all.filter((s) => s.enabled && s.cadence === 'INTRADAY');
  if (!sleeves.length) return { status: 'SKIPPED', reason: 'no-intraday-sleeves', runDate };

  const inserted = await db
    .insert(agentRuns)
    .values({ userId, portfolioId: portfolio.id, runDate: istStamp(), status: 'RUNNING' })
    .onConflictDoNothing({ target: [agentRuns.userId, agentRuns.runDate] })
    .returning();
  if (!inserted.length) return { status: 'SKIPPED', reason: 'in-progress', runDate };
  const run = inserted[0];

  try {
    let trades = 0;
    const results: Array<{ key: string; equityPaisa: number; trades: number }> = [];
    for (const sleeve of sleeves) {
      const r = await runSleeve(userId, sleeve, run.id, runDate, { execute: true });
      const equity = await markSleeveToMarket(userId, sleeve.id, r.cashBalancePaisa);
      await snapshotSleeveEquity(userId, portfolio.id, sleeve.id, sleeve.name, equity, runDate);
      trades += r.tradesExecuted;
      results.push({ key: sleeve.key, equityPaisa: equity, trades: r.tradesExecuted });
    }
    await db.update(agentRuns).set({ status: 'COMPLETED', finishedAt: new Date(), tradesExecuted: trades }).where(eq(agentRuns.id, run.id));
    return { status: 'COMPLETED', runDate, sleeves: results };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(agentRuns).set({ status: 'FAILED', finishedAt: new Date(), error: message }).where(eq(agentRuns.id, run.id));
    return { status: 'FAILED', reason: message, runDate };
  }
}
