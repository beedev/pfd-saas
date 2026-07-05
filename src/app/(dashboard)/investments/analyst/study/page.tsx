'use client';

/**
 * Forward-Test Study — the analyzable record of how the algorithm performs over the
 * 6-month run: the daily equity curve + key metrics, and the run-health log so you
 * can tell "no signal" from "data broke." Reads the daily snapshots + run-health.
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Button, Card, CardHeader, CardContent } from '@dxp/ui';
import { ArrowLeft, Loader2, RefreshCw } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

interface Summary { days: number; equity: number; totalReturnPct: number; maxDrawdownPct: number; winRatePct: number; closedTrades: number; openPositions: number }
interface Point { date: string; equity: number; unrealized: number; realized: number; drawdownPct: number; openPositions: number }
interface Health { date: string; status: string; considered: number; picked: number; bhavRows: number; screenCount: number; quotesOk: boolean; note: string }

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const statusStyle: Record<string, string> = { OK: 'bg-emerald-100 text-emerald-700', NO_SIGNAL: 'bg-slate-100 text-slate-600', DATA_GAP: 'bg-rose-100 text-rose-700', SKIPPED: 'bg-slate-100 text-slate-400' };

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return <div><div className={`text-lg font-bold ${tone === 'up' ? 'text-emerald-600' : tone === 'down' ? 'text-rose-500' : 'text-slate-900'}`}>{value}</div><div className="text-xs text-slate-500">{label}</div></div>;
}

export default function StudyPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [curve, setCurve] = useState<Point[]>([]);
  const [health, setHealth] = useState<Health[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { const d = await (await fetch('/api/agent/study')).json(); setSummary(d.summary); setCurve(d.curve ?? []); setHealth(d.health ?? []); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <Link href="/investments/analyst" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" />Analyst</Link>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh</Button>
      </div>
      <h1 className="text-2xl font-bold text-slate-900">Forward-Test Study</h1>
      <p className="mt-1 text-sm text-slate-500">The daily record of how the algorithm performs. Snapshots taken 16:10 IST after close.</p>

      {loading ? (
        <div className="mt-10 flex justify-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : !summary ? (
        <Card className="mt-6"><CardContent className="py-10 text-center text-sm text-slate-500">No snapshots yet. The first is recorded at 16:10 IST after the market closes.</CardContent></Card>
      ) : (
        <div className="mt-6 space-y-6">
          <Card><CardContent className="flex flex-wrap gap-x-8 gap-y-3 py-4">
            <Stat label={`equity (day ${summary.days})`} value={inr(summary.equity)} />
            <Stat label="total return" value={`${summary.totalReturnPct >= 0 ? '+' : ''}${summary.totalReturnPct}%`} tone={summary.totalReturnPct >= 0 ? 'up' : 'down'} />
            <Stat label="max drawdown" value={`${summary.maxDrawdownPct}%`} tone="down" />
            <Stat label="win rate" value={`${summary.winRatePct}%`} />
            <Stat label="closed / open" value={`${summary.closedTrades} / ${summary.openPositions}`} />
          </CardContent></Card>

          <Card>
            <CardHeader><span className="font-semibold text-slate-800">Equity curve</span></CardHeader>
            <CardContent>
              {curve.length < 2 ? <p className="py-8 text-center text-sm text-slate-400">Need ≥2 days for a curve.</p> : (
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={curve} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={40} />
                    <YAxis tick={{ fontSize: 11 }} domain={['auto', 'auto']} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} width={48} />
                    <Tooltip formatter={(v) => inr(Number(v))} />
                    <Line type="monotone" dataKey="equity" stroke="#4f46e5" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><span className="font-semibold text-slate-800">Run-health log</span></CardHeader>
            <CardContent>
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-500"><th className="py-2 pr-3">Date</th><th className="pr-3">Status</th><th className="pr-3 text-right">Cand→Picks</th><th className="pr-3 text-right">Bhav</th><th className="pr-3 text-right">Screen</th><th>Note</th></tr></thead>
                <tbody>
                  {health.map((h) => (
                    <tr key={h.date} className="border-b border-slate-100">
                      <td className="py-2 pr-3 text-slate-700">{h.date}</td>
                      <td className="pr-3"><span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${statusStyle[h.status] ?? 'bg-slate-100'}`}>{h.status}</span></td>
                      <td className="pr-3 text-right text-slate-600">{h.considered}→{h.picked}</td>
                      <td className="pr-3 text-right text-slate-500">{h.bhavRows || '—'}</td>
                      <td className="pr-3 text-right text-slate-500">{h.screenCount || '—'}</td>
                      <td className="text-xs text-slate-400">{h.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
