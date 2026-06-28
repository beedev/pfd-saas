'use client';

/** Instrument candlestick chart — enter a Yahoo symbol (e.g. RELIANCE.NS) and view candles. */

import { useState, useCallback } from 'react';
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

export default function ChartPage() {
  const [symbol, setSymbol] = useState('RELIANCE.NS');
  const [range, setRange] = useState('1y');
  const [bars, setBars] = useState<Bar[]>([]);
  const [loaded, setLoaded] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const load = useCallback(async () => {
    const sym = symbol.trim();
    if (!sym) { toast.info('Enter a symbol'); return; }
    setIsLoading(true);
    try {
      const r = await fetch(`/api/agent/instrument/ohlc?symbol=${encodeURIComponent(sym)}&range=${range}`).then((r) => r.json());
      if (r.error) throw new Error(r.error);
      setBars(r.bars ?? []);
      setLoaded(sym.toUpperCase());
      if (!(r.bars ?? []).length) toast.info('No data for that symbol');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setIsLoading(false); }
  }, [symbol, range]);

  return (
    <div className="space-y-6">
      <Link href="/investments/analyst" className="inline-flex items-center gap-1 text-sm text-[var(--dxp-text-muted)] hover:text-[var(--dxp-text)]">
        <ArrowLeft className="h-4 w-4" /> Back to analyst
      </Link>
      <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">Candlestick chart</h1>

      <Card>
        <CardContent>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Symbol (Yahoo)</label>
              <Input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="RELIANCE.NS, INFY.NS, GC=F, ^NSEI" onKeyDown={(e) => e.key === 'Enter' && load()} />
            </div>
            <div className="sm:w-40">
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Range</label>
              <Select value={range} onChange={setRange} options={RANGE_OPTIONS} />
            </div>
            <Button variant="primary" onClick={load} disabled={isLoading}>
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
