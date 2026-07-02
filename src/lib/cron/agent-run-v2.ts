/**
 * v2 orchestrator: seed the equal 4-way sleeve split on first run, then loop
 * each enabled sleeve through its strategy (runSleeve), mark to market, snapshot
 * per-sleeve + total equity vs benchmark, and notify. Idempotent per IST day.
 *
 * SAFETY: paper money only — agent_* tables + price_snapshots(AGENT_*) only.
 */

import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  db, agentPortfolios, agentSleeves, agentRuns, agentPositions, priceSnapshots,
  type AgentPortfolio, type AgentSleeve,
} from '@/db';
import { getQuote, getQuotes } from '@/lib/services/yahoo-finance';
import { NIFTY_500 } from '@/lib/agent/universe/nifty500';
import { isMarketOpen } from '@/lib/agent/market-data';
import { runSleeve } from '@/lib/agent/engine/run-sleeve';
import { runIntradayOrb } from '@/lib/agent/engine/run-intraday';
import { runIntradayScan, type ScanUniverseItem } from '@/lib/agent/engine/run-intraday-scan';
import { runNewsSignal } from '@/lib/agent/engine/run-news-signal';
import { runSwing } from '@/lib/agent/engine/run-swing';
import { SCAN_STRATEGIES } from '@/lib/agent/strategies/intraday-scan';
import { getInPlay } from '@/lib/agent/news/ingest';
import { getBriefBias } from '@/lib/agent/news/brief';
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

/**
 * Ensure every default sleeve exists. First run: equal-split the starting capital.
 * Later: ADD any newly-introduced sleeve (e.g. the VWAP/gap/news baskets) at the
 * existing per-sleeve allocation — growing the paper corpus, not re-splitting —
 * and bump the portfolio's starting capital so the total return% stays honest.
 */
