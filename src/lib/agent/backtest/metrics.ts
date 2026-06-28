/**
 * Backtest performance metrics from a daily equity curve + closed-trade P&Ls.
 * Report a panel, never a single number. Includes a Probabilistic Sharpe Ratio
 * (PSR) and trial count as the overfitting guard (deflated-Sharpe building
 * block — full DSR can layer on later). Money in paisa.
 */

export interface EquityPoint { date: string; equityPaisa: number }

export interface BacktestMetrics {
  startEquityPaisa: number;
  finalEquityPaisa: number;
  totalReturnPct: number;
  cagrPct: number;
  sharpe: number;
  sortino: number;
  maxDrawdownPct: number;
  calmar: number;
  hitRatePct: number;
  profitFactor: number;
  turnoverPct: number;
  trades: number;
  psr: number;        // P(true Sharpe > 0), 0-1
  trialsCount: number;
  bars: number;
}

const TRADING_DAYS = 252;

function dailyReturns(curve: EquityPoint[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < curve.length; i++) {
    const prev = curve[i - 1].equityPaisa;
    if (prev > 0) r.push((curve[i].equityPaisa - prev) / prev);
  }
  return r;
}

function mean(a: number[]): number { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0; }
function std(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}

/** Probabilistic Sharpe Ratio vs a benchmark Sharpe of 0 (Bailey/López de Prado). */
function probabilisticSharpe(returns: number[], sharpeDaily: number): number {
  const n = returns.length;
  if (n < 3) return 0;
  const m = mean(returns);
  const sd = std(returns);
  if (sd === 0) return 0;
  const skew = returns.reduce((s, x) => s + ((x - m) / sd) ** 3, 0) / n;
  const kurt = returns.reduce((s, x) => s + ((x - m) / sd) ** 4, 0) / n;
  // SR* = 0. Standard error of Sharpe with skew/kurtosis correction.
  const se = Math.sqrt((1 - skew * sharpeDaily + ((kurt - 1) / 4) * sharpeDaily ** 2) / (n - 1));
  if (se === 0) return 0;
  const z = (sharpeDaily * Math.sqrt(n - 1)) / Math.sqrt(n - 1) / se; // = sharpeDaily/se
  return normalCdf(z);
}

function normalCdf(z: number): number {
  // Abramowitz-Stegun approximation.
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (z > 0) p = 1 - p;
  return p;
}

export function computeMetrics(
  curve: EquityPoint[],
  closedPnls: number[],
  buyNotionalPaisa: number,
  trialsCount = 1,
): BacktestMetrics {
  const start = curve[0]?.equityPaisa ?? 0;
  const final = curve[curve.length - 1]?.equityPaisa ?? start;
  const rets = dailyReturns(curve);
  const sd = std(rets);
  const sharpeDaily = sd > 0 ? mean(rets) / sd : 0;
  const downside = rets.filter((x) => x < 0);
  const dd = std(downside);
  const sortinoDaily = dd > 0 ? mean(rets) / dd : 0;

  // Max drawdown.
  let peak = start;
  let maxDD = 0;
  for (const p of curve) {
    if (p.equityPaisa > peak) peak = p.equityPaisa;
    if (peak > 0) maxDD = Math.max(maxDD, (peak - p.equityPaisa) / peak);
  }

  const years = curve.length > 1 ? curve.length / TRADING_DAYS : 1;
  const cagr = start > 0 && years > 0 ? (Math.pow(final / start, 1 / years) - 1) * 100 : 0;

  const wins = closedPnls.filter((x) => x > 0);
  const losses = closedPnls.filter((x) => x < 0);
  const grossProfit = wins.reduce((s, x) => s + x, 0);
  const grossLoss = Math.abs(losses.reduce((s, x) => s + x, 0));
  const avgEquity = curve.length ? curve.reduce((s, p) => s + p.equityPaisa, 0) / curve.length : start;

  return {
    startEquityPaisa: start,
    finalEquityPaisa: final,
    totalReturnPct: start > 0 ? ((final - start) / start) * 100 : 0,
    cagrPct: cagr,
    sharpe: sharpeDaily * Math.sqrt(TRADING_DAYS),
    sortino: sortinoDaily * Math.sqrt(TRADING_DAYS),
    maxDrawdownPct: maxDD * 100,
    calmar: maxDD > 0 ? cagr / (maxDD * 100) : 0,
    hitRatePct: closedPnls.length ? (wins.length / closedPnls.length) * 100 : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    turnoverPct: avgEquity > 0 ? (buyNotionalPaisa / avgEquity) * 100 : 0,
    trades: closedPnls.length,
    psr: probabilisticSharpe(rets, sharpeDaily),
    trialsCount,
    bars: curve.length,
  };
}
