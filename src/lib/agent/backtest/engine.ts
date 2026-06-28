/**
 * Backtest engine: replay a sleeve's strategy over historical daily closes,
 * using the SAME Strategy code as live (no divergence). No look-ahead — at each
 * bar the strategy only sees closes up to that date, and fills happen at that
 * close. Indian costs + CG tax are charged on every leg. Money in paisa.
 */

import type { AgentStrategy, AgentSleeve, AgentAssetClass, AgentSide } from '@/db';
import { getStrategy } from '../strategies/registry';
import type { SleeveContext, InstrumentInput, OpenPositionLite } from '../strategies/types';
import { posKey, daysBetween } from '../strategies/types';
import type { PricePoint } from '../market-data';
import { type CostModel, DEFAULT_COST_MODEL, tradeCostPaisa, cgTaxPaisa } from './costs';
import { computeMetrics, type EquityPoint, type BacktestMetrics } from './metrics';

export interface BacktestInstrument {
  assetClass: AgentAssetClass;
  symbol: string;
  schemeCode: string;
  name: string;
  contractMultiplier: number;
  source: string;
  history: PricePoint[]; // ascending by date
}

export interface BacktestInput {
  strategy: AgentStrategy;
  allocationPaisa: number;
  params: Record<string, number>;
  instruments: BacktestInstrument[];
  warmupBars?: number;
  costModel?: CostModel;
}

export interface BacktestOutput {
  metrics: BacktestMetrics;
  equityCurve: EquityPoint[];
}

interface SimPos {
  assetClass: AgentAssetClass; symbol: string; schemeCode: string; name: string;
  side: AgentSide; quantity: number; avgPricePaisa: number; contractMultiplier: number; openedDate: string;
}

export function runBacktest(input: BacktestInput): BacktestOutput {
  const cost = input.costModel ?? DEFAULT_COST_MODEL;
  const strat = getStrategy(input.strategy);
  const warmup = input.warmupBars ?? 260; // enough for 12-1 momentum / 200-SMA

  // Union date axis across instruments.
  const dateSet = new Set<string>();
  for (const inst of input.instruments) for (const p of inst.history) dateSet.add(p.date);
  const axis = Array.from(dateSet).sort();
  if (axis.length <= warmup) return { metrics: emptyMetrics(input.allocationPaisa), equityCurve: [] };

  // Per-instrument pointer into its (ascending) history.
  const ptr = input.instruments.map(() => -1);
  const positions = new Map<string, SimPos>();
  let cash = input.allocationPaisa;
  let buyNotional = 0;
  const closedPnls: number[] = [];
  const curve: EquityPoint[] = [];

  for (let di = 0; di < axis.length; di++) {
    const t = axis[di];
    // Advance pointers to the last bar on/before t.
    input.instruments.forEach((inst, ii) => {
      while (ptr[ii] + 1 < inst.history.length && inst.history[ptr[ii] + 1].date <= t) ptr[ii]++;
    });
    if (di < warmup) continue;

    // Build strategy inputs from history up to t.
    const built: InstrumentInput[] = [];
    const lastClose = new Map<string, number>();
    input.instruments.forEach((inst, ii) => {
      if (ptr[ii] < 0) return;
      const hist = inst.history.slice(0, ptr[ii] + 1);
      const last = hist[hist.length - 1].closePaisa;
      lastClose.set(posKey(inst.assetClass, inst.symbol, inst.schemeCode), last);
      built.push({
        watchlistId: ii, assetClass: inst.assetClass, symbol: inst.symbol, schemeCode: inst.schemeCode,
        name: inst.name, contractMultiplier: inst.contractMultiplier,
        quote: { lastPricePaisa: last, asOf: 0 }, history: hist, source: inst.source,
      });
    });

    const positionsLite: OpenPositionLite[] = Array.from(positions.values()).map((p, idx) => ({
      id: idx, assetClass: p.assetClass, symbol: p.symbol, schemeCode: p.schemeCode,
      side: p.side, quantity: p.quantity, avgPricePaisa: p.avgPricePaisa, contractMultiplier: p.contractMultiplier, openedDate: p.openedDate,
    }));

    const ctx: SleeveContext = {
      sleeve: { allocationPaisa: input.allocationPaisa, cashBalancePaisa: cash } as unknown as AgentSleeve,
      cashPaisa: cash, positions: positionsLite, instruments: built, params: input.params, runDate: t,
    };

    for (const it of strat.run(ctx)) {
      if (it.action !== 'BUY' && it.action !== 'SELL') continue;
      const key = posKey(it.assetClass, it.symbol, it.schemeCode);
      if (it.action === 'BUY') {
        const notional = it.amountPaisa;
        const c = tradeCostPaisa(notional, it.assetClass, false, 0, cost);
        cash -= notional + c;
        buyNotional += notional;
        const ex = positions.get(key);
        if (ex) {
          const nq = ex.quantity + it.quantity;
          ex.avgPricePaisa = Math.round((ex.avgPricePaisa * ex.quantity + it.pricePaisa * it.quantity) / nq);
          ex.quantity = nq;
        } else {
          positions.set(key, { assetClass: it.assetClass, symbol: it.symbol, schemeCode: it.schemeCode, name: it.name, side: it.side, quantity: it.quantity, avgPricePaisa: it.pricePaisa, contractMultiplier: it.contractMultiplier, openedDate: t });
        }
      } else {
        const ex = positions.get(key);
        if (!ex) continue;
        const qty = Math.min(it.quantity, ex.quantity);
        const gross = Math.round(it.pricePaisa * qty * ex.contractMultiplier);
        const holdDays = daysBetween(t, ex.openedDate);
        const c = tradeCostPaisa(gross, it.assetClass, true, holdDays, cost);
        const gain = Math.round((it.pricePaisa - ex.avgPricePaisa) * qty * ex.contractMultiplier);
        const tax = cgTaxPaisa(gain, holdDays, cost);
        cash += gross - c - tax;
        closedPnls.push(gain - c - tax);
        ex.quantity -= qty;
        if (ex.quantity <= 0.0000001) positions.delete(key);
      }
    }

    // Mark to market.
    let posValue = 0;
    for (const [key, p] of positions) {
      const last = lastClose.get(key) ?? p.avgPricePaisa;
      posValue += Math.round(last * p.quantity * p.contractMultiplier);
    }
    curve.push({ date: t, equityPaisa: cash + posValue });
  }

  return { metrics: computeMetrics(curve, closedPnls, buyNotional, 1), equityCurve: curve };
}

function emptyMetrics(start: number): BacktestMetrics {
  return { startEquityPaisa: start, finalEquityPaisa: start, totalReturnPct: 0, cagrPct: 0, sharpe: 0, sortino: 0,
    maxDrawdownPct: 0, calmar: 0, hitRatePct: 0, profitFactor: 0, turnoverPct: 0, trades: 0, psr: 0, trialsCount: 1, bars: 0 };
}
