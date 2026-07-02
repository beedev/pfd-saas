'use client';

/** Analyst watchlist — search instruments (stock / MF / future) and manage the list. */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';

import { Button, Card, CardHeader, CardContent, Input, Select, Badge } from '@dxp/ui';
import { ArrowLeft, Search, Trash2, Plus, Loader2 } from 'lucide-react';

type AssetClass = 'STOCK' | 'MF' | 'FUTURE';

type Horizon = 'INTRADAY' | 'MULTIDAY';
interface WatchItem {
  id: number;
  assetClass: AssetClass;
  symbol: string;
  schemeCode: string;
  name: string;
  horizon: Horizon;
}
interface SearchHit {
  assetClass: AssetClass;
  symbol?: string;
  schemeCode?: string;
  isin?: string;
  name: string;
  exchange?: string;
}

const CLASS_OPTIONS = [
  { value: 'STOCK', label: 'Stock' },
  { value: 'MF', label: 'Mutual Fund' },
  { value: 'FUTURE', label: 'Future' },
];

// "My Picks" hold horizon — the user picks the stock, the agent times the entry.
const HORIZON_OPTIONS = [
  { value: 'MULTIDAY', label: 'Multi-day (2-3d + 2-3mo hold)' },
  { value: 'INTRADAY', label: 'Intraday (square off same day)' },
];

interface Sleeve { id: number; key: string; name: string }

// Non-stock classes still map to a specific sleeve. STOCK picks all live on the
// single "My Picks" list (STK_WATCH), tagged by horizon.
const SLEEVE_FOR_CLASS: Record<AssetClass, string[]> = {
  STOCK: ['STK_WATCH'],
  FUTURE: ['FUT'],
  MF: ['MF'],
};

export default function WatchlistPage() {
  const [items, setItems] = useState<WatchItem[]>([]);
  const [sleeves, setSleeves] = useState<Sleeve[]>([]);
  const [assetClass, setAssetClass] = useState<AssetClass>('STOCK');
  const [sleeveId, setSleeveId] = useState<number | null>(null);
  const [horizon, setHorizon] = useState<Horizon>('MULTIDAY');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const load = useCallback(async () => {
    const [w, sl] = await Promise.all([
      fetch('/api/agent/watchlist').then((r) => r.json()),
      fetch('/api/agent/sleeves').then((r) => r.json()),
    ]);
    setItems(w.watchlist ?? []);
    setSleeves(sl.sleeves ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Keep the selected sleeve valid for the chosen asset class.
  const eligible = sleeves.filter((s) => SLEEVE_FOR_CLASS[assetClass].includes(s.key));
  useEffect(() => {
    if (!eligible.some((s) => s.id === sleeveId)) setSleeveId(eligible[0]?.id ?? null);
  }, [assetClass, sleeves]); // eslint-disable-line react-hooks/exhaustive-deps

  const search = async () => {
    if (query.trim().length < 2) { toast.info('Type at least 2 characters'); return; }
    setIsSearching(true);
    try {
      const r = await fetch(`/api/agent/watchlist/search?q=${encodeURIComponent(query)}&class=${assetClass}`).then((r) => r.json());
      setHits(r.results ?? []);
    } catch { toast.error('Search failed'); }
    finally { setIsSearching(false); }
  };

  const add = async (hit: SearchHit) => {
    if (!sleeveId) { toast.error('Pick a sleeve first'); return; }
    try {
      const r = await fetch('/api/agent/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...hit, sleeveId, horizon: assetClass === 'STOCK' ? horizon : undefined }),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || 'failed'); }
      toast.success(assetClass === 'STOCK' ? `Added ${hit.name} as a ${horizon === 'INTRADAY' ? 'intraday' : 'multi-day'} pick` : `Added ${hit.name}`);
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed to add'); }
  };

  const remove = async (id: number) => {
    await fetch(`/api/agent/watchlist/${id}`, { method: 'DELETE' });
    await load();
  };

  return (
    <div className="space-y-6">
      <Link href="/investments/analyst" className="inline-flex items-center gap-1 text-sm text-[var(--dxp-text-muted)] hover:text-[var(--dxp-text)]">
        <ArrowLeft className="h-4 w-4" /> Back to analyst
      </Link>
      <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">Watchlist</h1>

      <Card>
        <CardHeader><h3 className="text-base font-bold text-[var(--dxp-text)]">Add instrument</h3></CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="sm:w-40">
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Type</label>
              <Select value={assetClass} onChange={(v) => setAssetClass(v as AssetClass)} options={CLASS_OPTIONS} />
            </div>
            <div className="sm:w-56">
              {assetClass === 'STOCK' ? (
                <>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Hold horizon</label>
                  <Select value={horizon} onChange={(v) => setHorizon(v as Horizon)} options={HORIZON_OPTIONS} />
                </>
              ) : (
                <>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Sleeve</label>
                  <Select
                    value={sleeveId != null ? String(sleeveId) : ''}
                    onChange={(v) => setSleeveId(Number(v))}
                    options={eligible.map((s) => ({ value: String(s.id), label: s.name }))}
                  />
                </>
              )}
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Search</label>
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={assetClass === 'MF' ? 'e.g. Parag Parikh Flexi' : 'e.g. RELIANCE, INFY, GC=F'} onKeyDown={(e) => e.key === 'Enter' && search()} />
            </div>
            <Button variant="primary" onClick={search} disabled={isSearching}>
              {isSearching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}Search
            </Button>
          </div>

          {hits.length > 0 && (
            <ul className="mt-4 space-y-2">
              {hits.map((h, i) => (
                <li key={i} className="flex items-center justify-between rounded border border-[var(--dxp-border-light)] p-2">
                  <div className="min-w-0">
                    <span className="font-semibold text-[var(--dxp-text)]">{h.name}</span>
                    <span className="ml-2 font-mono text-xs text-[var(--dxp-text-muted)]">{h.symbol || h.schemeCode}{h.exchange ? ` · ${h.exchange}` : ''}</span>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => add(h)}><Plus className="mr-1 h-4 w-4" />Add</Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><h3 className="text-base font-bold text-[var(--dxp-text)]">Monitored ({items.length})</h3></CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="py-6 text-center text-[var(--dxp-text-muted)]">Nothing monitored yet.</p>
          ) : (
            <ul className="space-y-2">
              {items.map((it) => (
                <li key={it.id} className="flex items-center justify-between rounded border border-[var(--dxp-border-light)] p-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant="info">{it.assetClass}</Badge>
                    {it.assetClass === 'STOCK' && (
                      <Badge variant={it.horizon === 'INTRADAY' ? 'warning' : 'success'}>{it.horizon === 'INTRADAY' ? 'Intraday' : 'Multi-day'}</Badge>
                    )}
                    <span className="font-semibold text-[var(--dxp-text)]">{it.name}</span>
                    <span className="font-mono text-xs text-[var(--dxp-text-muted)]">{it.symbol || it.schemeCode}</span>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => remove(it.id)}><Trash2 className="h-4 w-4 text-rose-500" /></Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
