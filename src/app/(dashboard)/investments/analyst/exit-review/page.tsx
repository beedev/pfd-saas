'use client';

/**
 * Exit Review — the same Stage/RS lens we vet buys with, turned on the holdings
 * you already own. Flags EXIT (Stage 4), TRIM (Stage 3 / lagging), REVIEW (Stage
 * 1 idle), HOLD (Stage 2). Reads the app's holdings table. Analyst-isolated.
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Button, Card, CardContent } from '@dxp/ui';
import { ArrowLeft, Loader2, RefreshCw } from 'lucide-react';

interface Row { symbol: string; quantity: number; stage: string | null; rsExcess: number | null; action: string; reason: string; gainPct: number | null }

const actionStyle: Record<string, string> = {
  EXIT: 'bg-rose-100 text-rose-700', TRIM: 'bg-amber-100 text-amber-700',
  REVIEW: 'bg-slate-100 text-slate-600', HOLD: 'bg-emerald-100 text-emerald-700',
};
const stageStyle = (s: string | null) => s === 'STAGE2' ? 'text-emerald-600' : s === 'STAGE4' ? 'text-rose-600' : s === 'STAGE3' ? 'text-amber-600' : 'text-slate-500';

export default function ExitReviewPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { const res = await fetch('/api/agent/exit-review'); const d = await res.json(); setRows(d.holdings ?? []); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const flagged = rows.filter((r) => r.action !== 'HOLD').length;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <Link href="/investments/analyst" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" />Analyst</Link>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh</Button>
      </div>
      <h1 className="text-2xl font-bold text-slate-900">Exit Review</h1>
      <p className="mt-1 text-sm text-slate-500">Your holdings through the Stage/RS lens — the same one that vets buys. {rows.length > 0 && `${flagged} of ${rows.length} flagged.`}</p>

      {loading ? (
        <div className="mt-10 flex justify-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <Card className="mt-6"><CardContent className="py-10 text-center text-sm text-slate-500">No holdings found. Add your stocks in the app and they&apos;ll be reviewed here.</CardContent></Card>
      ) : (
        <div className="mt-6 space-y-2">
          {rows.map((r) => (
            <div key={r.symbol} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${actionStyle[r.action] ?? 'bg-slate-100 text-slate-600'}`}>{r.action}</span>
                  <span className="font-semibold text-slate-900">{r.symbol.replace('.NS', '')}</span>
                  {r.stage && <span className={`text-xs font-medium ${stageStyle(r.stage)}`}>{r.stage}</span>}
                  {r.rsExcess != null && <span className={`text-xs ${r.rsExcess >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{r.rsExcess >= 0 ? '+' : ''}{r.rsExcess}% vs Nifty</span>}
                </div>
                <div className="mt-0.5 truncate text-xs text-slate-500">{r.reason}</div>
              </div>
              {r.gainPct != null && <div className={`shrink-0 text-right text-sm font-medium ${r.gainPct >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{r.gainPct >= 0 ? '+' : ''}{r.gainPct.toFixed(1)}%</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
