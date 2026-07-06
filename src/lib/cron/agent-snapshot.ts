/**
 * Daily performance snapshot — the persisted equity time series a 6-month forward-
 * test is analyzed from. Runs end-of-day (16:00 IST, after square-off + close);
 * records total paper equity (cash + open positions at market), cumulative realized
 * + current unrealized P&L, open/closed counts, win-rate, and a running high-water
 * mark + drawdown. Sends an EOD performance line to Telegram. Paper only.
 */

import { and, eq, isNotNull } from 'drizzle-orm';
import { db, agentPortfolios, agentSleeves, agentPositions, agentTrades, agentDailySnapshots, agentSleeveSnapshots } from '@/db';
import { getQuotes } from '@/lib/services/yahoo-finance';
import { isTradingDayNow } from '@/lib/agent/trading-calendar';
import { sendTelegramToUser } from '@/lib/services/telegram';

const istDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const rup = (paisa: number) => `₹${Math.round(paisa / 100).toLocaleString('en-IN')}`;

export interface SnapshotResult { status: 'RECORDED' | 'SKIPPED'; date: string; equityRupees?: number; totalReturnPct?: number; drawdownPct?: number }

export async function recordDailySnapshot(userId: string): Promise<SnapshotResult> {
  const date = istDate();
  if (!isTradingDayNow()) return { status: 'SKIPPED', date };   // no weekend/holiday snapshots — Friday's equity stands
  const pf = (await db.select().from(agentPortfolios).where(eq(agentPortfolios.userId, userId)).limit(1))[0];
  if (!pf || !pf.enabled) return { status: 'SKIPPED', date };

  const sleeves = await db.select().from(agentSleeves).where(eq(agentSleeves.portfolioId, pf.id));
  const cash = sleeves.reduce((a, s) => a + (s.cashBalancePaisa ?? 0), 0);

  const positions = await db.select().from(agentPositions).where(eq(agentPositions.userId, userId));
  const symbols = [...new Set(positions.map((p) => p.symbol))];
  const qs = symbols.length ? await getQuotes(symbols).catch(() => []) : [];
  const px = new Map(qs.filter((q) => Number.isFinite(q.regularMarketPrice)).map((q) => [q.symbol, q.regularMarketPrice]));
  let openValue = 0, unrealized = 0;
  for (const p of positions) {
    const cur = px.get(p.symbol);
    if (cur == null) { openValue += Math.round(p.avgPricePaisa * p.quantity * p.contractMultiplier); continue; }   // fall back to cost if unpriced
    openValue += Math.round(cur * 100 * p.quantity * p.contractMultiplier);
    unrealized += Math.round((cur * 100 - p.avgPricePaisa) * p.quantity * p.contractMultiplier);
  }
  const equity = cash + openValue;

  const closes = await db.select({ pnl: agentTrades.realizedPnlPaisa }).from(agentTrades).where(and(eq(agentTrades.userId, userId), isNotNull(agentTrades.realizedPnlPaisa)));
  const realizedCum = closes.reduce((a, t) => a + (t.pnl ?? 0), 0);
  const closedTrades = closes.length;
  const wins = closes.filter((t) => (t.pnl ?? 0) > 0).length;
  const winRatePct = closedTrades ? +((wins / closedTrades) * 100).toFixed(1) : 0;

  // Running peak + drawdown from prior snapshots.
  const prior = await db.select().from(agentDailySnapshots).where(eq(agentDailySnapshots.userId, userId));
  const priorPeak = prior.reduce((mx, s) => Math.max(mx, s.peakEquityPaisa ?? s.equityPaisa), 0);
  const inceptionEquity = prior.length ? prior.sort((a, b) => (a.snapshotDate < b.snapshotDate ? -1 : 1))[0].equityPaisa : equity;
  const peak = Math.max(priorPeak, equity);
  const drawdownPct = peak > 0 ? +(((equity - peak) / peak) * 100).toFixed(2) : 0;
  const totalReturnPct = inceptionEquity > 0 ? +(((equity - inceptionEquity) / inceptionEquity) * 100).toFixed(2) : 0;

  await db.insert(agentDailySnapshots).values({ userId, snapshotDate: date, equityPaisa: equity, cashPaisa: cash, unrealizedPaisa: unrealized, realizedCumPaisa: realizedCum, openPositions: positions.length, closedTrades, winRatePct, peakEquityPaisa: peak, drawdownPct })
    .onConflictDoUpdate({ target: [agentDailySnapshots.userId, agentDailySnapshots.snapshotDate], set: { equityPaisa: equity, cashPaisa: cash, unrealizedPaisa: unrealized, realizedCumPaisa: realizedCum, openPositions: positions.length, closedTrades, winRatePct, peakEquityPaisa: peak, drawdownPct } });

  // ---- Per-sleeve closing balances (roll-forward ledger for the P&L panel) ----
  // Each sleeve's closing equity becomes its next-day opening. Opening at inception
  // (no prior snapshot) = corpus. Intraday sleeves end flat so equity = cash.
  const priorSleeveSnaps = await db.select().from(agentSleeveSnapshots).where(eq(agentSleeveSnapshots.userId, userId));
  const todaysCloses = await db.select({ sleeveId: agentTrades.sleeveId, pnl: agentTrades.realizedPnlPaisa })
    .from(agentTrades).where(and(eq(agentTrades.userId, userId), eq(agentTrades.tradeDate, date), isNotNull(agentTrades.realizedPnlPaisa)));
  for (const s of sleeves) {
    const sPos = positions.filter((p) => p.sleeveId === s.id);
    let posVal = 0, unreal = 0;
    for (const p of sPos) {
      const cur = px.get(p.symbol);
      const last = cur != null ? cur * 100 : p.avgPricePaisa;
      const dir = p.side === 'SHORT' ? -1 : 1;
      const u = Math.round((last - p.avgPricePaisa) * p.quantity * p.contractMultiplier * dir);   // side-aware
      unreal += u;
      // In-flight equity: LONG = market value (cash spent at entry); SHORT = P&L only.
      // Intraday ends flat → posVal 0 → equity = cash.
      posVal += p.side === 'SHORT' ? u : Math.round(last * p.quantity * p.contractMultiplier);
    }
    const sCash = s.cashBalancePaisa ?? 0;
    const sEquity = sCash + posVal;
    const corpus = s.allocationPaisa;
    const dailyRealized = todaysCloses.filter((t) => t.sleeveId === s.id).reduce((a, t) => a + (t.pnl ?? 0), 0);
    const priorForSleeve = priorSleeveSnaps.filter((x) => x.sleeveId === s.id && x.snapshotDate < date).sort((a, b) => (a.snapshotDate < b.snapshotDate ? 1 : -1));
    const opening = priorForSleeve.length ? priorForSleeve[0].equityPaisa : corpus;
    const row = { userId, sleeveId: s.id, snapshotDate: date, corpusPaisa: corpus, openingPaisa: opening, cashPaisa: sCash, positionsValuePaisa: posVal, equityPaisa: sEquity, dailyRealizedPaisa: dailyRealized, dailyUnrealizedPaisa: unreal, dailyPnlPaisa: sEquity - opening, overallPnlPaisa: sEquity - corpus, openPositions: sPos.length };
    await db.insert(agentSleeveSnapshots).values(row).onConflictDoUpdate({ target: [agentSleeveSnapshots.sleeveId, agentSleeveSnapshots.snapshotDate], set: row });
  }

  const msg = `📊 *Artha EOD · ${date}*\nEquity *${rup(equity)}*  (${totalReturnPct >= 0 ? '+' : ''}${totalReturnPct}% since start)\n${positions.length} open · unrealized ${rup(unrealized)} · realized ${rup(realizedCum)}\n${closedTrades} closed · win ${winRatePct}% · drawdown ${drawdownPct}%`;
  await sendTelegramToUser(userId, msg).catch(() => {});

  return { status: 'RECORDED', date, equityRupees: Math.round(equity / 100), totalReturnPct, drawdownPct };
}
