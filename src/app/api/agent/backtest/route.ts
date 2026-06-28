/**
 * POST /api/agent/backtest { sleeveId } — backtest a sleeve's strategy over
 *   ~5y of history (same Strategy code as live), with the Indian cost model.
 * GET  /api/agent/backtest — recent stored backtests for the user.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { db, agentSleeves, agentWatchlist, agentBacktests } from '@/db';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';
import { getInstrumentHistory, type InstrumentRef } from '@/lib/agent/market-data';
import { getDailyCloses } from '@/lib/services/yahoo-finance';
import { runBacktest, type BacktestInstrument } from '@/lib/agent/backtest/engine';
import { DEFAULT_COST_MODEL } from '@/lib/agent/backtest/costs';

/** Downsample an equity curve to ~400 points for storage/UI. */
function downsample<T>(arr: T[], max = 400): T[] {
  if (arr.length <= max) return arr;
  const step = Math.ceil(arr.length / max);
  const out: T[] = [];
  for (let i = 0; i < arr.length; i += step) out.push(arr[i]);
  if (out[out.length - 1] !== arr[arr.length - 1]) out.push(arr[arr.length - 1]);
  return out;
}

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  const rows = await db.select().from(agentBacktests).where(eq(agentBacktests.userId, userId)).orderBy(desc(agentBacktests.id)).limit(20);
  return NextResponse.json({ backtests: rows });
}

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const body = await request.json();
    const sleeveId = Number(body.sleeveId);
    if (!Number.isFinite(sleeveId)) return NextResponse.json({ error: 'sleeveId required' }, { status: 400 });

    const sleeve = (await db.select().from(agentSleeves).where(and(eq(agentSleeves.id, sleeveId), eq(agentSleeves.userId, userId))).limit(1))[0];
    if (!sleeve) return NextResponse.json({ error: 'sleeve not found' }, { status: 404 });

    const wl = await db.select().from(agentWatchlist).where(and(eq(agentWatchlist.userId, userId), eq(agentWatchlist.sleeveId, sleeveId)));
    if (!wl.length) return NextResponse.json({ error: 'no instruments in this sleeve' }, { status: 400 });

    // Pull ~5y history per instrument.
    const instruments: BacktestInstrument[] = [];
    for (const w of wl) {
      const ref: InstrumentRef = { assetClass: w.assetClass, symbol: w.symbol || undefined, schemeCode: w.schemeCode || undefined, isin: w.isin || undefined, contractMultiplier: w.contractMultiplier };
      const history = await getInstrumentHistory(ref, '5y');
      if (history.length < 60) continue;
      instruments.push({ assetClass: w.assetClass, symbol: w.symbol, schemeCode: w.schemeCode, name: w.name, contractMultiplier: w.contractMultiplier, source: w.assetClass === 'MF' ? 'AMFI' : 'YAHOO', history });
    }
    if (!instruments.length) return NextResponse.json({ error: 'no usable history' }, { status: 400 });

    // Guard against history-alignment artifacts: drop instruments whose data has
    // gone STALE (defunct/old scheme codes that stop mid-window — their frozen
    // price corrupts the replay), then cap everyone to a recent aligned window so
    // funds are comparable and a single 2007-era series can't span 19 years.
    const lastOf = (i: BacktestInstrument) => i.history[i.history.length - 1].date;
    const globalLast = instruments.map(lastOf).sort().at(-1)!;
    const gl = new Date(globalLast + 'T00:00:00Z');
    const staleCutoff = new Date(gl); staleCutoff.setUTCDate(staleCutoff.getUTCDate() - 45);
    const minDate = new Date(gl); minDate.setUTCFullYear(minDate.getUTCFullYear() - 8);
    const staleISO = staleCutoff.toISOString().slice(0, 10);
    const minISO = minDate.toISOString().slice(0, 10);
    const aligned = instruments
      .filter((i) => lastOf(i) >= staleISO)                                  // drop defunct codes
      .map((i) => ({ ...i, history: i.history.filter((p) => p.date >= minISO) })) // cap to ~8y window
      .filter((i) => i.history.length >= 60);
    if (!aligned.length) return NextResponse.json({ error: 'no usable history after alignment' }, { status: 400 });
    instruments.length = 0;
    instruments.push(...aligned);

    // #5 regime series: Nifty 50 above its trailing 200-DMA = risk-on (per date, no look-ahead).
    const regimeRiskOnByDate = new Map<string, boolean>();
    try {
      const idx = await getDailyCloses('^NSEI', '5y');
      const c = idx.map((x) => x.close);
      for (let i = 0; i < idx.length; i++) {
        const s200 = i >= 199 ? c.slice(i - 199, i + 1).reduce((a, b) => a + b, 0) / 200 : null;
        regimeRiskOnByDate.set(idx[i].date, s200 == null || c[i] > s200);
      }
    } catch { /* leave empty → engine defaults risk-on */ }

    const result = runBacktest({
      strategy: sleeve.strategy,
      allocationPaisa: sleeve.allocationPaisa,
      params: (sleeve.paramsJson as Record<string, number>) ?? {},
      instruments,
      regimeRiskOnByDate,
    });

    const curve = downsample(result.equityCurve);
    const fromDate = result.equityCurve[0]?.date;
    const toDate = result.equityCurve[result.equityCurve.length - 1]?.date;
    const [saved] = await db.insert(agentBacktests).values({
      userId, portfolioId: sleeve.portfolioId, sleeveId: sleeve.id, strategy: sleeve.strategy,
      label: sleeve.name, fromDate, toDate,
      paramsJson: (sleeve.paramsJson as Record<string, number>) ?? {},
      universeJson: instruments.map((i) => i.symbol || i.schemeCode),
      costModelJson: DEFAULT_COST_MODEL as unknown as Record<string, number>,
      metricsJson: result.metrics as unknown as Record<string, number>,
      equityCurveJson: curve,
    }).returning();

    return NextResponse.json({ backtest: saved });
  } catch (err) {
    console.error('POST agent/backtest:', err);
    return NextResponse.json({ error: 'Backtest failed' }, { status: 500 });
  }
}
