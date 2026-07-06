/**
 * GET /api/agent/pnl — per-bucket P&L panel (daily + overall), live-marked.
 *
 * Unified model per sleeve:  equity = cash + Σ(open positions marked live).
 *   • Daily P&L   = equity − opening   (opening = prior day's close; corpus at inception)
 *   • Overall P&L = equity − corpus
 * Intraday sleeves (cadence INTRADAY) end flat → equity collapses to cash; their open
 * positions are "in-flight" (settled cash is the balance, opens shown apart). Swing
 * sleeves carry positions into equity. Also returns today's round-trip ledger per
 * bucket. READ-ONLY reporting — drives no strategy, changes no sizing.
 */

import { NextResponse } from 'next/server';
import { and, eq, isNotNull } from 'drizzle-orm';
import { db, agentPortfolios, agentSleeves, agentPositions, agentTrades, agentSleeveSnapshots } from '@/db';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';
import { getQuotes } from '@/lib/services/yahoo-finance';

const istDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  const today = istDate();

  const pf = (await db.select().from(agentPortfolios).where(eq(agentPortfolios.userId, userId)).limit(1))[0];
  if (!pf) return NextResponse.json({ buckets: [], portfolio: null, asOf: today });

  const sleeves = await db.select().from(agentSleeves).where(eq(agentSleeves.portfolioId, pf.id));
  const positions = await db.select().from(agentPositions).where(eq(agentPositions.userId, userId));
  const trades = await db.select().from(agentTrades).where(and(eq(agentTrades.userId, userId), isNotNull(agentTrades.realizedPnlPaisa)));
  const priorSnaps = await db.select().from(agentSleeveSnapshots).where(eq(agentSleeveSnapshots.userId, userId));

  const symbols = [...new Set(positions.map((p) => p.symbol))];
  const qs = symbols.length ? await getQuotes(symbols).catch(() => []) : [];
  const px = new Map(qs.filter((q) => Number.isFinite(q.regularMarketPrice)).map((q) => [q.symbol, q.regularMarketPrice]));

  const buckets = sleeves.filter((s) => s.enabled).map((s) => {
    const intraday = s.cadence === 'INTRADAY';
    const corpus = s.allocationPaisa;
    const cash = s.cashBalancePaisa ?? 0;
    const sPos = positions.filter((p) => p.sleeveId === s.id);
    let posVal = 0, unreal = 0;
    const inflight = sPos.map((p) => {
      const cur = px.get(p.symbol);
      const last = cur != null ? Math.round(cur * 100) : null;
      const dir = p.side === 'SHORT' ? -1 : 1;
      // Side-aware unrealized: long = (last − avg); short = (avg − last).
      const u = last != null ? Math.round((last - p.avgPricePaisa) * p.quantity * p.contractMultiplier * dir) : 0;
      const exposure = last != null ? Math.round(last * p.quantity * p.contractMultiplier) : Math.round(p.avgPricePaisa * p.quantity * p.contractMultiplier);
      unreal += u;
      // Equity contribution: LONG = market value (cash WAS spent at entry, so add it back);
      // SHORT = P&L only (no cash spent). At EOD intraday is flat → posVal 0 → equity = cash.
      posVal += p.side === 'SHORT' ? u : exposure;
      return { symbol: p.symbol, name: p.name, side: p.side, qty: p.quantity, entryPaisa: p.avgPricePaisa, lastPaisa: last, marketPaisa: exposure, unrealPaisa: u };
    });
    const equity = cash + posVal;
    const sTrades = trades.filter((t) => t.sleeveId === s.id);
    const realizedToday = sTrades.filter((t) => t.tradeDate === today).reduce((a, t) => a + (t.realizedPnlPaisa ?? 0), 0);
    const realizedAll = sTrades.reduce((a, t) => a + (t.realizedPnlPaisa ?? 0), 0);
    const prior = priorSnaps.filter((x) => x.sleeveId === s.id && x.snapshotDate < today).sort((a, b) => (a.snapshotDate < b.snapshotDate ? 1 : -1));
    const opening = prior.length ? prior[0].equityPaisa : corpus;   // inception → corpus
    const ledger = sTrades
      .filter((t) => t.tradeDate === today)
      .map((t) => ({ symbol: t.symbol, name: t.name, side: t.side, qty: t.quantity, exitPaisa: t.pricePerUnitPaisa, realizedPaisa: t.realizedPnlPaisa ?? 0 }));

    return {
      key: s.key, name: s.name, type: intraday ? 'intraday' as const : 'swing' as const,
      corpusPaisa: corpus, cashPaisa: cash, positionsValuePaisa: posVal, equityPaisa: equity,
      openingPaisa: opening, realizedTodayPaisa: realizedToday, realizedAllPaisa: realizedAll, unrealizedPaisa: unreal,
      dailyPnlPaisa: equity - opening, overallPnlPaisa: equity - corpus,
      openCount: sPos.length, inflight, ledger,
    };
  });

  const sum = (f: (b: (typeof buckets)[number]) => number) => buckets.reduce((a, b) => a + f(b), 0);
  const portfolio = {
    corpusPaisa: sum((b) => b.corpusPaisa), cashPaisa: sum((b) => b.cashPaisa),
    positionsValuePaisa: sum((b) => b.positionsValuePaisa), equityPaisa: sum((b) => b.equityPaisa),
    dailyPnlPaisa: sum((b) => b.dailyPnlPaisa), overallPnlPaisa: sum((b) => b.overallPnlPaisa),
  };
  return NextResponse.json({ buckets, portfolio, asOf: today, marketDataOk: symbols.length === 0 || px.size > 0 });
}
