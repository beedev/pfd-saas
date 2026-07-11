/**
 * Price-scan intraday strategies — pure entry-signal functions over a symbol's
 * session bars. The shared runner (run-intraday-scan.ts) handles sizing, exits
 * (via the stored ATR stop/target), square-off, and persistence. Prices in the
 * bars are native rupees; entries are returned in paisa. Two strategies:
 *   • VWAP reversion — fade a stretch from VWAP that's turning back toward it.
 *   • Gap-and-go     — ride an opening gap that follows through on volume.
 */

import type { IntradayBar } from '@/lib/services/yahoo-finance';
import type { AgentDecisionEvidence, AgentSide, AgentStrategy } from '@/db';
import { atr, vwap } from '../signals/indicators';
import { OR_END, LAST_ENTRY } from '../engine/orb-step';

export interface ScanInput {
  bars: IntradayBar[];          // session bars (rupees), ascending
  prevClosePaisa?: number;      // yesterday's close (for gap)
  nowIstMin: number;
  params: Record<string, number>;
}
export interface IntradayEntry {
  side: AgentSide; entryPaisa: number; stopPaisa: number; targetPaisa: number;
  rule: string; evidence: AgentDecisionEvidence;
}
export interface ScanStrategy {
  strategy: AgentStrategy;
  defaults: Record<string, number>;
  entry(input: ScanInput): IntradayEntry | null;
}

const P = (rupees: number) => Math.round(rupees * 100);

// ---- VWAP reversion --------------------------------------------------------
export const vwapReversion: ScanStrategy = {
  strategy: 'VWAP_REVERSION',
  defaults: { atrPeriod: 14, stretchMult: 1.5, stopAtr: 1.0, riskPctPerTrade: 0.75, maxConcurrent: 5 },
  entry({ bars, params }) {
    if (bars.length < (params.atrPeriod ?? 14) + 2) return null;
    const vw = vwap(bars);
    const a = atr(bars, params.atrPeriod ?? 14);
    if (vw == null || a == null || a <= 0) return null;
    const last = bars[bars.length - 1], prev = bars[bars.length - 2];
    const px = last.close;
    const stretch = px - vw;                       // rupees from VWAP
    const stretchMult = params.stretchMult ?? 1.5, stopAtr = params.stopAtr ?? 1.0;
    // Below VWAP by ≥ stretchMult·ATR and turning up → long back toward VWAP.
    if (stretch <= -stretchMult * a && last.close > prev.close) {
      return mk('LONG', px, px - stopAtr * a, vw, `VWAP reversion long: ${(stretch).toFixed(2)} below VWAP (≥${stretchMult}×ATR), turning up`, vw, a);
    }
    if (stretch >= stretchMult * a && last.close < prev.close) {
      return mk('SHORT', px, px + stopAtr * a, vw, `VWAP reversion short: ${(stretch).toFixed(2)} above VWAP (≥${stretchMult}×ATR), turning down`, vw, a);
    }
    return null;
  },
};

function mk(side: AgentSide, entry: number, stop: number, target: number, rule: string, vw: number, a: number): IntradayEntry | null {
  if ((side === 'LONG' && stop >= entry) || (side === 'SHORT' && stop <= entry)) return null;
  return {
    side, entryPaisa: P(entry), stopPaisa: P(stop), targetPaisa: P(target), rule,
    evidence: { rule, inputs: { entry: +entry.toFixed(2), vwap: +vw.toFixed(2), atr: +a.toFixed(2) }, thresholds: { stopPaisa: P(stop), targetPaisa: P(target) }, source: 'YAHOO' },
  };
}

// ---- Gap-and-go ------------------------------------------------------------
export const gapAndGo: ScanStrategy = {
  strategy: 'GAP_AND_GO',
  defaults: { gapPct: 2, atrPeriod: 14, stopAtr: 1.0, targetAtr: 2.0, volMult: 1.5, riskPctPerTrade: 0.75, maxConcurrent: 5 },
  entry({ bars, prevClosePaisa, params }) {
    if (!prevClosePaisa || bars.length < (params.atrPeriod ?? 14) + 2) return null;
    const prevClose = prevClosePaisa / 100;
    const a = atr(bars, params.atrPeriod ?? 14);
    if (a == null || a <= 0 || prevClose <= 0) return null;
    const open = bars[0].open, last = bars[bars.length - 1], px = last.close;
    const gapPct = ((open - prevClose) / prevClose) * 100;
    const minGap = params.gapPct ?? 2, stopAtr = params.stopAtr ?? 1.0, targetAtr = params.targetAtr ?? 2.0, volMult = params.volMult ?? 1.5;
    // Volume confirmation: last bar's volume vs session average.
    const vols = bars.map((b) => b.volume ?? 0);
    const avgVol = vols.reduce((s, v) => s + v, 0) / Math.max(1, vols.length);
    const volOk = avgVol <= 0 || (last.volume ?? 0) >= volMult * avgVol;
    // Follow-through = the gap is still held (px on the gap side of the open) AND
    // price is still pushing that way (last close beyond the prior bar's close).
    const prev = bars[bars.length - 2].close;
    if (gapPct >= minGap && px >= open && last.close > prev && volOk) {
      return mkGap('LONG', px, px - stopAtr * a, px + targetAtr * a, `Gap-and-go long: +${gapPct.toFixed(1)}% gap, follow-through on volume`, gapPct, a);
    }
    if (gapPct <= -minGap && px <= open && last.close < prev && volOk) {
      return mkGap('SHORT', px, px + stopAtr * a, px - targetAtr * a, `Gap-and-go short: ${gapPct.toFixed(1)}% gap, follow-through on volume`, gapPct, a);
    }
    return null;
  },
};

