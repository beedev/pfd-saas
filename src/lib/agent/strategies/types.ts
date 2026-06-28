/**
 * Strategy abstraction. Each sleeve runs one Strategy over its watchlist; the
 * Strategy returns one intent per instrument (BUY/SELL/HOLD/WATCH) with a fully
 * formed REAL-DATA evidence record attached — so the decision trail is
 * auditable by construction (no mock data). Money in paisa.
 */

import type {
  AgentStrategy,
  AgentAction,
  AgentRecommendation,
  AgentSide,
  AgentSleeve,
  AgentAssetClass,
  AgentSignalsJson,
  AgentDecisionEvidence,
} from '@/db';
import type { InstrumentQuote, PricePoint } from '../market-data';

export interface InstrumentInput {
  watchlistId: number;
  assetClass: AgentAssetClass;
  symbol: string;
  schemeCode: string;
  name: string;
  contractMultiplier: number;
  quote: InstrumentQuote;
  history: PricePoint[];
  source: string; // NSE | YAHOO | AMFI
}

export interface OpenPositionLite {
  id: number;
  assetClass: AgentAssetClass;
  symbol: string;
  schemeCode: string;
  side: AgentSide;
  quantity: number;
  avgPricePaisa: number;
  contractMultiplier: number;
  openedDate: string;
}

export interface SleeveContext {
  sleeve: AgentSleeve;
  cashPaisa: number;
  positions: OpenPositionLite[];
  instruments: InstrumentInput[];
  params: Record<string, number>;
  runDate: string; // IST YYYY-MM-DD
  // v3 enhancements (default risk-on / no throttle when unset):
  regimeRiskOn?: boolean;      // #5 index regime gate (^NSEI > 200DMA)
  peakEquityPaisa?: number;    // #1 for drawdown kill-switch
  currentEquityPaisa?: number; // #1 current sleeve equity (cash + MV)
}

export interface StrategyIntent {
  watchlistId: number;
  assetClass: AgentAssetClass;
  symbol: string;
  schemeCode: string;
  name: string;
  contractMultiplier: number;
  action: AgentAction;
  side: AgentSide;
  score: number;
  recommendation: AgentRecommendation;
  confidence: string;
  quantity: number; // 0 for HOLD/WATCH
  pricePaisa: number;
  amountPaisa: number; // notional of the trade leg (0 for HOLD/WATCH)
  signals: AgentSignalsJson;
  evidence: AgentDecisionEvidence;
}

export interface Strategy {
  key: AgentStrategy;
  run(ctx: SleeveContext): StrategyIntent[];
}

/** Days between two ISO dates (a−b), for time-stop logic. */
export function daysBetween(aIso: string, bIso: string): number {
  const a = Date.parse(aIso + 'T00:00:00Z');
  const b = Date.parse(bIso + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((a - b) / 86_400_000);
}

/** Position lookup key (MF by scheme, else by symbol). */
export function posKey(assetClass: string, symbol: string, schemeCode: string): string {
  return assetClass === 'MF' ? `MF:${schemeCode}` : `${assetClass}:${symbol}`;
}
