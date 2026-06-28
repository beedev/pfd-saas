'use client';

/**
 * Backtest — run each sleeve's strategy over ~5y of history with honest Indian
 * costs, and show the metrics panel + equity curve. This is the "does it have
 * an edge net of costs" view.
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';

import { Button, Card, CardHeader, CardContent, Badge } from '@dxp/ui';
import { ArrowLeft, Play, Loader2, FlaskConical } from 'lucide-react';
import { EquityCurveChart } from '../_components/EquityCurveChart';

interface Sleeve { id: number; key: string; name: string; strategy: string }
interface Metrics {
  totalReturnPct: number; cagrPct: number; sharpe: number; sortino: number; maxDrawdownPct: number;
  calmar: number; hitRatePct: number; profitFactor: number; turnoverPct: number; trades: number; psr: number; bars: number;
  finalEquityPaisa: number; startEquityPaisa: number;
  benchmarkTotalPct?: number; benchmarkCagrPct?: number;
  breakevenIntradayPct?: number; breakevenDeliveryPct?: number;
}
interface Backtest {
  id: number; sleeveId: number; strategy: string; label: string | null; fromDate: string | null; toDate: string | null;
  metricsJson: Metrics; equityCurveJson: Array<{ date: string; equityPaisa: number; benchmarkClose?: number }>;
}

const inr = (p: number) => '₹' + Math.round(p / 100).toLocaleString('en-IN');
const num = (n: number | undefined, d = 2) => (n == null || !Number.isFinite(n) ? '—' : n.toFixed(d));

export default function BacktestPage() {
  const [sleeves, setSleeves] = useState<Sleeve[]>([]);
  const [result, setResult] = useState<Backtest | null>(null);
  const [runningId, setRunningId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const sl = await fetch('/api/agent/sleeves').then((r) => r.json());
    setSleeves(sl.sleeves ?? []);
    const bt = await fetch('/api/agent/backtest').then((r) => r.json());
    if ((bt.backtests ?? []).length) setResult(bt.backtests[0]);
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (sleeveId: number) => {
    setRunningId(sleeveId);
    try {
      const r = await fetch('/api/agent/backtest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sleeveId }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'failed');
      setResult(d.backtest);
      toast.success('Backtest complete');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Backtest failed'); }
    finally { setRunningId(null); }
  };

  const m = result?.metricsJson;
  const curve = (result?.equityCurveJson ?? []).map((p) => ({ date: p.date, price: p.equityPaisa }));
  const benchCurve = (result?.equityCurveJson ?? [])
    .filter((p) => p.benchmarkClose != null)
    .map((p) => ({ date: p.date, price: p.benchmarkClose as number }));
  const hasBench = m?.benchmarkCagrPct != null;
  const alphaCagr = hasBench ? (m!.cagrPct - (m!.benchmarkCagrPct ?? 0)) : null;

  return (
    <div className="space-y-6">
      <Link href="/investments/analyst" className="inline-flex items-center gap-1 text-sm text-[var(--dxp-text-muted)] hover:text-[var(--dxp-text)]">
        <ArrowLeft className="h-4 w-4" /> Back to analyst
      </Link>
      <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">Backtest</h1>
      <p className="text-sm text-[var(--dxp-text-secondary)]">~5 years, same strategy code as live, net of Indian costs + STCG. Paper only — not financial advice.</p>

      <Card>
        <CardHeader><h3 className="text-base font-bold text-[var(--dxp-text)]">Run a sleeve</h3></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {sleeves.map((s) => (
              <Button key={s.id} variant="secondary" onClick={() => run(s.id)} disabled={runningId != null}>
                {runningId === s.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}{s.name}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {result && m && (
        <>
          <Card>
            <CardHeader>
              <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
                <FlaskConical className="h-5 w-5 text-[var(--dxp-brand)]" />
                {result.label} <Badge variant="info">{result.strategy}</Badge>
              </h3>
              <p className="text-xs text-[var(--dxp-text-muted)]">{result.fromDate} → {result.toDate} · {m.bars} bars</p>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Metric label="Total return" value={`${num(m.totalReturnPct)}%`} good={m.totalReturnPct >= 0} />
                <Metric label="CAGR (per year)" value={`${num(m.cagrPct)}%`} good={m.cagrPct >= 0} />
                {hasBench && <Metric label="Nifty 50 CAGR" value={`${num(m.benchmarkCagrPct)}%`} />}
                {hasBench && <Metric label="Alpha vs Nifty (CAGR)" value={`${alphaCagr! >= 0 ? '+' : ''}${num(alphaCagr!)}%`} good={alphaCagr! >= 0} />}
                <Metric label="Sharpe" value={num(m.sharpe)} good={m.sharpe >= 1} />
                <Metric label="Sortino" value={num(m.sortino)} />
                <Metric label="Max drawdown" value={`${num(m.maxDrawdownPct)}%`} good={m.maxDrawdownPct < 25} />
                <Metric label="Calmar" value={num(m.calmar)} />
                <Metric label="Hit rate" value={`${num(m.hitRatePct, 0)}%`} />
                <Metric label="Profit factor" value={num(m.profitFactor)} good={m.profitFactor >= 1} />
                <Metric label="Turnover" value={`${num(m.turnoverPct, 0)}%`} />
                <Metric label="Trades" value={String(m.trades)} />
                <Metric label="PSR (Sharpe>0)" value={`${num(m.psr * 100, 0)}%`} good={m.psr >= 0.95} />
                <Metric label="Final equity" value={inr(m.finalEquityPaisa)} good={m.finalEquityPaisa >= m.startEquityPaisa} />
              </div>
              {m.breakevenIntradayPct != null && (
                <div className="mt-3 rounded border border-[var(--dxp-border-light)] bg-[var(--dxp-surface)] p-3 text-xs text-[var(--dxp-text-secondary)]">
                  <span className="font-bold text-[var(--dxp-text)]">Edge hurdle</span> — each round trip must clear costs before it makes a rupee:
                  {' '}<span className="font-mono">same-day (intraday) ≈ {num(m.breakevenIntradayPct)}%</span>,
                  {' '}<span className="font-mono">overnight (delivery) ≈ {num(m.breakevenDeliveryPct)}%</span>,
                  {' '}<span className="font-mono">+ tax on gains (intraday slab / {num(20,0)}% STCG)</span>.
                  A strategy holding 2–3 days pays the delivery hurdle; only genuine same-day trades pay the cheaper intraday one.
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <h3 className="text-base font-bold text-[var(--dxp-text)]">Equity curve vs Nifty 50 (rebased to 100)</h3>
              <p className="text-xs text-[var(--dxp-text-muted)]">Strategy net of costs/STCG vs simply buying &amp; holding the index over the same window.</p>
            </CardHeader>
            <CardContent><EquityCurveChart equity={curve} benchmark={benchCurve} /></CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="rounded border border-[var(--dxp-border-light)] bg-[var(--dxp-surface)] p-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">{label}</p>
      <p className={`mt-1 font-mono text-lg font-bold ${good === undefined ? 'text-[var(--dxp-text)]' : good ? 'text-emerald-700' : 'text-rose-600'}`}>{value}</p>
    </div>
  );
}
