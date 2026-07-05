/**
 * Morning picks pipeline — runs ~7:30 IST with the pre-market brief. Gathers the
 * day's candidate stocks (news in-play + brief), VETS each through the character
 * test + a liquidity gate, splits them into INTRADAY vs 2-3 MONTH, stores them as
 * the day's picks, and signals the user on Telegram. run-swing then trades these
 * picks during the session (STK_WATCH intraday / STK_SHORT 2-3mo). Paper only.
 */

import { and, eq } from 'drizzle-orm';
import { db, agentDailyPicks, agentPortfolios, agentRunHealth } from '@/db';
import { getQuotes } from '@/lib/services/yahoo-finance';
import { loadDaily } from '@/lib/agent/workbench/data';
import { assessStock } from '@/lib/agent/workbench/character';
import { getInPlay } from '@/lib/agent/news/ingest';
import { getBriefBias } from '@/lib/agent/news/brief';
import { getAnnouncementSymbols } from '@/lib/agent/news/announcements';
import { getBhavcopy } from '@/lib/agent/providers/nse-bhavcopy';
import { backfillDeliveryHistory, getMarketNorms, deliverySpike, relativeVolume } from '@/lib/agent/providers/delivery-history';
import { screenRsStage, atrStopFrac } from '@/lib/agent/engine/rs-stage-screen';
import { resolveUniverse } from '@/lib/agent/workbench/universes';
import { sectorOf, sectorStrengthScores } from '@/lib/agent/workbench/sectors';
import { sendTelegramToUser } from '@/lib/services/telegram';

