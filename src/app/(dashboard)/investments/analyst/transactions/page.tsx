'use client';

/**
 * Transactions — the full paper-trade ledger across all 5 buckets. Every fill
 * (open/close, long/short) with bucket, action, qty, price, amount, and
 * realized P&L. Filterable by bucket. Newest first.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { Button, Card, CardHeader, CardContent, Badge, Select } from '@dxp/ui';
import { ArrowLeft, Loader2, Receipt } from 'lucide-react';

interface Trade {
  id: number; sleeveName: string | null; sleeveKey: string | null;
  type: 'BUY' | 'SELL'; side: 'LONG' | 'SHORT'; assetClass: string;
  symbol: string; schemeCode: string; name: string;
  quantity: number; pricePerUnitPaisa: number; grossAmountPaisa: number;
  netAmountPaisa: number; realizedPnlPaisa: number | null; tradeDate: string; createdAt: string;
}

const inr = (p: number | null | undefined) => (p == null ? '—' : '₹' + (p / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 }));
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const qtyFmt = (q: number) => (Number.isInteger(q) ? String(q) : q.toFixed(3));

// Make long/short opens & closes legible: a short opens with a SELL, covers with a BUY.
function actionOf(t: Trade): { label: string; variant: 'success' | 'warning' | 'info' } {
  if (t.side === 'SHORT') return t.type === 'SELL' ? { label: 'SHORT', variant: 'warning' } : { label: 'COVER', variant: 'info' };
  return t.type === 'BUY' ? { label: 'BUY', variant: 'success' } : { label: 'SELL', variant: 'info' };
}

export default function TransactionsPage() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [bucket, setBucket] = useState('ALL');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/agent/trades').then((x) => x.json());
      setTrades(r.trades ?? []);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const bucketOptions = useMemo(() => {
    const names = Array.from(new Set(trades.map((t) => t.sleeveName).filter(Boolean))) as string[];
    return [{ value: 'ALL', label: 'All buckets' }, ...names.map((n) => ({ value: n, label: n }))];
  }, [trades]);
  const rows = bucket === 'ALL' ? trades : trades.filter((t) => t.sleeveName === bucket);
  const realized = rows.reduce((a, t) => a + (t.realizedPnlPaisa ?? 0), 0);

  return (
    <div className="space-y-6">
      <Link href="/investments/analyst" className="inline-flex items-center gap-1 text-sm text-[var(--dxp-text-muted)] hover:text-[var(--dxp-text)]">
        <ArrowLeft className="h-4 w-4" /> Back to analyst
      </Link>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
          <Receipt className="h-7 w-7 text-[var(--dxp-brand)]" /> Transactions
        </h1>
        <div className="w-56"><Select value={bucket} onChange={setBucket} options={bucketOptions} /></div>
      </div>

      <Card>
        <CardHeader>
          <h3 className="text-base font-bold text-[var(--dxp-text)]">{rows.length} fills{bucket !== 'ALL' ? ` · ${bucket}` : ''}</h3>
          <p className="text-xs text-[var(--dxp-text-muted)]">Realized P&amp;L (closed legs): <span className={realized >= 0 ? 'text-emerald-700' : 'text-rose-600'}>{realized >= 0 ? '+' : ''}{inr(realized)}</span>. Paper trades only.</p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[var(--dxp-text-muted)]" /></div>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-[var(--dxp-text-muted)]">No transactions yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--dxp-border-light)] text-[10px] uppercase tracking-wider text-[var(--dxp-text-muted)]">
                    <th className="py-1.5 pr-3 text-left font-medium">Time (IST)</th>
                    <th className="py-1.5 px-2 text-left font-medium">Bucket</th>
                    <th className="py-1.5 px-2 text-left font-medium">Action</th>
                    <th className="py-1.5 px-2 text-left font-medium">Instrument</th>
                    <th className="py-1.5 px-2 text-right font-medium">Qty</th>
                    <th className="py-1.5 px-2 text-right font-medium">Price</th>
                    <th className="py-1.5 px-2 text-right font-medium">Amount</th>
                    <th className="py-1.5 pl-2 text-right font-medium">Realized P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => {
                    const a = actionOf(t);
                    const pnl = t.realizedPnlPaisa;
                    return (
                      <tr key={t.id} className="border-b border-[var(--dxp-border-light)]/40">
                        <td className="py-1.5 pr-3 font-mono text-[var(--dxp-text-secondary)]">{when(t.createdAt)}</td>
                        <td className="py-1.5 px-2 text-[var(--dxp-text-secondary)]">{t.sleeveName ?? '—'}</td>
                        <td className="py-1.5 px-2"><Badge variant={a.variant} className="text-[10px]">{a.label}</Badge></td>
                        <td className="py-1.5 px-2">
                          <span className="font-mono font-semibold text-[var(--dxp-text)]">{t.symbol || t.schemeCode}</span>
                          <span className="block max-w-[16rem] truncate text-[10px] text-[var(--dxp-text-muted)]">{t.name}</span>
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono text-[var(--dxp-text-secondary)]">{qtyFmt(t.quantity)}</td>
                        <td className="py-1.5 px-2 text-right font-mono text-[var(--dxp-text-secondary)]">{inr(t.pricePerUnitPaisa)}</td>
                        <td className="py-1.5 px-2 text-right font-mono text-[var(--dxp-text)]">{inr(t.netAmountPaisa)}</td>
                        <td className={`py-1.5 pl-2 text-right font-mono ${pnl == null ? 'text-[var(--dxp-text-muted)]' : pnl >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                          {pnl == null ? '—' : `${pnl >= 0 ? '+' : ''}${inr(pnl)}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
