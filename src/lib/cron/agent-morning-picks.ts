/**
 * Morning picks pipeline — runs ~7:30 IST with the pre-market brief. Gathers the
 * day's candidate stocks (news in-play + brief), VETS each through the character
 * test + a liquidity gate, splits them into INTRADAY vs 2-3 MONTH, stores them as
 * the day's picks, and signals the user on Telegram. run-swing then trades these
 * picks during the session (STK_WATCH intraday / STK_SHORT 2-3mo). Paper only.
 */

import { and, eq } from 'drizzle-orm';
import { db, agentDailyPicks, agentPortfolios } from '@/db';
import { getQuotes } from '@/lib/services/yahoo-finance';
import { loadDaily } from '@/lib/agent/workbench/data';
import { assessStock } from '@/lib/agent/workbench/character';
import { getInPlay } from '@/lib/agent/news/ingest';
import { getBriefBias } from '@/lib/agent/news/brief';
import { getAnnouncementSymbols } from '@/lib/agent/news/announcements';
import { getBhavcopy } from '@/lib/agent/providers/nse-bhavcopy';
import { screenRsStage, atrStopFrac } from '@/lib/agent/engine/rs-stage-screen';
import { resolveUniverse } from '@/lib/agent/workbench/universes';
import { sendTelegramToUser } from '@/lib/services/telegram';

const MIN_LIQUIDITY_CR = 5;      // drop anything trading < ₹5 cr/day — untradeable
const MIN_DELIVERY_PCT = 45;     // 2-3mo picks: only high-conviction names (≥45% of volume taken to delivery, not churn)
const MAX_CANDIDATES = 40;
// Suggested exit levels for the signal — MATCHES the run-swing validation buy:
//   2-3 month → volatility-based stop (2×ATR, clamped 4-10%) + 2:1 target;
//   intraday  → +3% / -2% (square off same day).
const exitLevels = (buy: number, horizon: 'INTRADAY' | 'MULTIDAY', stopFrac = 0.08) => {
  if (horizon === 'INTRADAY') return { target: buy * 1.03, stop: buy * 0.98 };
  const stop = buy * (1 - stopFrac);
  return { target: buy + 2 * (buy - stop), stop };
};
const istDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export interface MorningPicksResult { status: 'COMPLETED' | 'SKIPPED'; pickDate: string; considered: number; picked: number; intraday: number; multiday: number }