const MIN_LIQUIDITY_CR = 5;      // hard gate: untradeable below ₹5 cr/day
const DELIV_FLOOR = 25;          // hard gate: kill pure intraday froth (delivery < 25%)
const MAX_CANDIDATES = 40;
const MAX_MULTIDAY = 15;         // top-scored 2-3mo picks per day
const MAX_PER_SECTOR = 3;        // concentration cap — momentum clusters, but don't over-bet one sector
const MAX_INTRADAY = 5;
const ret6mo = (closes: number[]) => (closes.length < 127 ? 0 : closes[closes.length - 1] / closes[closes.length - 127] - 1);
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

  // 1. Candidates: news + brief + whole-spectrum NSE announcements + RS/Stage-2 screen.
  const inPlay = (await getInPlay().catch(() => [])).map((x) => x.symbol);
  const brief = await getBriefBias().catch(() => new Map<string, { bias: string }>());
  const briefNames = [...brief.entries()].filter(([, v]) => v.bias !== 'NEUTRAL').map(([s]) => s);
  const announced = await getAnnouncementSymbols(40).catch(() => []);
  const announcedSet = new Set(announced);
  const screen = await screenRsStage(resolveUniverse('NIFTY_500').slice(0, 150), '^NSEI', 20).catch(() => []);
  const screenSet = new Set(screen.map((s) => s.symbol));
  const candidates = [...new Set([...briefNames, ...inPlay, ...announced, ...screen.map((s) => s.symbol)])].filter((s) => s.endsWith('.NS')).slice(0, MAX_CANDIDATES + screen.length);
  if (!candidates.length) return { status: 'COMPLETED', pickDate, considered: 0, picked: 0, intraday: 0, multiday: 0 };

  // 2. Market data: liquidity + delivery + volume + price + 20-day norms.
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
  const volOf = (sym: string): number | null => bhav.get(sym.replace('.NS', ''))?.volume ?? null;
  const priceOf = (sym: string): number | null => yPrice.get(sym) ?? bhav.get(sym.replace('.NS', ''))?.close ?? null;
  await backfillDeliveryHistory(20).catch(() => {});
  const norms = await getMarketNorms().catch(() => new Map());
  const normOf = (sym: string) => norms.get(sym.replace('.NS', ''));
  const idx = await loadDaily('^NSEI', '1y').catch(() => []);
  const idxRet = ret6mo(idx.map((b) => b.close));

  // 3. Gate + collect factors. MANDATORY gates: liquidity + Stage 2 + delivery floor.
  //    Everything else (RS, delivery-spike, relative-volume, sector) becomes a SCORE,
  //    per the review — no single soft signal can veto a genuine leader.
  interface Scored { sym: string; name: string; rsExcess: number; spikeRatio: number | null; relVol: number | null; deliv: number | null; buy: number | null; atrFrac: number; source: string; sector: string; score: number }
  const momentum: Scored[] = [];
  const reversion: Array<{ sym: string; name: string; deliv: number | null; buy: number | null }> = [];
  for (const sym of candidates) {
    if (liqOf(sym) < MIN_LIQUIDITY_CR) continue;                          // hard gate: tradeability
    const bars = await loadDaily(sym, '5y').catch(() => []);
    if (bars.length < 250) continue;
    const r = assessStock(sym.replace('.NS', ''), bars);
    const deliv = delivOf(sym);
    if (r.recommended === 'MEAN_REVERSION' && r.rangeStatus === 'in-range') {   // intraday dip path (separate)
      reversion.push({ sym, name: r.symbol, deliv, buy: priceOf(sym) });
      continue;
    }
    if (r.stage !== 'STAGE2') continue;                                  // hard gate: must be advancing
    if (deliv != null && deliv < DELIV_FLOOR) continue;                  // hard gate: kill pure froth
    momentum.push({
      sym, name: r.symbol,
      rsExcess: ret6mo(bars.map((b) => b.close)) - idxRet,
      spikeRatio: deliverySpike(deliv, normOf(sym)).ratio,
      relVol: relativeVolume(volOf(sym), normOf(sym)),
      deliv, buy: priceOf(sym), atrFrac: atrStopFrac(bars.map((b) => ({ high: b.high, low: b.low, close: b.close }))),
      source: screenSet.has(sym) ? 'screen' : announcedSet.has(sym) ? 'announcement' : 'news',
      sector: sectorOf(sym), score: 0,
    });
  }

  // 4. Score: RS 40% + delivery-spike 20% + relative-volume 20% + sector-strength 20%.
  //    Percentile ranks within today's set; missing factor → neutral 0.5.
  const sectorScores = sectorStrengthScores(momentum.map((m) => m.sym));
  const rankOf = (vals: (number | null)[]) => { const s = vals.filter((v): v is number => v != null).sort((a, b) => a - b); return (v: number | null) => (v == null || !s.length ? 0.5 : s.filter((x) => x <= v).length / s.length); };
  const rRs = rankOf(momentum.map((m) => m.rsExcess));
  const rSpike = rankOf(momentum.map((m) => m.spikeRatio));
  const rVol = rankOf(momentum.map((m) => m.relVol));
  for (const m of momentum) m.score = +(0.40 * rRs(m.rsExcess) + 0.20 * rSpike(m.spikeRatio) + 0.20 * rVol(m.relVol) + 0.20 * (sectorScores.get(m.sym) ?? 0.5)).toFixed(3);
  momentum.sort((a, b) => b.score - a.score);

  // 5. Sector cap + top N.
  const secCount = new Map<string, number>();
  const chosen: Scored[] = [];
  for (const m of momentum) {
    if (chosen.length >= MAX_MULTIDAY) break;
    if (m.sector !== 'OTHER' && (secCount.get(m.sector) ?? 0) >= MAX_PER_SECTOR) continue;
    secCount.set(m.sector, (secCount.get(m.sector) ?? 0) + 1);
    chosen.push(m);
  }

  // 6. Build picks — scored 2-3mo momentum + intraday reversion.
  const picks: Array<{ symbol: string; name: string; horizon: 'INTRADAY' | 'MULTIDAY'; recommended: string; score: number | null; deliveryPct: number | null; deliverySpikeRatio: number | null; suggestedBuy: number | null; targetPrice: number | null; stopPrice: number | null; source: string; report: unknown }> = [];
  for (const m of chosen) {
    const ex = m.buy ? exitLevels(m.buy, 'MULTIDAY', m.atrFrac) : null;
    const rsPct = +(m.rsExcess * 100).toFixed(1);
    picks.push({ symbol: m.sym, name: m.name, horizon: 'MULTIDAY', recommended: 'MOMENTUM', score: m.score, deliveryPct: m.deliv, deliverySpikeRatio: m.spikeRatio, suggestedBuy: m.buy, targetPrice: ex?.target ?? null, stopPrice: ex?.stop ?? null, source: m.source,
      report: { stage: 'STAGE2', recommended: 'MOMENTUM', source: m.source, score: m.score, rsExcess: rsPct, deliverySpikeRatio: m.spikeRatio, relVolume: m.relVol, sector: m.sector, deliveryPct: m.deliv, liquidityCr: liqOf(m.sym), suggestedBuy: m.buy, targetPrice: ex?.target ?? null, stopPrice: ex?.stop ?? null, note: `Score ${(m.score * 100).toFixed(0)} · RS +${rsPct.toFixed(0)}% · ${m.sector}${m.relVol ? ` · ${m.relVol.toFixed(1)}× vol` : ''}` } });
  }
  for (const rv of reversion.slice(0, MAX_INTRADAY)) {
    const ex = rv.buy ? exitLevels(rv.buy, 'INTRADAY') : null;
    picks.push({ symbol: rv.sym, name: rv.name, horizon: 'INTRADAY', recommended: 'MEAN_REVERSION', score: null, deliveryPct: rv.deliv, deliverySpikeRatio: null, suggestedBuy: rv.buy, targetPrice: ex?.target ?? null, stopPrice: ex?.stop ?? null, source: 'news',
      report: { recommended: 'MEAN_REVERSION', deliveryPct: rv.deliv, suggestedBuy: rv.buy, targetPrice: ex?.target ?? null, stopPrice: ex?.stop ?? null, note: 'Intraday dip — reverting name, in range.' } });
  }

  // 7. Persist today's picks (idempotent per user/date/symbol).
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
      const deliv = p.deliveryPct != null ? ` · ${p.deliveryPct.toFixed(0)}% deliv${p.deliverySpikeRatio ? ` (${p.deliverySpikeRatio.toFixed(1)}×)` : ''}` : '';
      const scoreStr = p.score != null ? ` \`${(p.score * 100).toFixed(0)}\`` : '';
      return `• *${p.name}*${scoreStr} — ${buyStr}${exStr}${deliv}`;
    };
    const msg = [
      `📈 *Artha — Today's picks · ${pickDate}*`,
      multiday.length ? `*2-3 month (ride strength):*\n${multiday.map(line).join('\n')}` : '',
      intraday.length ? `*Intraday (square off same day):*\n${intraday.map(line).join('\n')}` : '',
      `_Exit: hold while Stage 2 (above a rising 200-DMA); exit on target, stop, or when it drops out of Stage 2 (≤2-3 mo). Paper — your call for real._`,
    ].filter(Boolean).join('\n');
    await sendTelegramToUser(userId, msg).catch(() => {});
  }

  // 8. Run-health + heartbeat — recorded EVERY day, sent even on 0 picks, so a
  //    silent data failure can't masquerade as a genuine no-signal day.
  const bhavRows = (bhav as Map<string, unknown>).size ?? 0;
  const quotesOk = qs.length > 0;
  const status = picks.length ? 'OK' : (bhavRows === 0 && screen.length === 0 && !quotesOk) ? 'DATA_GAP' : 'NO_SIGNAL';
  const note = status === 'DATA_GAP' ? 'Yahoo/NSE unavailable' : status === 'NO_SIGNAL' ? 'no qualifying leaders' : '';
  await db.insert(agentRunHealth).values({ userId, runDate: pickDate, status, considered: candidates.length, picked: picks.length, bhavRows, screenCount: screen.length, announcementCount: announced.length, quotesOk, note })
    .onConflictDoUpdate({ target: [agentRunHealth.userId, agentRunHealth.runDate], set: { status, considered: candidates.length, picked: picks.length, bhavRows, screenCount: screen.length, announcementCount: announced.length, quotesOk, note } }).catch(() => {});
  if (!picks.length) {
    const hb = status === 'DATA_GAP'
      ? `⚠️ *Artha ${pickDate}* — data gap this morning (Yahoo/NSE unavailable). No picks: this is a DATA GAP, *not* a no-signal day.`
      : `ℹ️ *Artha ${pickDate}* — ran OK: ${candidates.length} candidates, 0 qualified (soft market / no leaders). No trades today.`;
    await sendTelegramToUser(userId, hb).catch(() => {});
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
