/**
 * Stock "personality" test — does a name TREND or REVERT, and which strategy
 * actually paid on it? Used to vet candidates (e.g. news-surfaced stocks) before
 * trading them: pick on CHARACTER (a durable cause), not on a cherry-picked
 * backtest. Returns a per-stock report card with a routed strategy + yes/no.
 *
 * Three checks per stock: (1) its personality via return autocorrelation
 * (negative = reverts, positive = trends); (2) did a mean-reversion rule pay on
 * it, net of cost; (3) did a momentum/breakout rule pay. Then route + verdict.
 */

import type { DailyBar } from '@/lib/services/yahoo-finance';
import { rsi, sma } from '../signals/indicators';
import type { Strategy } from './strategy';
import { runInstrument, poolMetrics } from './backtest';
import { computeStage, type Stage } from './stage';

const P = (r: number) => Math.round(r * 100);

/** Lag-1 autocorrelation of daily returns. < 0 = mean-reverting; > 0 = trending. */
function autocorr(closes: number[]): number {
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++) r.push(closes[i] / closes[i - 1] - 1);
  if (r.length < 30) return 0;
  const mu = r.reduce((a, b) => a + b, 0) / r.length;
  let num = 0, den = 0;
  for (let i = 1; i < r.length; i++) num += (r[i] - mu) * (r[i - 1] - mu);
  for (const x of r) den += (x - mu) ** 2;
  return den ? num / den : 0;
}

// Mean-reversion probe: RSI-2 oversold in an uptrend → exit on recovery. No tight stop.
const reversionProbe: Strategy = {
  meta: { id: 'rev', name: 'reversion', description: '', horizon: 'SWING', universe: 'NIFTY_500', params: [{ key: 'maxHold', label: '', min: 3, max: 10, step: 1, default: 5 }] },
  entry(bars) { if (bars.length < 210) return null; const c = bars.map((b) => b.close); const r = rsi(c, 2), s = sma(c, 200); if (r == null || s == null || !(c[c.length - 1] > s) || !(r < 10)) return null; return { stopPaisa: P(c[c.length - 1] * 0.8), targetPaisa: null, note: 'rsi<10' }; },
  exit(bars, p, pos) { const c = bars.map((b) => b.close); const r = rsi(c, 2), s5 = sma(c, 5); if (r != null && r > 70) return { reason: 'rsi up' }; if (s5 != null && c[c.length - 1] > s5) return { reason: '>5sma' }; if (pos.barsHeld >= Math.round(p.maxHold)) return { reason: 'maxhold' }; return null; },
};

// Momentum probe: break to a 50-day high in an uptrend → exit below the 20-SMA.
const momentumProbe: Strategy = {
  meta: { id: 'mom', name: 'momentum', description: '', horizon: 'SWING', universe: 'NIFTY_500', params: [{ key: 'maxHold', label: '', min: 20, max: 90, step: 10, default: 40 }] },
  entry(bars) { if (bars.length < 210) return null; const c = bars.map((b) => b.close); const s200 = sma(c, 200); const hi = Math.max(...bars.slice(-51, -1).map((b) => b.high)); const px = c[c.length - 1]; if (s200 == null || !(px > s200) || !(px > hi)) return null; return { stopPaisa: P(px * 0.9), targetPaisa: null, note: '50d high' }; },
  exit(bars, p, pos) { const c = bars.map((b) => b.close); const s20 = sma(c, 20); if (s20 != null && c[c.length - 1] < s20) return { reason: '<20sma' }; if (pos.barsHeld >= Math.round(p.maxHold)) return { reason: 'maxhold' }; return null; },
};

function probe(strat: Strategy, bars: DailyBar[]): { netPct: number; winRate: number; trades: number } {
  const t = runInstrument('x', strat, bars, { maxHold: strat.meta.params[0].default });
  const m = poolMetrics(t);
  return { netPct: m.totalNet * 100, winRate: m.winRate * 100, trades: m.trades };
}

export interface CharacterReport {
  symbol: string;
  character: 'REVERTS' | 'TRENDS' | 'NEUTRAL';
  autocorr: number;
  reversion: { netPct: number; winRate: number; trades: number };
  momentum: { netPct: number; winRate: number; trades: number };
  rangeStatus: 'in-range' | 'broke-up' | 'broke-down';
  stage: Stage;                    // current Weinstein stage — the buy-now gate (STAGE2 = advancing)
  recommended: 'MEAN_REVERSION' | 'MOMENTUM' | 'AVOID';
  verdict: 'YES' | 'NO';
  note: string;
}

export function assessStock(symbol: string, bars: DailyBar[]): CharacterReport {
  const clean = bars.filter((b) => b.close > 0);
  const closes = clean.map((b) => b.close);
  const ac = autocorr(closes);
  const character = ac < -0.03 ? 'REVERTS' : ac > 0.03 ? 'TRENDS' : 'NEUTRAL';
  const reversion = probe(reversionProbe, clean);
  const momentum = probe(momentumProbe, clean);

  // range status: is the last close breaking a recent (120d) high/low band?
  const win = clean.slice(-120);
  const hi = Math.max(...win.map((b) => b.high)), lo = Math.min(...win.map((b) => b.low));
  const px = closes[closes.length - 1];
  const rangeStatus = px >= hi * 0.995 ? 'broke-up' : px <= lo * 1.005 ? 'broke-down' : 'in-range';
  const stage = computeStage(closes);   // current-trend gate — trending CHARACTER ≠ advancing NOW

  // route: prefer the strategy that BOTH matches character AND paid ≥ a small hurdle.
  const revOk = reversion.trades >= 8 && reversion.netPct > 2;
  const momOk = momentum.trades >= 5 && momentum.netPct > 5;
  let recommended: CharacterReport['recommended'] = 'AVOID';
  if (character === 'REVERTS' && revOk) recommended = 'MEAN_REVERSION';
  else if (character === 'TRENDS' && momOk) recommended = 'MOMENTUM';
  else if (revOk && !momOk) recommended = 'MEAN_REVERSION';
  else if (momOk && !revOk) recommended = 'MOMENTUM';
  else if (momOk && revOk) recommended = momentum.netPct >= reversion.netPct ? 'MOMENTUM' : 'MEAN_REVERSION';

  const verdict = recommended === 'AVOID' ? 'NO' : 'YES';
  // A momentum name that isn't Stage 2 NOW (basing / topping / declining) trends by
  // character but is not a buy today — flag it so the buy paths can hold off.
  const stageWarn = recommended === 'MOMENTUM' && stage !== 'STAGE2'
    ? ` ⚠ ${stage} now (not advancing) — wait for Stage 2.` : '';
  const note = recommended === 'MEAN_REVERSION'
    ? `Reverting name — buy dips paid (+${reversion.netPct.toFixed(0)}% over history).${rangeStatus !== 'in-range' ? ' ⚠ range broke — pause.' : ''}`
    : recommended === 'MOMENTUM'
      ? `Trending name — ride strength (+${momentum.netPct.toFixed(0)}% over history).${stageWarn}`
      : `Neither rule paid net of cost — skip.`;
  return { symbol, character, autocorr: +ac.toFixed(3), reversion, momentum, rangeStatus, stage, recommended, verdict, note };
}
