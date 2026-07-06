'use client';

/**
 * Per-bucket P&L panel. Unified model: equity = cash + Σ(positions marked live).
 *   Daily P&L = equity − opening (prior close);  Overall P&L = equity − corpus.
 * Intraday buckets end flat → balance is settled CASH, open trades shown as
 * "in-flight". Swing buckets carry positions into equity. Read-only; refreshes live.
 */

import { useEffect, useState, useCallback, Fragment } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardContent, Badge, Button } from '@dxp/ui';
import { ArrowLeft, RefreshCw, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';

interface Inflight { symbol: string; name: string; side: string; qty: number; entryPaisa: number; lastPaisa: number | null; marketPaisa: number; unrealPaisa: number }
interface Ledger { symbol: string; name: string; side: string; qty: number; exitPaisa: number; realizedPaisa: number }
interface Bucket {
  key: string; name: string; type: 'intraday' | 'swing';
  corpusPaisa: number; cashPaisa: number; positionsValuePaisa: number; equityPaisa: number;
  openingPaisa: number; realizedTodayPaisa: number; realizedAllPaisa: number; unrealizedPaisa: number;
  dailyPnlPaisa: number; overallPnlPaisa: number; openCount: number; inflight: Inflight[]; ledger: Ledger[];
}
interface Data { buckets: Bucket[]; portfolio: { corpusPaisa: number; cashPaisa: number; positionsValuePaisa: number; equityPaisa: number; dailyPnlPaisa: number; overallPnlPaisa: number } | null; asOf: string; marketDataOk: boolean }

const inr = (p: number) => '₹' + Math.round(p / 100).toLocaleString('en-IN');
const signed = (p: number) => (p >= 0 ? '+' : '−') + '₹' + Math.abs(Math.round(p / 100)).toLocaleString('en-IN');
const col = (p: number) => (p > 0 ? 'text-emerald-600' : p < 0 ? 'text-rose-500' : 'text-slate-400');

export default function PnlPage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await (await fetch('/api/agent/pnl')).json()); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]); // live refresh

  const p = data?.portfolio;
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <Link href="/investments/analyst" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" />Analyst</Link>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh</Button>
      </div>
      <h1 className="text-2xl font-bold text-slate-900">P&amp;L by bucket</h1>
      <p className="mt-1 text-sm text-slate-500"><b>Started</b> = opening · <b>In-flight</b> = equity invested in open positions (live) · <b>Remaining</b> = cash left · <b>P&amp;L</b> = (In-flight + Remaining) − Started. In-flight + Remaining is your equity now; it settles to cash at the 15:15 close and the 16:10 run locks the day&apos;s P&amp;L. {data?.asOf ? `As of ${data.asOf}.` : ''}</p>

      {loading && !data ? <div className="mt-10 flex justify-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div> : (
        <div className="mt-6 space-y-6">
          {/* Portfolio summary */}
          {p && (
            <Card>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 py-2 sm:grid-cols-4">
                  <div><div className="text-xs uppercase tracking-wider text-slate-400">Corpus</div><div className="text-lg font-bold text-slate-800">{inr(p.corpusPaisa)}</div></div>
                  <div><div className="text-xs uppercase tracking-wider text-slate-400">Equity now</div><div className="text-lg font-bold text-slate-800">{inr(p.equityPaisa)}</div></div>
                  <div><div className="text-xs uppercase tracking-wider text-slate-400">Daily P&amp;L</div><div className={`text-lg font-bold ${col(p.dailyPnlPaisa)}`}>{signed(p.dailyPnlPaisa)}</div></div>
                  <div><div className="text-xs uppercase tracking-wider text-slate-400">Overall P&amp;L</div><div className={`text-lg font-bold ${col(p.overallPnlPaisa)}`}>{signed(p.overallPnlPaisa)}</div></div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Per-bucket table */}
          <Card>
            <CardHeader><span className="font-semibold text-slate-800">Buckets</span></CardHeader>
            <CardContent>
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-500">
                  <th className="py-2 pr-2">Bucket</th><th className="pr-2 text-right">Started</th><th className="pr-2 text-right">In-flight</th><th className="pr-2 text-right">Remaining</th><th className="pr-2 text-right">P&amp;L</th><th className="pr-1"></th>
                </tr></thead>
                <tbody>{(data?.buckets ?? []).map((b) => {
                  const isOpen = open === b.key;
                  const hasDetail = b.inflight.length > 0 || b.ledger.length > 0;
                  return (
                    <Fragment key={b.key}>
                      <tr className={`border-b border-slate-100 ${hasDetail ? 'cursor-pointer hover:bg-slate-50' : ''}`} onClick={() => hasDetail && setOpen(isOpen ? null : b.key)}>
                        <td className="py-2 pr-2"><span className="font-semibold text-slate-800">{b.name}</span> <Badge variant="default">{b.type}</Badge></td>
                        <td className="pr-2 text-right text-slate-500">{inr(b.openingPaisa)}</td>
                        <td className="pr-2 text-right">{b.positionsValuePaisa ? inr(b.positionsValuePaisa) : '—'}{b.openCount > 0 ? <span className="ml-1 text-[10px] text-amber-500">live·{b.openCount}</span> : ''}</td>
                        <td className="pr-2 text-right">{inr(b.cashPaisa)}</td>
                        <td className={`pr-2 text-right font-semibold ${col(b.dailyPnlPaisa)}`}>{signed(b.dailyPnlPaisa)}</td>
                        <td className="pr-1 text-slate-400">{hasDetail ? (isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />) : null}</td>
                      </tr>
                      {isOpen && (
                        <tr key={b.key + '-d'} className="bg-slate-50/60"><td colSpan={6} className="px-3 py-3">
                          {b.inflight.length > 0 && (
                            <div className="mb-3">
                              <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">{b.type === 'intraday' ? 'In-flight (open trades)' : 'Held positions'}</div>
                              <table className="w-full text-xs"><tbody>{b.inflight.map((f) => (
                                <tr key={f.symbol} className="border-b border-slate-100">
                                  <td className="py-1 pr-2 font-medium text-slate-700">{f.name}</td><td className="pr-2 text-slate-400">{f.side} ×{f.qty}</td>
                                  <td className="pr-2 text-right text-slate-500">entry {inr(f.entryPaisa)}</td><td className="pr-2 text-right text-slate-500">now {f.lastPaisa != null ? inr(f.lastPaisa) : '—'}</td>
                                  <td className="pr-2 text-right">{inr(f.marketPaisa)}</td><td className={`pr-2 text-right font-semibold ${col(f.unrealPaisa)}`}>{signed(f.unrealPaisa)}</td>
                                </tr>
                              ))}</tbody></table>
                            </div>
                          )}
                          {b.ledger.length > 0 && (
                            <div>
                              <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Today&apos;s closed round-trips → {signed(b.realizedTodayPaisa)}</div>
                              <table className="w-full text-xs"><tbody>{b.ledger.map((l, i) => (
                                <tr key={i} className="border-b border-slate-100">
                                  <td className="py-1 pr-2 font-medium text-slate-700">{l.name}</td><td className="pr-2 text-slate-400">{l.side} ×{l.qty}</td>
                                  <td className="pr-2 text-right text-slate-500">exit {inr(l.exitPaisa)}</td>
                                  <td className={`pr-2 text-right font-semibold ${col(l.realizedPaisa)}`}>{signed(l.realizedPaisa)}</td>
                                </tr>
                              ))}</tbody></table>
                            </div>
                          )}
                        </td></tr>
                      )}
                    </Fragment>
                  );
                })}</tbody>
              </table></div>
              {!data?.buckets?.length && <p className="py-4 text-center text-sm text-slate-400">No buckets yet.</p>}
            </CardContent>
          </Card>
          <p className="text-center text-xs text-slate-400">Read-only reporting · refreshes every 30s · does not affect any strategy or the forward-test.</p>
        </div>
      )}
    </div>
  );
}
