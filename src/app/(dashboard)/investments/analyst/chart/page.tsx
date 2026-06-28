'use client';

/**
 * Instrument candlestick chart — type a company name OR a ticker and pick from
 * live search (Yahoo), or enter an exact Yahoo symbol (RELIANCE.NS, ^NSEI, GC=F)
 * and hit Load. Bare Indian tickers auto-retry with a .NS suffix.
 */

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';

import { Button, Card, CardHeader, CardContent, Input, Select } from '@dxp/ui';
import { ArrowLeft, Loader2, Search } from 'lucide-react';
import { CandleChart, type Bar } from '../_components/CandleChart';

const RANGE_OPTIONS = [
  { value: '3mo', label: '3 months' },
  { value: '6mo', label: '6 months' },
  { value: '1y', label: '1 year' },
  { value: '2y', label: '2 years' },
  { value: '5y', label: '5 years' },
];

interface Hit { symbol: string; name: string; exchange?: string; type?: string }
const isExactSymbol = (s: string) => /[.=^]/.test(s); // already a Yahoo symbol form

export default function ChartPage() {
  const [symbol, setSymbol] = useState('RELIANCE.NS');
  const [range, setRange] = useState('1y');
  const [bars, setBars] = useState<Bar[]>([]);
  const [loaded, setLoaded] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [hits, setHits] = useState<Hit[]>([]);
  const [showHits, setShowHits] = useState(false);

  // Type-ahead: search by name/ticker (skip when it's already an exact symbol).
  useEffect(() => {
    const q = symbol.trim();
    if (q.length < 2 || isExactSymbol(q)) { setHits([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/agent/watchlist/search?q=${encodeURIComponent(q)}&class=STOCK`).then((r) => r.json());
        setHits(r.results ?? []);
        setShowHits(true);
      } catch { setHits([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [symbol]);

  const load = useCallback(async (override?: string) => {
    let sym = (override ?? symbol).trim();
    if (!sym) { toast.info('Enter a symbol or company name'); return; }
    setShowHits(false);
    setIsLoading(true);
    try {
      let r = await fetch(`/api/agent/instrument/ohlc?symbol=${encodeURIComponent(sym)}&range=${range}`).then((r) => r.json());
      if (r.error) throw new Error(r.error);
      let resultBars: Bar[] = r.bars ?? [];
      // Bare Indian ticker with no data → retry on the NSE suffix.
      if (!resultBars.length && !isExactSymbol(sym)) {
        const alt = `${sym.toUpperCase()}.NS`;
        const r2 = await fetch(`/api/agent/instrument/ohlc?symbol=${encodeURIComponent(alt)}&range=${range}`).then((r) => r.json());
        if ((r2.bars ?? []).length) { resultBars = r2.bars; sym = alt; }
      }
      setBars(resultBars);
      setLoaded(sym.toUpperCase());
      if (!resultBars.length) toast.info('No data for that symbol — try the search suggestions');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setIsLoading(false); }
  }, [symbol, range]);

  const pick = (h: Hit) => { setSymbol(h.symbol); setShowHits(false); setHits([]); load(h.symbol); };

  return (
    <div className="space-y-6">
      <Link href="/investments/analyst" className="inline-flex items-center gap-1 text-sm text-[var(--dxp-text-muted)] hover:text-[var(--dxp-text)]">
        <ArrowLeft className="h-4 w-4" /> Back to analyst
      </Link>
      <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">Candlestick chart</h1>

      <Card>
        <CardContent>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="relative flex-1">
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Company name or symbol</label>
              <Input
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                onFocus={() => hits.length && setShowHits(true)}
                onBlur={() => setTimeout(() => setShowHits(false), 150)}
                placeholder="Type a name (Reliance, Tata Motors) or a symbol (^NSEI, GC=F)"
                onKeyDown={(e) => e.key === 'Enter' && load()}
              />
              {showHits && hits.length > 0 && (
                <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded border border-[var(--dxp-border-light)] bg-[var(--dxp-surface)] shadow-lg">
                  {hits.map((h) => (
                    <li key={h.symbol}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-[var(--dxp-bg)]"
                        onMouseDown={(e) => { e.preventDefault(); pick(h); }}
                      >
                        <span className="min-w-0">
                          <span className="font-mono font-semibold text-[var(--dxp-text)]">{h.symbol}</span>
                          <span className="ml-2 truncate text-xs text-[var(--dxp-text-muted)]">{h.name}</span>
                        </span>
                        <span className="shrink-0 text-[10px] uppercase tracking-wider text-[var(--dxp-text-muted)]">{h.type || h.exchange}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="sm:w-40">
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Range</label>
              <Select value={range} onChange={setRange} options={RANGE_OPTIONS} />
            </div>
            <Button variant="primary" onClick={() => load()} disabled={isLoading}>
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}Load
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><h3 className="text-base font-bold text-[var(--dxp-text)]">{loaded || 'Chart'}</h3></CardHeader>
        <CardContent><CandleChart bars={bars} /></CardContent>
      </Card>
    </div>
  );
}
