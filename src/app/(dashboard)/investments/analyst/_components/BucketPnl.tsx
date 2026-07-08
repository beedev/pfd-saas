'use client';

/**
 * Per-bucket P&L view (reusable). Unified model: equity = cash + Σ(positions marked
 * live). Started = opening · In-flight = invested (live) · Remaining = cash · P&L =
 * (In-flight + Remaining) − Started. Click any bucket to expand its stocks (or "all
 * cash" when empty). Intraday buckets settle to cash at 15:15. Read-only; 30s refresh.
 * Rendered on the Analyst dashboard (the P&L page was merged into it).
 */

import { useEffect, useState, useCallback, Fragment } from 'react';
import { Card, CardHeader, CardContent, Badge, Button } from '@dxp/ui';
import { RefreshCw, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';

interface Inflight { symbol: string; name: string; side: string; qty: number; entryPaisa: number; lastPaisa: number | null; investedPaisa: number; marketPaisa: number; unrealPaisa: number }
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

export function BucketPnl() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await (await fetch('/api/agent/pnl')).json()); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]); // live refresh

  const p = data?.portfolio;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-[var(--dxp-text)]">P&amp;L by bucket</h3>
          <p className="text-xs text-[var(--dxp-text-muted)]">Started = opening · In-flight = invested (live) · Remaining = cash · <b>Daily</b> = equity − Started · <b>Overall</b> = equity − corpus. The two P&amp;L columns sum to the Daily &amp; Overall headlines. Click a bucket for its stocks. {data?.asOf ? `As of ${data.asOf}.` : ''}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh</Button>
      </div>

      {loading && !data ? <div className="flex justify-center py-6 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div> : (
        <>
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

          <Card>
            <CardHeader><span className="font-semibold text-slate-800">Buckets</span></CardHeader>
            <CardContent>
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-500">
                  <th className="py-2 pr-2">Bucket</th><th className="pr-2 text-right">Started</th><th className="pr-2 text-right">In-flight</th><th className="pr-2 text-right">Remaining</th><th className="pr-2 text-right">Daily</th><th className="pr-2 text-right">Overall</th><th className="pr-1"></th>
                </tr></thead>
                <tbody>{(data?.buckets ?? []).map((b) => {
                  const isOpen = open === b.key;
                  return (
                    <Fragment key={b.key}>
                      <tr className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={() => setOpen(isOpen ? null : b.key)}>
                        <td className="py-2 pr-2"><span className="font-semibold text-slate-800">{b.name}</span> <Badge variant="default">{b.type}</Badge></td>
                        <td className="pr-2 text-right text-slate-500">{inr(b.openingPaisa)}</td>
                        <td className="pr-2 text-right">{b.positionsValuePaisa ? inr(b.positionsValuePaisa) : '—'}{b.openCount > 0 ? <span className="ml-1 text-[10px] text-amber-500">live·{b.openCount}</span> : ''}</td>
                        <td className="pr-2 text-right">{inr(b.cashPaisa)}</td>
                        <td className={`pr-2 text-right font-semibold ${col(b.dailyPnlPaisa)}`}>{signed(b.dailyPnlPaisa)}</td>
                        <td className={`pr-2 text-right font-semibold ${col(b.overallPnlPaisa)}`}>{signed(b.overallPnlPaisa)}</td>
                        <td className="pr-1 text-slate-400">{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                      </tr>
                      {isOpen && b.inflight.length === 0 && b.ledger.length === 0 && (
                        <tr key={b.key + '-empty'} className="bg-slate-50/40 text-xs"><td className="py-2 pl-6 text-slate-400" colSpan={7}>No positions in this basket — all cash ({inr(b.cashPaisa)}).</td></tr>
                      )}
                      {isOpen && b.inflight.length > 0 && (
                        <tr key={b.key + '-hh'} className="bg-slate-50/70 text-[10px] uppercase tracking-wider text-slate-400"><td className="py-1 pl-6" colSpan={7}>{b.type === 'intraday' ? 'In-flight — open trades' : 'Held positions'}</td></tr>
                      )}
                      {isOpen && b.inflight.map((f) => (
                        <tr key={b.key + '-p-' + f.symbol} className="border-b border-slate-100 bg-slate-50/40 text-xs">
                          <td className="py-1.5 pl-6 pr-2"><span className="font-medium text-slate-700">{f.name}</span> <span className="text-slate-400">(Ent {inr(f.entryPaisa)}) · {f.side} ×{f.qty}</span></td>
                          <td className="pr-2 text-right text-slate-500">{inr(f.investedPaisa)}</td>
                          <td className="pr-2 text-right"><span className="font-medium text-slate-700">{inr(f.marketPaisa)}</span> <span className="text-slate-400">· now {f.lastPaisa != null ? inr(f.lastPaisa) : '—'}</span></td>
                          <td className="pr-2 text-right text-slate-300">—</td>
                          <td className={`pr-2 text-right font-semibold ${col(f.unrealPaisa)}`}>{signed(f.unrealPaisa)}</td>
                          <td className="pr-2"></td>
                          <td className="pr-1"></td>
                        </tr>
                      ))}
                      {isOpen && b.ledger.length > 0 && (
                        <tr key={b.key + '-lh'} className="bg-slate-50/70 text-[10px] uppercase tracking-wider text-slate-400"><td className="py-1 pl-6" colSpan={7}>Closed round-trips today → <span className={col(b.realizedTodayPaisa)}>{signed(b.realizedTodayPaisa)}</span></td></tr>
                      )}
                      {isOpen && b.ledger.map((l, i) => (
                        <tr key={b.key + '-l-' + i} className="border-b border-slate-100 bg-slate-50/40 text-xs">
                          <td className="py-1.5 pl-6 pr-2"><span className="font-medium text-slate-700">{l.name}</span> <span className="text-slate-400">{l.side} ×{l.qty} @ exit {inr(l.exitPaisa)}</span></td>
                          <td className="pr-2"></td>
                          <td className="pr-2 text-right text-slate-500"><span className="font-medium text-slate-700">{inr(l.exitPaisa * l.qty)}</span> <span className="text-slate-400">· {l.qty} sh</span></td>
                          <td className="pr-2"></td>
                          <td className={`pr-2 text-right font-semibold ${col(l.realizedPaisa)}`}>{signed(l.realizedPaisa)}</td>
                          <td className="pr-2"></td>
                          <td className="pr-1"></td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}</tbody>
              </table></div>
              {!data?.buckets?.length && <p className="py-4 text-center text-sm text-slate-400">No buckets yet.</p>}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