export async function ensureSleeves(userId: string, portfolio: AgentPortfolio): Promise<AgentSleeve[]> {
  const existing = await db.select().from(agentSleeves).where(eq(agentSleeves.portfolioId, portfolio.id));
  const existingKeys = new Set(existing.map((s) => s.key));
  const missing = DEFAULT_SLEEVES.filter((d) => !existingKeys.has(d.key));
  if (!missing.length) return existing;

  // Per-sleeve allocation: match the existing sleeves (grow corpus), else split.
  const per = existing.length
    ? existing[0].allocationPaisa
    : Math.floor(portfolio.startingCapitalPaisa / DEFAULT_SLEEVES.length);
  const rows = missing.map((d) => ({
    userId, portfolioId: portfolio.id, key: d.key, name: d.name, strategy: d.strategy, cadence: d.cadence,
    allocationPaisa: per, cashBalancePaisa: per, paramsJson: {},
  }));
  const inserted = await db.insert(agentSleeves).values(rows).returning();

  // Keep starting capital = Σ sleeve allocations so return% is meaningful.
  const totalAlloc = [...existing, ...inserted].reduce((a, s) => a + s.allocationPaisa, 0);
  if (totalAlloc !== portfolio.startingCapitalPaisa) {
    await db.update(agentPortfolios).set({ startingCapitalPaisa: totalAlloc, updatedAt: new Date() }).where(eq(agentPortfolios.id, portfolio.id));
  }
  return [...existing, ...inserted];
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
      // ORB + the swing buckets (STK_FAST/STK_SHORT) are owned by the intraday
      // runner (run-intraday / run-swing) — the daily run just marks them to
      // market so they count in the total; it never trades them.
      const intradayOwned = sleeve.strategy === 'INTRADAY_ORB' || sleeve.key === 'STK_FAST' || sleeve.key === 'STK_SHORT';
      const r = intradayOwned
        ? { sleeveKey: sleeve.key, quotesFetched: 0, decisions: 0, tradesExecuted: 0, cashBalancePaisa: sleeve.cashBalancePaisa }
        : await runSleeve(userId, sleeve, run.id, runDate, { execute: canExecute });
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
 * Shared liquid universe for the price-scan intraday baskets (VWAP, gap-and-go):
 * the portfolio's watchlist ∪ today's directional brief names ∪ fresh in-play,
 * deduped, .NS only, bounded — so the new baskets trade what's liquid + in play.
 *
 * (helper) buildScanUniverse defined below runAgentIntraday.
 *
 * Intraday run: the INTRADAY-cadence sleeves (ORB, VWAP, gap-and-go, news, and
 * the 2-3d mean-reversion sleeve), only while the market is open. Runs several times a day; each tick is
 * its own run row (timestamped) so it isn't blocked by the daily idempotency.
 * Equity snapshots use the plain date (one point/day, upserted).
 */
export async function runAgentIntraday(userId: string): Promise<AgentV2Result> {
  const runDate = istDate();
  const marketOpen = await isMarketOpen();
  const portfolio = (await db.select().from(agentPortfolios).where(eq(agentPortfolios.userId, userId)).limit(1))[0];
  if (!portfolio || !portfolio.enabled) return { status: 'SKIPPED', reason: 'disabled', runDate };
  const all = await db.select().from(agentSleeves).where(eq(agentSleeves.portfolioId, portfolio.id));
  // Intraday-cadence sleeves + the two swing buckets (managed intraday for stop/
  // target, held multi-day — run-swing owns them; the daily run skips them).
  const sleeves = all.filter((s) => s.enabled && (s.cadence === 'INTRADAY' || s.key === 'STK_SHORT'));
  if (!sleeves.length) return { status: 'SKIPPED', reason: 'no-intraday-sleeves', runDate };
  // When the market is closed we still run intraday sleeves that hold positions
  // (to square them off — never overnight); pure entry sleeves wait for open.
  const openRows = await db.select({ sleeveId: agentPositions.sleeveId }).from(agentPositions)
    .where(inArray(agentPositions.sleeveId, sleeves.map((s) => s.id)));
  const openBySleeve = new Map<number, number>();
  for (const r of openRows) if (r.sleeveId != null) openBySleeve.set(r.sleeveId, (openBySleeve.get(r.sleeveId) ?? 0) + 1);
  if (!marketOpen && !openRows.length) return { status: 'SKIPPED', reason: 'market-closed', runDate };

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
    // Shared liquid universe for the price-scan baskets (built once when open).
    const needScan = sleeves.some((s) => s.strategy === 'VWAP_REVERSION' || s.strategy === 'GAP_AND_GO');
    const scanUniverse = needScan && marketOpen ? await buildScanUniverse(userId, portfolio.id) : [];
    for (const sleeve of sleeves) {
      const hasOpen = (openBySleeve.get(sleeve.id) ?? 0) > 0;
      let r;
      if (sleeve.key === 'STK_FAST' || sleeve.key === 'STK_SHORT') {
        // Swing funnel: 2-3 day (SHORT) / 2-3 month (LONG) catalyst holds.
        if (!marketOpen && !hasOpen) continue;
        r = await runSwing(userId, sleeve, run.id, runDate, { marketOpen, horizon: sleeve.key === 'STK_SHORT' ? 'LONG' : 'SHORT' });
      } else if (sleeve.strategy === 'INTRADAY_ORB') {
        r = await runIntradayOrb(userId, sleeve, run.id, runDate, { marketOpen });
      } else if (sleeve.strategy === 'VWAP_REVERSION' || sleeve.strategy === 'GAP_AND_GO') {
        if (!marketOpen && !hasOpen) continue; // no entries + nothing to square off
        r = await runIntradayScan(userId, sleeve, SCAN_STRATEGIES[sleeve.strategy], run.id, runDate, { marketOpen, universe: scanUniverse });
      } else if (sleeve.strategy === 'NEWS_SIGNAL') {
        if (!marketOpen && !hasOpen) continue;
        r = await runNewsSignal(userId, sleeve, run.id, runDate, { marketOpen });
      } else {
        if (!marketOpen) continue; // legacy intraday sleeves only fill during hours
        r = await runSleeve(userId, sleeve, run.id, runDate, { execute: true });
      }
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

const IN_PLAY_MOVE_PCT = 1.5;  // a Nifty-500 name is "in play" if it's moved ≥ this today
const SCAN_CHUNK = 50;         // batched-quote chunk size (500 at once would rate-limit)

/**
 * Shared scan universe for VWAP + gap-and-go = today's Nifty-500 IN-PLAY movers
 * (|day change| ≥ threshold) ∪ directional brief names ∪ fresh news in-play.
 * Equities only (.NS) — this drops the `=F` futures + the static large-cap
 * watchlist that were starving gap-and-go of candidates. Bounded to keep the
 * per-tick intraday-bar fetches small; the batched quote scan uses the 5-min cache.
 */
async function buildScanUniverse(_userId: string, _portfolioId: number): Promise<ScanUniverseItem[]> {
  // Nifty-500 day-change via batched quotes → the in-play movers (where gaps live).
  const changes = new Map<string, number>();
  for (let i = 0; i < NIFTY_500.length; i += SCAN_CHUNK) {
    const qs = await getQuotes(NIFTY_500.slice(i, i + SCAN_CHUNK));
    for (const q of qs) if (Number.isFinite(q.regularMarketChangePercent)) changes.set(q.symbol, q.regularMarketChangePercent);
  }
  const map = new Map<string, ScanUniverseItem>();
  [...changes.entries()]
    .filter(([, c]) => Math.abs(c) >= IN_PLAY_MOVE_PCT)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 40)
    .forEach(([s]) => { if (s.endsWith('.NS')) map.set(s, { symbol: s, name: s }); });

  const brief = await getBriefBias().catch(() => new Map<string, { bias: string }>());
  for (const [s, v] of brief) if (v.bias !== 'NEUTRAL' && s.endsWith('.NS') && !map.has(s)) map.set(s, { symbol: s, name: s });
  const inPlay = (await getInPlay().catch(() => [])).map((x) => x.symbol);
  for (const s of inPlay) if (s.endsWith('.NS') && !map.has(s)) map.set(s, { symbol: s, name: s });
  return [...map.values()].slice(0, 50);
}
