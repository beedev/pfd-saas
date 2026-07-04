/**
 * Workbench backtest engine — runs a Strategy over one instrument's daily bars
 * (long-only, one position at a time), then pools trades across a universe into
 * honest, net-of-cost metrics. Buy at the signal bar's close; exit at the exit
 * bar's close, or at the ATR stop if the bar's low breaches it. Every trade pays
 * the delivery cost model + STCG — win rate is reported, but EXPECTANCY (mean
 * net return per trade) is the number that says whether it makes money.
 */

import type { DailyBar } from '@/lib/services/yahoo-finance';
import { DEFAULT_COST_MODEL, tradeCostPaisa, cgTaxPaisa } from '../backtest/costs';
import type { Strategy, Params } from './strategy';

const P = (r: number) => Math.round(r * 100);
const WARMUP = 30;

export interface Trade {
  symbol: string; entryIndex: number; exitIndex: number; barsHeld: number;
  entryDate: string; exitDate: string;
  entryPaisa: number; exitPaisa: number; grossRet: number; netRet: number; reason: string;
}

/** Run a strategy over one instrument. Returns the closed trades (net of cost + STCG). */
export function runInstrument(symbol: string, strategy: Strategy, bars: DailyBar[], params: Params): Trade[] {
  const trades: Trade[] = [];
  let pos: { entryIndex: number; entryPaisa: number; stopPaisa: number } | null = null;

  for (let i = WARMUP; i < bars.length; i++) {
    const hist = bars.slice(0, i + 1);
    if (pos) {
      const barsHeld = i - pos.entryIndex;
      let exitPaisa: number | null = null, reason = '';
      if (P(bars[i].low) <= pos.stopPaisa) { exitPaisa = pos.stopPaisa; reason = 'stop'; }  // stop breached intrabar
      else {
        const ex = strategy.exit(hist, params, { entryPaisa: pos.entryPaisa, entryIndex: pos.entryIndex, barsHeld });
        if (ex) { exitPaisa = P(bars[i].close); reason = ex.reason; }
      }
      if (exitPaisa != null) {
        const held = Math.max(1, barsHeld);
        const cost = tradeCostPaisa(exitPaisa, 'STOCK', true, held, DEFAULT_COST_MODEL);
        const tax = cgTaxPaisa(exitPaisa - pos.entryPaisa, held, DEFAULT_COST_MODEL);
        const netRet = (exitPaisa - pos.entryPaisa - cost - tax) / pos.entryPaisa;
        trades.push({ symbol, entryIndex: pos.entryIndex, exitIndex: i, barsHeld: held, entryDate: bars[pos.entryIndex].date, exitDate: bars[i].date, entryPaisa: pos.entryPaisa, exitPaisa, grossRet: exitPaisa / pos.entryPaisa - 1, netRet, reason });
        pos = null;
      }
    } else {
      const en = strategy.entry(hist, params);
      if (en) pos = { entryIndex: i, entryPaisa: P(bars[i].close), stopPaisa: en.stopPaisa };
    }
  }
  return trades;
}

/** Run across a whole universe (symbol → bars) and pool every trade. */
export function runUniverse(strategy: Strategy, barsBySymbol: Map<string, DailyBar[]>, params: Params): Trade[] {
  const all: Trade[] = [];
  for (const [sym, bars] of barsBySymbol) if (bars.length > WARMUP + 5) all.push(...runInstrument(sym, strategy, bars, params));
  return all;
}

export interface Metrics {
  trades: number; winRate: number; expectancy: number; profitFactor: number;
  avgWin: number; avgLoss: number; sharpe: number; medianHold: number; totalNet: number; worstTrade: number;
}

const median = (a: number[]) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Pooled, net-of-cost metrics over a set of trades. */
export function poolMetrics(trades: Trade[]): Metrics {
  const n = trades.length;
  if (!n) return { trades: 0, winRate: 0, expectancy: 0, profitFactor: 0, avgWin: 0, avgLoss: 0, sharpe: 0, medianHold: 0, totalNet: 0, worstTrade: 0 };
  const rets = trades.map((t) => t.netRet);
  const wins = rets.filter((r) => r > 0), losses = rets.filter((r) => r <= 0);
  const mean = rets.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / n) || 1e-9;
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0)) || 1e-9;
  return {
    trades: n,
    winRate: wins.length / n,
    expectancy: mean,
    profitFactor: grossWin / grossLoss,
    avgWin: wins.length ? grossWin / wins.length : 0,
    avgLoss: losses.length ? -grossLoss / losses.length : 0,
    sharpe: mean / sd,                         // per-trade Sharpe
    medianHold: median(trades.map((t) => t.barsHeld)),
    totalNet: rets.reduce((a, b) => a + b, 0),
    worstTrade: Math.min(...rets),
  };
}
