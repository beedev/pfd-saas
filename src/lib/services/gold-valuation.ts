/**
 * Shared gold-holding live valuation.
 *
 * Both the gold list page (client-side, off the live banner rate) and the
 * net-worth / retirement aggregations must value a holding the SAME way, or
 * the numbers drift the moment the gold rate moves. This helper is the single
 * source of truth for "what is this row worth right now":
 *
 *   - Non-ETF (PHYSICAL / GOLD_BOND / DIGITAL): grams × today's IBJA 24K rate
 *     × purity factor (via `calculateValue`).
 *   - ETF: units × today's Yahoo unit price. When the live quote is missing,
 *     it preserves the row's stored value so a transient Yahoo failure never
 *     silently zeroes the holding.
 *
 * Pure + synchronous: the caller fetches the IBJA rate once (1-hour cached) and
 * any ETF quotes, then threads them in. Keeps this testable and side-effect
 * free, and lets a route recompute-on-read without persisting.
 */
import { calculateValue, type GoldRate } from './ibja';
import type { GoldPurity } from '@/db';

export interface GoldRowValuation {
  currentRatePerGramPaisa: number;
  currentValuePaisa: number;
  gainLossPaisa: number;
  gainLossPercent: number;
  lastRateUpdate: string | null;
}

/** Minimal row shape the valuation needs — a superset of what the DB row has. */
export interface ValuableGoldRow {
  type: string;
  grams: number | null;
  quantity?: number | null;
  purity: string | null;
  totalInvestment: number | null;
  etfSymbol?: string | null;
  etfUnits?: number | null;
  currentRatePerGram?: number | null;
  currentValue?: number | null;
  lastRateUpdate?: string | null;
}

export function valueGoldRow(
  row: ValuableGoldRow,
  ibjaRate: GoldRate,
  etfUnitPriceRupees?: number | null,
): GoldRowValuation {
  const totalInvestmentPaisa = row.totalInvestment ?? 0;
  let currentRatePerGramPaisa: number;
  let currentValuePaisa: number;
  let lastRateUpdate: string | null;

  if (row.type === 'ETF' && row.etfUnits) {
    if (etfUnitPriceRupees && etfUnitPriceRupees > 0) {
      currentRatePerGramPaisa = Math.round(etfUnitPriceRupees * 100);
      currentValuePaisa = Math.round(row.etfUnits * etfUnitPriceRupees * 100);
      lastRateUpdate = ibjaRate.asOfDate;
    } else {
      // No live quote — keep stored values rather than zeroing the holding.
      currentRatePerGramPaisa = row.currentRatePerGram ?? 0;
      currentValuePaisa = row.currentValue ?? 0;
      lastRateUpdate = row.lastRateUpdate ?? null;
    }
  } else {
    const grams = row.grams ?? row.quantity ?? 0;
    const purity = (row.purity ?? '999') as GoldPurity;
    currentRatePerGramPaisa = Math.round(ibjaRate.ratePerGram24K * 100);
    currentValuePaisa = Math.round(
      calculateValue(grams, purity, ibjaRate.ratePerGram24K) * 100,
    );
    lastRateUpdate = ibjaRate.asOfDate;
  }

  const gainLossPaisa = currentValuePaisa - totalInvestmentPaisa;
  const gainLossPercent =
    totalInvestmentPaisa > 0 ? (gainLossPaisa / totalInvestmentPaisa) * 100 : 0;

  return {
    currentRatePerGramPaisa,
    currentValuePaisa,
    gainLossPaisa,
    gainLossPercent,
    lastRateUpdate,
  };
}
