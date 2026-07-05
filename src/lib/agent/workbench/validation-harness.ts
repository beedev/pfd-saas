/**
 * Validation harness — the statistical battery the strategy review (correctly)
 * asked for beyond a single permutation test:
 *   • regime-specific returns (crash / rally / correction / recovery)
 *   • bootstrap confidence interval on CAGR (a range, not a point estimate)
 *   • Monte-Carlo trade-sequencing (drawdown distribution + probability of a bad
 *     outcome) — same returns, random order
 *
 * Backtests a monthly relative-strength rotation (rank by 12-1 momentum, hold the
 * top-K equal-weight, rebalance monthly) — the validated core of Artha — and runs
 * the analyses on its monthly-return series. Uses Math.random (server lib; fine).
 */

import { loadDaily } from './data';

export interface MonthlyRet { month: string; ret: number }

/** Month-end close series from daily bars (last bar of each YYYY-MM). */
function monthEndCloses(bars: { date: string; close: number }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of bars) m.set(b.date.slice(0, 7), b.close);   // later dates overwrite → month-end
  return m;
}

/** Monthly portfolio returns from a top-K 12-1 momentum rotation over `universe`. */
export async function rotationMonthlyReturns(universe: string[], holdK = 5): Promise<MonthlyRet[]> {
  const series = new Map<string, Map<string, number>>();
  const CONC = 8;
  for (let i = 0; i < universe.length; i += CONC) {
    const batch = universe.slice(i, i + CONC);
    const loaded = await Promise.all(batch.map(async (s) => [s, monthEndCloses(await loadDaily(s, '10y').catch(() => []))] as const));
    for (const [s, mc] of loaded) if (mc.size >= 24) series.set(s, mc);
  }
  const months = [...new Set([...series.values()].flatMap((m) => [...m.keys()]))].sort();
  const out: MonthlyRet[] = [];
  for (let t = 12; t < months.length - 1; t++) {
    const now = months[t], prev = months[t - 1], base = months[t - 12], next = months[t + 1];
    const ranked: { s: string; mom: number }[] = [];
    for (const [s, mc] of series) {
      const cPrev = mc.get(prev), cBase = mc.get(base);
      if (cPrev && cBase && cBase > 0) ranked.push({ s, mom: cPrev / cBase - 1 });
    }
    ranked.sort((a, b) => b.mom - a.mom);
    const held = ranked.filter((x) => x.mom > 0).slice(0, holdK);
    if (!held.length) { out.push({ month: next, ret: 0 }); continue; }
    let sum = 0, n = 0;
    for (const h of held) { const c0 = series.get(h.s)!.get(now), c1 = series.get(h.s)!.get(next); if (c0 && c1 && c0 > 0) { sum += c1 / c0 - 1; n++; } }
    out.push({ month: next, ret: n ? sum / n : 0 });
  }
  return out;
}

const cagr = (rets: number[]) => (rets.length ? Math.pow(rets.reduce((a, r) => a * (1 + r), 1), 12 / rets.length) - 1 : 0);
const maxDrawdown = (rets: number[]) => { let eq = 1, peak = 1, dd = 0; for (const r of rets) { eq *= 1 + r; peak = Math.max(peak, eq); dd = Math.min(dd, eq / peak - 1); } return dd; };

/** Return by market regime (fixed IST period windows). */
export function regimePerformance(rets: MonthlyRet[]) {
  const REGIMES: { name: string; from: string; to: string }[] = [
    { name: 'Pre-COVID 2018-19', from: '2018-01', to: '2020-01' },
    { name: 'COVID crash + rebound 2020', from: '2020-02', to: '2020-12' },
    { name: 'Bull 2021', from: '2021-01', to: '2021-12' },
    { name: 'Correction 2022', from: '2022-01', to: '2022-12' },
    { name: 'Recovery 2023-24', from: '2023-01', to: '2024-12' },
    { name: 'Current 2025-26', from: '2025-01', to: '2026-12' },
  ];
  return REGIMES.map((rg) => {
    const r = rets.filter((x) => x.month >= rg.from && x.month <= rg.to).map((x) => x.ret);
    return { regime: rg.name, months: r.length, cagrPct: +(cagr(r) * 100).toFixed(1), maxDDpct: +(maxDrawdown(r) * 100).toFixed(1) };
  }).filter((x) => x.months > 0);
}

/** Bootstrap 95% CI on CAGR by resampling monthly returns with replacement. */
export function bootstrapCagrCI(rets: MonthlyRet[], iters = 2000) {
  const r = rets.map((x) => x.ret);
  if (r.length < 12) return null;
  const cagrs: number[] = [];
  for (let i = 0; i < iters; i++) {
    const sample = Array.from({ length: r.length }, () => r[Math.floor(Math.random() * r.length)]);
    cagrs.push(cagr(sample));
  }
  cagrs.sort((a, b) => a - b);
  const pct = (p: number) => +(cagrs[Math.floor(p * cagrs.length)] * 100).toFixed(1);
  return { pointPct: +(cagr(r) * 100).toFixed(1), lo95Pct: pct(0.025), medPct: pct(0.5), hi95Pct: pct(0.975) };
}

/** Monte-Carlo trade sequencing: shuffle the return ORDER, observe drawdown + bad outcomes. */
export function monteCarloSequencing(rets: MonthlyRet[], iters = 2000) {
  const r = rets.map((x) => x.ret);
  if (r.length < 12) return null;
  const dds: number[] = [], finals: number[] = [];
  for (let i = 0; i < iters; i++) {
    const shuffled = [...r];
    for (let j = shuffled.length - 1; j > 0; j--) { const k = Math.floor(Math.random() * (j + 1)); [shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]]; }
    dds.push(maxDrawdown(shuffled));
    finals.push(shuffled.reduce((a, x) => a * (1 + x), 1));
  }
  dds.sort((a, b) => a - b);
  const worstDDpct = +(dds[Math.floor(0.05 * dds.length)] * 100).toFixed(1);   // 5th percentile (deep) DD
  const medDDpct = +(dds[Math.floor(0.5 * dds.length)] * 100).toFixed(1);
  const probLoss = +(finals.filter((f) => f < 1).length / finals.length * 100).toFixed(1);
  const probHalfLoss = +(finals.filter((f) => f < 0.5).length / finals.length * 100).toFixed(1);
  return { medMaxDDpct: medDDpct, worst5pctMaxDDpct: worstDDpct, probEndInLossPct: probLoss, probLoseHalfPct: probHalfLoss };
}
