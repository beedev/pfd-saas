'use client';

/**
 * Forward-Test Study — how the algorithm performs over the run. Headline is the whole
 * PORTFOLIO (all sleeves); a bucket filter lets you read the momentum book on its own
 * instead of mixed with the intraday experiments. Below the curve: a per-day snapshot
 * table (the numbers behind the line) and the closed round-trips behind the win rate.
 * Plus the run-health log so you can tell "no signal" from "data broke." Read-only.
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Button, Card, CardHeader, CardContent } from '@dxp/ui';
import { ArrowLeft, Loader2, RefreshCw } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

interface Curve { date: string; equity: number; openPositions: number; drawdownPct?: number; realized?: number }
interface Summary { days: number; equity: number; totalReturnPct: number; maxDrawdownPct: number; winRatePct: number; closedTrades: number; openPositions: number }
interface Sleeve extends Summary { id: number; key: string; name: string; curve: Curve[]; corpus: number }
interface Trade { date: string; sleeveId: number; sleeveName: string; symbol: string; side: string; qty: number; exitPaisa: number; realizedPaisa: number }
interface Health { date: string; status: string; considered: number; picked: number; bhavRows: number; screenCount: number; quotesOk: boolean; note: string }
interface Data { summary: Summary | null; curve: Curve[]; sleeves: Sleeve[]; trades: Trade[]; health: Health[] }

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const sgn = (n: number) => `${n >= 0 ? '+' : '−'}₹${Math.abs(Math.round(n)).toLocaleString('en-IN')}`;
const col = (n: number) => (n > 0 ? 'text-emerald-600' : n < 0 ? 'text-rose-500' : 'text-slate-400');
const statusStyle: Record<string, string> = { OK: 'bg-emerald-100 text-emerald-700', NO_SIGNAL: 'bg-slate-100 text-slate-600', DATA_GAP: 'bg-rose-100 text-rose-700', SKIPPED: 'bg-slate-100 text-slate-400' };

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return <div><div className={`text-lg font-bold ${tone === 'up' ? 'text-emerald-600' : tone === 'down' ? 'text-rose-500' : 'text-slate-900'}`}>{value}</div><div className="text-xs text-slate-500">{label}</div></div>;
}

export default function StudyPage() {
  const [data, setData] = useState<Data | null>(null);
  const [bucket, setBucket] = useState<'ALL' | number>('ALL');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await (await fetch('/api/agent/study')).json()); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const sleeve = bucket !== 'ALL' ? data?.sleeves.find((s) => s.id === bucket) : undefined;
  const summary: Summary | null | undefined = bucket === 'ALL' ? data?.summary : sleeve;
  const activeCurve: Curve[] = (bucket === 'ALL' ? data?.curve : sleeve?.curve) ?? [];
  const activeTrades = (data?.trades ?? []).filter((t) => bucket === 'ALL' || t.sleeveId === bucket);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <Link href="/investments/analyst" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" />Analyst</Link>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh</Button>
      </div>
      <h1 className="text-2xl font-bold text-slate-900">Forward-Test Study</h1>
      <p className="mt-1 text-sm text-slate-500">The daily record of how the algorithm performs. Snapshots taken 16:10 IST after close.</p>

      {loading && !data ? (
        <div className="mt-10 flex justify-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : !data?.summary ? (
        <Card className="mt-6"><CardContent className="py-10 text-center text-sm text-slate-500">No snapshots yet. The first is recorded at 16:10 IST after the market closes.</CardContent></Card>
      ) : (
        <div className="mt-6 space-y-6">
          {/* Bucket filter */}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setBucket('ALL')} className={`rounded-full px-3 py-1 text-xs font-semibold ${bucket === 'ALL' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>Portfolio</button>
            {(data.sleeves ?? []).map((s) => (
              <button key={s.id} onClick={() => setBucket(s.id)} className={`rounded-full px-3 py-1 text-xs font-semibold ${bucket === s.id ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{s.name}</button>
            ))}
          </div>
          {bucket === 'ALL' && <p className="-mt-3 text-xs text-amber-600">Portfolio view mixes the 2-3mo book with the intraday experiments — pick a bucket for its own numbers.</p>}

          {summary && (
            <Card><CardContent className="flex flex-wrap gap-x-8 gap-y-3 py-4">
              <Stat label={`equity (day ${summary.days})`} value={inr(summary.equity)} />
              <Stat label="total return" value={`${summary.totalReturnPct >= 0 ? '+' : ''}${summary.totalReturnPct}%`} tone={summary.totalReturnPct >= 0 ? 'up' : 'down'} />
              <Stat label="max drawdown" value={`${summary.maxDrawdownPct}%`} tone="down" />
              <Stat label="win rate" value={`${summary.winRatePct}%`} />
              <Stat label="closed / open" value={`${summary.closedTrades} / ${summary.openPositions}`} />
            </CardContent></Card>
          )}

          <Card>
            <CardHeader><span className="font-semibold text-slate-800">Equity curve <span className="text-xs font-normal text-slate-400">· {bucket === 'ALL' ? 'Portfolio' : sleeve?.name}</span></span></CardHeader>
            <CardContent>
              {activeCurve.length < 2 ? <p className="py-8 text-center text-sm text-slate-400">Need ≥2 days for a curve.</p> : (
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={activeCurve} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
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

          {/* Per-day snapshot table — the numbers behind the curve */}
          <Card>
            <CardHeader><span className="font-semibold text-slate-800">Daily snapshots</span></CardHeader>
            <CardContent>
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-500"><th className="py-2 pr-3">Date</th><th className="pr-3 text-right">Equity</th><th className="pr-3 text-right">Day P&amp;L</th><th className="pr-3 text-right">Drawdown</th><th className="pr-3 text-right">Open</th></tr></thead>
                <tbody>{activeCurve.map((c, i) => {
                  const dayPnl = c.equity - (i > 0 ? activeCurve[i - 1].equity : c.equity);
                  return (
                    <tr key={c.date} className="border-b border-slate-100">
                      <td className="py-2 pr-3 text-slate-700">{c.date}</td>
                      <td className="pr-3 text-right font-medium">{inr(c.equity)}</td>
                      <td className={`pr-3 text-right ${col(dayPnl)}`}>{i === 0 ? '—' : sgn(dayPnl)}</td>
                      <td className={`pr-3 text-right ${(c.drawdownPct ?? 0) < 0 ? 'text-rose-500' : 'text-slate-400'}`}>{(c.drawdownPct ?? 0).toFixed(2)}%</td>
                      <td className="pr-3 text-right text-slate-500">{c.openPositions}</td>
                    </tr>
                  );
                })}</tbody>
              </table></div>
            </CardContent>
          </Card>

          {/* Closed round-trips behind the win rate */}
          <Card>
            <CardHeader><span className="font-semibold text-slate-800">Closed trades <span className="text-xs font-normal text-slate-400">· {activeTrades.length} (the win rate)</span></span></CardHeader>
            <CardContent>
              {activeTrades.length === 0 ? <p className="py-4 text-center text-sm text-slate-400">No closed trades yet in this bucket.</p> : (
                <div className="overflow-x-auto"><table className="w-full text-sm">
                  <thead><tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-500"><th className="py-2 pr-3">Date</th>{bucket === 'ALL' && <th className="pr-3">Bucket</th>}<th className="pr-3">Name</th><th className="pr-3">Side</th><th className="pr-3 text-right">Exit</th><th className="pr-3 text-right">P&amp;L</th></tr></thead>
                  <tbody>{activeTrades.map((t, i) => (
                    <tr key={t.date + t.symbol + i} className="border-b border-slate-100">
                      <td className="py-2 pr-3 text-slate-600">{t.date}</td>
                      {bucket === 'ALL' && <td className="pr-3 text-xs text-slate-500">{t.sleeveName}</td>}
                      <td className="pr-3 font-medium text-slate-700">{t.symbol.replace('.NS', '')}</td>
                      <td className="pr-3 text-xs text-slate-400">{t.side} ×{t.qty}</td>
                      <td className="pr-3 text-right text-slate-500">{inr(t.exitPaisa / 100)}</td>
                      <td className={`pr-3 text-right font-semibold ${col(t.realizedPaisa)}`}>{sgn(t.realizedPaisa / 100)}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><span className="font-semibold text-slate-800">Run-health log</span></CardHeader>
            <CardContent>
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-500"><th className="py-2 pr-3">Date</th><th className="pr-3">Status</th><th className="pr-3 text-right">Cand→Picks</th><th className="pr-3 text-right">Bhav</th><th className="pr-3 text-right">Screen</th><th>Note</th></tr></thead>
                <tbody>
                  {(data.health ?? []).map((h) => (
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
