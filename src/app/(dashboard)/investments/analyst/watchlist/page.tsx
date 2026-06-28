'use client';

/** Analyst watchlist — search instruments (stock / MF / future) and manage the list. */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';

import { Button, Card, CardHeader, CardContent, Input, Select, Badge } from '@dxp/ui';
import { ArrowLeft, Search, Trash2, Plus, Loader2 } from 'lucide-react';

type AssetClass = 'STOCK' | 'MF' | 'FUTURE';

interface WatchItem {
  id: number;
  assetClass: AssetClass;
  symbol: string;
  schemeCode: string;
  name: string;
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

export default function WatchlistPage() {
  const [items, setItems] = useState<WatchItem[]>([]);
  const [assetClass, setAssetClass] = useState<AssetClass>('STOCK');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch('/api/agent/watchlist').then((r) => r.json());
    setItems(r.watchlist ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

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
    try {
      const r = await fetch('/api/agent/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(hit),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || 'failed'); }
      toast.success(`Added ${hit.name}`);
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