export async function runMorningPicks(userId: string): Promise<MorningPicksResult> {
  const pickDate = istDate();
  const pf = (await db.select().from(agentPortfolios).where(eq(agentPortfolios.userId, userId)).limit(1))[0];
  if (!pf || !pf.enabled) return { status: 'SKIPPED', pickDate, considered: 0, picked: 0, intraday: 0, multiday: 0 };

  // 1. Candidates: news in-play + directional brief + whole-spectrum NSE
  //    announcements (breaks the Nifty-500 bubble — any material filing nominates a name).
  const inPlay = (await getInPlay().catch(() => [])).map((x) => x.symbol);
  const brief = await getBriefBias().catch(() => new Map<string, { bias: string }>());
  const briefNames = [...brief.entries()].filter(([, v]) => v.bias !== 'NEUTRAL').map(([s]) => s);
  const announced = await getAnnouncementSymbols(40).catch(() => []);
  const announcedSet = new Set(announced);
  const candidates = [...new Set([...briefNames, ...inPlay, ...announced])].filter((s) => s.endsWith('.NS')).slice(0, MAX_CANDIDATES);
  if (!candidates.length) return { status: 'COMPLETED', pickDate, considered: 0, picked: 0, intraday: 0, multiday: 0 };

  // 2. Liquidity (traded value/day) + delivery % from NSE bhavcopy; Yahoo volume fallback.
  const bhav = await getBhavcopy().catch(() => new Map());
  const qs = await getQuotes(candidates).catch(() => []);
  const yLiq = new Map<string, number>();
  const yPrice = new Map<string, number>();
  for (const q of qs) {
    if (Number.isFinite(q.regularMarketPrice) && Number.isFinite(q.regularMarketVolume)) yLiq.set(q.symbol, (q.regularMarketPrice * q.regularMarketVolume) / 1e7);
    if (Number.isFinite(q.regularMarketPrice)) yPrice.set(q.symbol, q.regularMarketPrice);
  }
  const liqOf = (sym: string) => bhav.get(sym.replace('.NS', ''))?.tradedValueCr ?? yLiq.get(sym) ?? 0;
  const delivOf = (sym: string): number | null => bhav.get(sym.replace('.NS', ''))?.deliveryPct ?? null;
  const priceOf = (sym: string): number | null => yPrice.get(sym) ?? bhav.get(sym.replace('.NS', ''))?.close ?? null;   // live quote first, else bhavcopy close

  // 3. Vet each: character test + liquidity + delivery gates → YES only.
  const picks: Array<{ symbol: string; name: string; horizon: 'INTRADAY' | 'MULTIDAY'; recommended: string; liquidityCr: number; deliveryPct: number | null; suggestedBuy: number | null; targetPrice: number | null; stopPrice: number | null; source: string; report: unknown }> = [];
  for (const sym of candidates) {
    if (liqOf(sym) < MIN_LIQUIDITY_CR) continue;                          // too thin to trade
    const bars = await loadDaily(sym, '5y').catch(() => []);
    if (bars.length < 250) continue;
    const r = assessStock(sym.replace('.NS', ''), bars);
    if (r.verdict !== 'YES') continue;
    if (r.recommended === 'MEAN_REVERSION' && r.rangeStatus !== 'in-range') continue;   // range broke → skip the dip
    if (r.recommended === 'MOMENTUM' && r.stage !== 'STAGE2') continue;                 // trends by character but basing/declining now → wait
    // Split: momentum/trend → hold 2-3 months; reversion → intraday only.
    const horizon: 'INTRADAY' | 'MULTIDAY' = r.recommended === 'MOMENTUM' ? 'MULTIDAY' : 'INTRADAY';
    const deliv = delivOf(sym);
    if (horizon === 'MULTIDAY' && deliv != null && deliv < MIN_DELIVERY_PCT) continue;  // churn, not real accumulation → skip the hold
    const buy = priceOf(sym);
    const ex = buy ? exitLevels(buy, horizon, atrStopFrac(bars.map((b) => ({ high: b.high, low: b.low, close: b.close })))) : null;
    picks.push({ symbol: sym, name: r.symbol, horizon, recommended: r.recommended, liquidityCr: liqOf(sym), deliveryPct: deliv, suggestedBuy: buy, targetPrice: ex?.target ?? null, stopPrice: ex?.stop ?? null, source: announcedSet.has(sym) ? 'announcement' : 'news',
      report: { ...r, liquidityCr: liqOf(sym), deliveryPct: deliv, suggestedBuy: buy, targetPrice: ex?.target ?? null, stopPrice: ex?.stop ?? null } });
  }

  // 3b. RS/Stage-2 screen — dynamically strong names (replaces the static blue-chip
  //     watchlist role): Stage-2 + beating the Nifty on 6-month RS, liquid, real delivery.
  const strong = await screenRsStage(resolveUniverse('NIFTY_500').slice(0, 150), '^NSEI', 12).catch(() => []);
  const seen = new Set(picks.map((p) => p.symbol));
  for (const s of strong) {
    if (seen.has(s.symbol) || !s.symbol.endsWith('.NS')) continue;
    const liq = liqOf(s.symbol);
    if (liq < MIN_LIQUIDITY_CR) continue;
    const deliv = delivOf(s.symbol);
    if (deliv != null && deliv < MIN_DELIVERY_PCT) continue;
    seen.add(s.symbol);
    const rsPct = +(s.rsExcess * 100).toFixed(1);
    const buy = priceOf(s.symbol);
    const ex = buy ? exitLevels(buy, 'MULTIDAY', s.atrFrac) : null;
    picks.push({ symbol: s.symbol, name: s.name, horizon: 'MULTIDAY', recommended: 'MOMENTUM', liquidityCr: liq, deliveryPct: deliv, suggestedBuy: buy, targetPrice: ex?.target ?? null, stopPrice: ex?.stop ?? null, source: 'screen',
      report: { stage: 'STAGE2', recommended: 'MOMENTUM', source: 'rs_stage_screen', rsExcess: rsPct, liquidityCr: liq, deliveryPct: deliv, suggestedBuy: buy, targetPrice: ex?.target ?? null, stopPrice: ex?.stop ?? null, note: `RS screen — Stage 2, +${rsPct.toFixed(0)}% vs Nifty (6mo).` } });
  }

  // 4. Persist today's picks (idempotent per user/date/symbol).
  await db.delete(agentDailyPicks).where(and(eq(agentDailyPicks.userId, userId), eq(agentDailyPicks.pickDate, pickDate)));
  if (picks.length) {
    await db.insert(agentDailyPicks).values(picks.map((p) => ({ userId, pickDate, symbol: p.symbol, name: p.name, horizon: p.horizon, source: p.source, recommended: p.recommended, reportJson: p.report })));
  }
  const intraday = picks.filter((p) => p.horizon === 'INTRADAY');
  const multiday = picks.filter((p) => p.horizon === 'MULTIDAY');

  // 5. Signal the user.
  if (picks.length) {
    const line = (p: typeof picks[number]) => {
      const buyStr = p.suggestedBuy ? `buy ~₹${p.suggestedBuy.toFixed(0)}` : 'buy at open';
      const exStr = p.targetPrice != null && p.stopPrice != null ? ` → tgt ₹${p.targetPrice.toFixed(0)} / stop ₹${p.stopPrice.toFixed(0)}` : '';
      const deliv = p.deliveryPct != null ? ` · ${p.deliveryPct.toFixed(0)}% deliv` : '';
      return `• *${p.name}* — ${buyStr}${exStr}${deliv}`;
    };
    const msg = [
      `📈 *Artha — Today's picks · ${pickDate}*`,
      multiday.length ? `*2-3 month (ride strength):*\n${multiday.map(line).join('\n')}` : '',
      intraday.length ? `*Intraday (square off same day):*\n${intraday.map(line).join('\n')}` : '',
      `_Exit: hold while Stage 2 (above a rising 200-DMA); exit on target, stop, or when it drops out of Stage 2 (≤2-3 mo). Paper — your call for real._`,
    ].filter(Boolean).join('\n');
    await sendTelegramToUser(userId, msg).catch(() => {});
  }
  return { status: 'COMPLETED', pickDate, considered: candidates.length, picked: picks.length, intraday: intraday.length, multiday: multiday.length };
}

/** Today's picks for a horizon — read by run-swing as candidates. */
export async function getDailyPicks(userId: string, horizon: 'INTRADAY' | 'MULTIDAY'): Promise<Array<{ symbol: string; name: string }>> {
  const rows = await db.select({ symbol: agentDailyPicks.symbol, name: agentDailyPicks.name, horizon: agentDailyPicks.horizon })
    .from(agentDailyPicks)
    .where(and(eq(agentDailyPicks.userId, userId), eq(agentDailyPicks.pickDate, istDate())));
  return rows.filter((r) => r.horizon === horizon).map((r) => ({ symbol: r.symbol, name: r.name }));
}
