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
import { sendTelegramToUser } from '@/lib/services/telegram';

const MIN_LIQUIDITY_CR = 5;      // drop anything trading < ₹5 cr/day — untradeable
const MAX_CANDIDATES = 25;
const istDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export interface MorningPicksResult { status: 'COMPLETED' | 'SKIPPED'; pickDate: string; considered: number; picked: number; intraday: number; multiday: number }

export async function runMorningPicks(userId: string): Promise<MorningPicksResult> {
  const pickDate = istDate();
  const pf = (await db.select().from(agentPortfolios).where(eq(agentPortfolios.userId, userId)).limit(1))[0];
  if (!pf || !pf.enabled) return { status: 'SKIPPED', pickDate, considered: 0, picked: 0, intraday: 0, multiday: 0 };

  // 1. Candidates: news in-play + directional brief names (.NS), deduped.
  const inPlay = (await getInPlay().catch(() => [])).map((x) => x.symbol);
  const brief = await getBriefBias().catch(() => new Map<string, { bias: string }>());
  const briefNames = [...brief.entries()].filter(([, v]) => v.bias !== 'NEUTRAL').map(([s]) => s);
  const candidates = [...new Set([...briefNames, ...inPlay])].filter((s) => s.endsWith('.NS')).slice(0, MAX_CANDIDATES);
  if (!candidates.length) return { status: 'COMPLETED', pickDate, considered: 0, picked: 0, intraday: 0, multiday: 0 };

  // 2. Liquidity (traded value/day) from live quotes.
  const liq = new Map<string, number>();
  const qs = await getQuotes(candidates).catch(() => []);
  for (const q of qs) if (Number.isFinite(q.regularMarketPrice) && Number.isFinite(q.regularMarketVolume)) liq.set(q.symbol, (q.regularMarketPrice * q.regularMarketVolume) / 1e7);

  // 3. Vet each: character test + liquidity gate → YES only.
  const picks: Array<{ symbol: string; name: string; horizon: 'INTRADAY' | 'MULTIDAY'; recommended: string; report: unknown }> = [];
  for (const sym of candidates) {
    if ((liq.get(sym) ?? 0) < MIN_LIQUIDITY_CR) continue;                 // too thin to trade
    const bars = await loadDaily(sym, '5y').catch(() => []);
    if (bars.length < 250) continue;
    const r = assessStock(sym.replace('.NS', ''), bars);
    if (r.verdict !== 'YES') continue;
    if (r.recommended === 'MEAN_REVERSION' && r.rangeStatus !== 'in-range') continue;   // range broke → skip the dip
    // Split: momentum/trend → hold 2-3 months; reversion → intraday only.
    const horizon: 'INTRADAY' | 'MULTIDAY' = r.recommended === 'MOMENTUM' ? 'MULTIDAY' : 'INTRADAY';
    picks.push({ symbol: sym, name: r.symbol, horizon, recommended: r.recommended, report: r });
  }

  // 4. Persist today's picks (idempotent per user/date/symbol).
  await db.delete(agentDailyPicks).where(and(eq(agentDailyPicks.userId, userId), eq(agentDailyPicks.pickDate, pickDate)));
  if (picks.length) {
    await db.insert(agentDailyPicks).values(picks.map((p) => ({ userId, pickDate, symbol: p.symbol, name: p.name, horizon: p.horizon, source: 'news', recommended: p.recommended, reportJson: p.report })));
  }
  const intraday = picks.filter((p) => p.horizon === 'INTRADAY');
  const multiday = picks.filter((p) => p.horizon === 'MULTIDAY');

  // 5. Signal the user.
  if (picks.length) {
    const line = (p: typeof picks[number]) => `• ${p.name} — ${p.recommended === 'MOMENTUM' ? 'ride' : 'dip'} (₹${(liq.get(p.symbol) ?? 0).toFixed(0)}cr/d)`;
    const msg = [
      `🔎 *Today's picks — ${pickDate}*`,
      multiday.length ? `*2-3 month:*\n${multiday.map(line).join('\n')}` : '',
      intraday.length ? `*Intraday:*\n${intraday.map(line).join('\n')}` : '',
      `_Vetted (character + liquidity). Paper buckets will trade these on a valid entry. Your call for real._`,
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
