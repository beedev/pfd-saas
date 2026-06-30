'use client';

/** Pre-market brief — the day's LLM directional read (buy vs short candidates)
 *  from overnight/morning news. Drives the intraday sleeve. */

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Card, CardHeader, CardContent, Badge, Button } from '@dxp/ui';
import { Sunrise, RefreshCw, Loader2, TrendingUp, TrendingDown } from 'lucide-react';

interface BriefRow { id: number; briefDate: string; symbol: string; bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; impact: number | null; rationale: string | null; headlineCount: number }

export function BriefPanel() {
  const [rows, setRows] = useState<BriefRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);

  const load = useCallback(async () => {
    try { const r = await fetch('/api/agent/brief').then((x) => x.json()); setRows(r.brief ?? []); }
    catch { /* ignore */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const build = async () => {
    setBuilding(true);
    try {
      const r = await fetch('/api/agent/brief', { method: 'POST' }).then((x) => x.json());
      if (r.error) throw new Error(r.error);
      toast.success(`Brief: ${r.analyzed} stocks (${r.bullish} bullish, ${r.bearish} bearish)`);
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Brief failed'); }
    finally { setBuilding(false); }
  };

  const bullish = rows.filter((r) => r.bias === 'BULLISH');
  const bearish = rows.filter((r) => r.bias === 'BEARISH');

  const Col = ({ title, items, up }: { title: string; items: BriefRow[]; up: boolean }) => (
    <div>
      <div className={`mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider ${up ? 'text-emerald-700' : 'text-rose-600'}`}>
        {up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}{title} ({items.length})
      </div>
      {items.length === 0 ? <p className="text-xs text-[var(--dxp-text-muted)]">none</p> : (
        <ul className="space-y-1">
          {items.slice(0, 8).map((r) => (
            <li key={r.id} className="text-xs">
              <span className="font-mono font-semibold text-[var(--dxp-text)]">{r.symbol.replace('.NS', '')}</span>
              {r.impact != null && <span className="ml-1 text-[10px] text-[var(--dxp-text-muted)]">impact {(r.impact * 100).toFixed(0)}%</span>}
              {r.rationale && <span className="block max-w-[20rem] truncate text-[10px] text-[var(--dxp-text-secondary)]" title={r.rationale}>{r.rationale}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]"><Sunrise className="h-5 w-5 text-[var(--dxp-brand)]" /> Pre-market brief</h3>
          <Button variant="ghost" size="sm" onClick={build} disabled={building}>{building ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}Build now</Button>
        </div>
        <p className="text-xs text-[var(--dxp-text-muted)]">~07:30 IST: overnight/morning news → LLM direction. Gates the intraday sleeve (buy bullish, short bearish).</p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex h-20 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-[var(--dxp-text-muted)]" /></div>
        ) : rows.length === 0 ? (
          <p className="py-4 text-center text-sm text-[var(--dxp-text-muted)]">No brief yet today — it builds at 07:30 IST, or click “Build now”.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Col title="Buy candidates" items={bullish} up />
            <Col title="Short candidates" items={bearish} up={false} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