function mkGap(side: AgentSide, entry: number, stop: number, target: number, rule: string, gapPct: number, a: number): IntradayEntry | null {
  if ((side === 'LONG' && stop >= entry) || (side === 'SHORT' && stop <= entry)) return null;
  return {
    side, entryPaisa: P(entry), stopPaisa: P(stop), targetPaisa: P(target), rule,
    evidence: { rule, inputs: { entry: +entry.toFixed(2), gapPct: +gapPct.toFixed(2), atr: +a.toFixed(2) }, thresholds: { stopPaisa: P(stop), targetPaisa: P(target) }, source: 'YAHOO' },
  };
}

// ---- Pullback-buy (LONG-ONLY) ---------------------------------------------
// The evidence-backed replacement for VWAP/ORB: don't fade, don't chase — buy a
// name showing intraday STRENGTH (led above VWAP) that PULLS BACK to VWAP and then
// RECLAIMS it (a reversal trigger, not a falling knife), with a ≥2:1 target. This is
// what our only intraday winner (My-Picks: CEMPRO, ASTERDM) actually did; it fixes
// ORB's inverted reward:risk (winners < losers) and never shorts.
export const pullbackLong: ScanStrategy = {
  strategy: 'PULLBACK_LONG',
  defaults: { atrPeriod: 14, rewardRisk: 2.0, minStrengthPct: 0.4, maxStopAtr: 2.5, riskPctPerTrade: 0.75, maxConcurrent: 3 },
  entry({ bars, nowIstMin, params }) {
    const atrPeriod = params.atrPeriod ?? 14;
    if (bars.length < atrPeriod + 4) return null;
    // Fresh entries only mid-session: after VWAP has formed, before the last-entry cutoff.
    if (nowIstMin < OR_END || nowIstMin >= LAST_ENTRY) return null;
    const vw = vwap(bars);
    const a = atr(bars, atrPeriod);
    if (vw == null || a == null || a <= 0) return null;
    const last = bars[bars.length - 1], prev = bars[bars.length - 2];
    const px = last.close;
    // STRENGTH — the name led earlier: session high meaningfully above VWAP.
    const sessHigh = Math.max(...bars.map((b) => b.high));
    const wasStrong = sessHigh >= vw * (1 + (params.minStrengthPct ?? 0.4) / 100);
    // PULLBACK — dipped to/below VWAP in the last few bars.
    const recent = bars.slice(-6);
    const dipped = recent.some((b) => b.low <= vw);
    // RECLAIM (the trigger) — now back above VWAP on an up bar; the prior bar was still at/below.
    const reclaim = px > vw && last.close > prev.close && prev.close <= vw * 1.001;
    if (!(wasStrong && dipped && reclaim)) return null;
    // Stop just under the pullback swing low; target ≥2:1 off that risk.
    const pullbackLow = Math.min(...recent.map((b) => b.low));
    const stop = pullbackLow - 0.05 * a;
    const risk = px - stop;
    if (risk <= 0 || risk > (params.maxStopAtr ?? 2.5) * a) return null;   // skip deep/dirty pullbacks
    const target = px + (params.rewardRisk ?? 2.0) * risk;
    const rule = `Pullback-buy: led +${(((sessHigh / vw) - 1) * 100).toFixed(1)}% then reclaimed VWAP off a dip (2:1)`;
    return {
      side: 'LONG', entryPaisa: P(px), stopPaisa: P(stop), targetPaisa: P(target), rule,
      evidence: { rule, inputs: { entry: +px.toFixed(2), vwap: +vw.toFixed(2), atr: +a.toFixed(2), pullbackLow: +pullbackLow.toFixed(2), sessHigh: +sessHigh.toFixed(2) }, thresholds: { stopPaisa: P(stop), targetPaisa: P(target) }, source: 'YAHOO' },
    };
  },
};

export const SCAN_STRATEGIES: Record<string, ScanStrategy> = {
  VWAP_REVERSION: vwapReversion,
  GAP_AND_GO: gapAndGo,
  PULLBACK_LONG: pullbackLong,
};
