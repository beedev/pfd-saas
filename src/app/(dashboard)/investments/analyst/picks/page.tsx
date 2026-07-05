'use client';

/**
 * Today's Picks — what the 07:35 morning pipeline surfaced for the day: news +
 * whole-spectrum NSE announcements + the RS/Stage-2 screen, each vetted through
 * the character test + Stage-2 + liquidity + delivery gates. Split by horizon,
 * with a stage badge so you can see WHY each name qualified. Analyst-isolated.
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Button, Card, CardHeader, CardContent, Badge } from '@dxp/ui';
import { ArrowLeft, Loader2, RefreshCw, TrendingUp, Zap, Newspaper, Megaphone, Radar } from 'lucide-react';

interface Pick {
  symbol: string; name: string; horizon: 'INTRADAY' | 'MULTIDAY'; source: string;
  recommended: string; stage: string | null; score: number | null; sector: string | null; relVolume: number | null;
  liquidityCr: number | null; deliveryPct: number | null; rsExcess: number | null;
  suggestedBuy: number | null; targetPrice: number | null; stopPrice: number | null; note: string;
}
const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
interface Score { closed: { trades: number; winRatePct: number; totalPnlRupees: number; avgReturnPct: number } | null; open: { positions: number; unrealizedRupees: number } | null }

const stageColor = (s: string | null) => s === 'STAGE2' ? 'bg-emerald-100 text-emerald-700' : s === 'STAGE3' ? 'bg-amber-100 text-amber-700' : s === 'STAGE4' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600';
const sourceMeta: Record<string, { label: string; Icon: typeof Newspaper }> = {
  news: { label: 'News', Icon: Newspaper },
  announcement: { label: 'Filing', Icon: Megaphone },
  screen: { label: 'RS screen', Icon: Radar },
};

function PickRow({ p }: { p: Pick }) {
  const src = sourceMeta[p.source] ?? { label: p.source, Icon: Newspaper };
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {p.score != null && <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[11px] font-bold text-indigo-700" title="Composite score: RS 40 · spike 20 · rel-vol 20 · sector 20">{p.score}</span>}
          <span className="font-semibold text-slate-900">{p.name || p.symbol}</span>
          {p.stage && <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${stageColor(p.stage)}`}>{p.stage}</span>}
          {p.sector && p.sector !== 'OTHER' && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">{p.sector}</span>}
          <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600"><src.Icon className="h-3 w-3" />{src.label}</span>
        </div>
        <div className="mt-0.5 truncate text-xs text-slate-500">{p.note}</div>
      </div>
      <div className="flex shrink-0 items-center gap-4 text-right text-xs">
        {p.suggestedBuy != null && (
          <div>
            <div className="font-semibold text-slate-900">buy ~{inr(p.suggestedBuy)}</div>
            {p.targetPrice != null && p.stopPrice != null && <div className="text-slate-400">tgt {inr(p.targetPrice)} · stop {inr(p.stopPrice)}</div>}
          </div>
        )}
        {p.rsExcess != null && <div><div className="font-semibold text-emerald-600">+{p.rsExcess.toFixed(0)}%</div><div className="text-slate-400">vs Nifty</div></div>}
        {p.deliveryPct != null && <div><div className="font-medium text-slate-700">{p.deliveryPct.toFixed(0)}%</div><div className="text-slate-400">deliv</div></div>}
      </div>
    </div>
  );
}

export default function TodaysPicksPage() {
  const [picks, setPicks] = useState<Pick[]>([]);
  const [date, setDate] = useState('');
  const [score, setScore] = useState<Score | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pr, sr] = await Promise.all([fetch('/api/agent/daily-picks'), fetch('/api/agent/scorecard')]);
      const data = await pr.json();
      setPicks(data.picks ?? []);
      setDate(data.date ?? '');
      setScore(await sr.json().catch(() => null));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const multiday = picks.filter((p) => p.horizon === 'MULTIDAY');
  const intraday = picks.filter((p) => p.horizon === 'INTRADAY');

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <Link href="/investments/analyst" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" />Analyst</Link>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh</Button>
      </div>

      <h1 className="text-2xl font-bold text-slate-900">Today&apos;s Picks</h1>
      <p className="mt-1 text-sm text-slate-500">Vetted by the 07:35 pipeline — character + Stage-2 + liquidity + delivery gates. Exit at target/stop or when a name drops out of Stage 2 (≤2-3 mo). {date && `(${date})`}</p>

      {score?.closed && score.closed.trades > 0 && (
        <Card className="mt-4"><CardContent className="flex flex-wrap items-center gap-x-6 gap-y-1 py-3 text-sm">
          <span className="font-semibold text-slate-800">Algo score (₹10K/pick)</span>
          <span>{score.closed.trades} closed · <b>{score.closed.winRatePct.toFixed(0)}%</b> win</span>
          <span>avg <b className={score.closed.avgReturnPct >= 0 ? 'text-emerald-600' : 'text-rose-500'}>{score.closed.avgReturnPct >= 0 ? '+' : ''}{score.closed.avgReturnPct}%</b></span>
          <span>realized <b className={score.closed.totalPnlRupees >= 0 ? 'text-emerald-600' : 'text-rose-500'}>{inr(score.closed.totalPnlRupees)}</b></span>
          {score.open && score.open.positions > 0 && <span className="text-slate-500">{score.open.positions} open · unrealized {inr(score.open.unrealizedRupees)}</span>}
        </CardContent></Card>
      )}

      {loading ? (
        <div className="mt-10 flex justify-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : picks.length === 0 ? (
        <Card className="mt-6"><CardContent className="py-10 text-center text-sm text-slate-500">
          No picks yet today. The pipeline runs at 07:35 IST — in a soft/weak-breadth market it may surface few or zero names (that&apos;s the discipline; it won&apos;t force trades).
        </CardContent></Card>
      ) : (
        <div className="mt-6 space-y-6">
          {multiday.length > 0 && (
            <Card>
              <CardHeader><div className="flex items-center gap-2 font-semibold text-slate-800"><TrendingUp className="h-4 w-4 text-emerald-600" /> 2-3 month <Badge variant="default">{multiday.length}</Badge></div></CardHeader>
              <CardContent className="space-y-2">{multiday.map((p) => <PickRow key={p.symbol} p={p} />)}</CardContent>
            </Card>
          )}
          {intraday.length > 0 && (
            <Card>
              <CardHeader><div className="flex items-center gap-2 font-semibold text-slate-800"><Zap className="h-4 w-4 text-amber-500" /> Intraday <Badge variant="default">{intraday.length}</Badge></div></CardHeader>
              <CardContent className="space-y-2">{intraday.map((p) => <PickRow key={p.symbol} p={p} />)}</CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
