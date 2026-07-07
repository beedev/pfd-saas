'use client';

/**
 * Watchlist = the 2-3 month book (single home for the swing lifecycle). Picks flow
 * in as "Going to buy", get bought → flip to "Held" (split: Added today vs existing).
 * Absorbs the retired Daily Picks page: the algo scorecard sits on top and today's
 * intraday signals show compactly below. Read-only view over the pipeline's data.
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button, Card, CardHeader, CardContent, Input, Badge } from '@dxp/ui';
import { ArrowLeft, Search, Plus, Loader2, RefreshCw, TrendingUp, Eye, Zap } from 'lucide-react';

interface Held { symbol: string; name: string; sector: string | null; entryPrice: number | null; currentPrice: number | null; gainPct: number | null; target: number | null; stop: number | null; entryDate: string; daysHeld: number; quantity: number; addedToday: boolean }
interface ToBuy { symbol: string; name: string; sector: string | null; source: string; score: number | null; suggestedBuy: number | null; target: number | null; stop: number | null; currentPrice: number | null }
interface SearchHit { assetClass: 'STOCK' | 'MF' | 'FUTURE'; symbol?: string; schemeCode?: string; isin?: string; name: string; exchange?: string }
interface Score { closed?: { trades: number; winRatePct: number; avgReturnPct: number; totalPnlRupees: number }; open?: { positions: number; unrealizedRupees: number } }

const inr = (n: number | null) => (n == null ? '—' : `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`);
const sec = (s: string | null) => (s && s !== 'OTHER' ? s : '—');

function HeldRow({ h }: { h: Held }) {
  return (
    <tr className="border-b border-slate-100">
      <td className="py-2 pr-3"><Link href={`/investments/analyst/chart?symbol=${h.symbol}`} className="font-semibold text-indigo-700 hover:underline">{h.name}</Link> <span className="text-xs text-slate-400">×{h.quantity}</span></td>
      <td className="pr-3 text-xs text-slate-500">{sec(h.sector)}</td>
      <td className="pr-3 text-xs text-slate-500">{h.entryDate} <span className="text-slate-400">({h.daysHeld}d)</span></td>
      <td className="pr-3 text-right">{inr(h.entryPrice)}</td>
      <td className="pr-3 text-right">{inr(h.currentPrice)}</td>
      <td className={`pr-3 text-right font-semibold ${h.gainPct == null ? 'text-slate-400' : h.gainPct >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{h.gainPct == null ? '—' : `${h.gainPct >= 0 ? '+' : ''}${h.gainPct}%`}</td>
      <td className="pr-3 text-right text-xs text-slate-500">{inr(h.target)} / {inr(h.stop)}</td>
    </tr>
  );
}

function BuyRow({ p }: { p: ToBuy }) {
  return (
    <tr className="border-b border-slate-100">
      <td className="py-2 pr-3"><Link href={`/investments/analyst/chart?symbol=${p.symbol}`} className="font-semibold text-indigo-700 hover:underline">{p.name}</Link></td>
      <td className="pr-3 text-xs text-slate-500">{sec(p.sector)}</td>
      <td className="pr-3 text-right">{p.score != null ? <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[11px] font-bold text-indigo-700">{p.score}</span> : '—'}</td>
      <td className="pr-3 text-right">{inr(p.suggestedBuy)}</td>
      <td className="pr-3 text-right text-emerald-600">{inr(p.target)}</td>
      <td className="pr-3 text-right text-rose-500">{inr(p.stop)}</td>
      <td className="pr-3 text-xs text-slate-400">{p.source}</td>
    </tr>
  );
}

const HeldHead = () => (
  <thead><tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-500"><th className="py-2 pr-3">Name</th><th className="pr-3">Sector</th><th className="pr-3">Added</th><th className="pr-3 text-right">Entry</th><th className="pr-3 text-right">Current</th><th className="pr-3 text-right">Growth/Loss</th><th className="pr-3 text-right">Tgt / Stop</th></tr></thead>
);
const BuyHead = () => (
  <thead><tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-500"><th className="py-2 pr-3">Name</th><th className="pr-3">Sector</th><th className="pr-3 text-right">Score</th><th className="pr-3 text-right">Buy ~</th><th className="pr-3 text-right">Target</th><th className="pr-3 text-right">Stop</th><th className="pr-3">Src</th></tr></thead>
);

export default function WatchlistPage() {
  const [held, setHeld] = useState<Held[]>([]);
  const [toBuy, setToBuy] = useState<ToBuy[]>([]);
  const [intraday, setIntraday] = useState<ToBuy[]>([]);
  const [score, setScore] = useState<Score | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [w, s] = await Promise.all([
        fetch('/api/agent/watchlist').then((r) => r.json()),
        fetch('/api/agent/scorecard').then((r) => r.json()).catch(() => null),
      ]);
      setHeld(w.held ?? []); setToBuy(w.toBuy ?? []); setIntraday(w.intraday ?? []); setScore(s);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const search = async () => {
    if (query.trim().length < 2) { toast.info('Type at least 2 characters'); return; }
    setSearching(true);
    try { const r = await fetch(`/api/agent/watchlist/search?q=${encodeURIComponent(query)}&class=STOCK`).then((r) => r.json()); setHits(r.results ?? []); }
    catch { toast.error('Search failed'); } finally { setSearching(false); }
  };
  const addManual = async (hit: SearchHit) => {
    try {
      const r = await fetch('/api/agent/watchlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...hit, horizon: 'MULTIDAY', sleeveId: null }) });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || 'failed'); }
      toast.success(`Added ${hit.name} to "going to buy"`); setHits([]); setQuery(''); await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
  };

  const addedToday = held.filter((h) => h.addedToday);
  const existing = held.filter((h) => !h.addedToday);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <Link href="/investments/analyst" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" />Analyst</Link>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh</Button>
      </div>
      <h1 className="text-2xl font-bold text-slate-900">Watchlist — 2-3 month book</h1>
      <p className="mt-1 text-sm text-slate-500">Today&apos;s picks arrive in <b>Going to buy</b>, get bought, then flip to <b>Held</b> (fresh entries split from existing). Algo scorecard on top; today&apos;s intraday signals below. Driven by the 07:35 pipeline.</p>

      {/* Algo scorecard — folded in from the retired Daily Picks page */}
      {score?.closed && score.closed.trades > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm">
          <span className="font-semibold text-slate-800">Algo score (₹20K/pick)</span>
          <span>{score.closed.trades} closed · <b>{score.closed.winRatePct.toFixed(0)}%</b> win</span>
          <span>avg <b className={score.closed.avgReturnPct >= 0 ? 'text-emerald-600' : 'text-rose-500'}>{score.closed.avgReturnPct >= 0 ? '+' : ''}{score.closed.avgReturnPct}%</b></span>
          <span>realized <b className={score.closed.totalPnlRupees >= 0 ? 'text-emerald-600' : 'text-rose-500'}>{inr(score.closed.totalPnlRupees)}</b></span>
          {score.open && score.open.positions > 0 && <span className="text-slate-500">{score.open.positions} open · unrealized {inr(score.open.unrealizedRupees)}</span>}
        </div>
      )}

      {loading ? <div className="mt-10 flex justify-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div> : (
        <div className="mt-6 space-y-6">
          <Card>
            <CardHeader><div className="flex items-center gap-2 font-semibold text-slate-800"><TrendingUp className="h-4 w-4 text-emerald-600" /> Held <Badge variant="default">{held.length}</Badge></div></CardHeader>
            <CardContent>
              {held.length === 0 ? <p className="py-4 text-center text-sm text-slate-400">Nothing held yet — buys land here once the pipeline executes.</p> : (
                <div className="space-y-4">
                  {addedToday.length > 0 && (
                    <div className="overflow-x-auto">
                      <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-emerald-600">Added today · {addedToday.length}</div>
                      <table className="w-full text-sm"><HeldHead /><tbody>{addedToday.map((h) => <HeldRow key={h.symbol} h={h} />)}</tbody></table>
                    </div>
                  )}
                  <div className="overflow-x-auto">
                    {addedToday.length > 0 && <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Held (existing) · {existing.length}</div>}
                    <table className="w-full text-sm"><HeldHead /><tbody>{existing.map((h) => <HeldRow key={h.symbol} h={h} />)}</tbody></table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><div className="flex items-center gap-2 font-semibold text-slate-800"><Eye className="h-4 w-4 text-amber-500" /> Going to buy <Badge variant="default">{toBuy.length}</Badge></div></CardHeader>
            <CardContent>
              {toBuy.length === 0 ? <p className="py-4 text-center text-sm text-slate-400">No pending picks. Today&apos;s 07:35 run will populate this.</p> : (
                <div className="overflow-x-auto"><table className="w-full text-sm"><BuyHead /><tbody>{toBuy.map((p) => <BuyRow key={p.symbol} p={p} />)}</tbody></table></div>
              )}
            </CardContent>
          </Card>

          {intraday.length > 0 && (
            <Card>
              <CardHeader><div className="flex items-center gap-2 font-semibold text-slate-800"><Zap className="h-4 w-4 text-amber-500" /> Intraday signals · today <Badge variant="default">{intraday.length}</Badge></div></CardHeader>
              <CardContent><div className="overflow-x-auto"><table className="w-full text-sm"><BuyHead /><tbody>{intraday.map((p) => <BuyRow key={p.symbol} p={p} />)}</tbody></table></div></CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><span className="text-sm font-semibold text-slate-700">Add a name manually (optional)</span></CardHeader>
            <CardContent>
              <div className="flex gap-2">
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. RELIANCE, TATAMOTORS" onKeyDown={(e) => e.key === 'Enter' && search()} />
                <Button variant="secondary" onClick={search} disabled={searching}>{searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}</Button>
              </div>
              {hits.length > 0 && (
                <ul className="mt-3 space-y-2">{hits.map((h, i) => (
                  <li key={i} className="flex items-center justify-between rounded border border-slate-200 p-2">
                    <span className="text-sm"><b>{h.name}</b> <span className="font-mono text-xs text-slate-400">{h.symbol}</span></span>
                    <Button variant="ghost" size="sm" onClick={() => addManual(h)}><Plus className="mr-1 h-4 w-4" />Add</Button>
                  </li>
                ))}</ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
