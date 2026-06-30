'use client';

/**
 * Instrument candlestick chart. Type a company name OR ticker and pick from live
 * search, or enter an exact Yahoo symbol. Two modes:
 *   • Daily — historical daily candles over a range.
 *   • Live (intraday) — today's 5-min candles + a polled live price banner and,
 *     for NSE stocks in market hours, a Depth-of-Market (order book) panel.
 * Feeds are polled (NSE ~10s, Yahoo delayed) — not a true tick stream.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';

import { Button, Card, CardHeader, CardContent, Input, Select, Badge } from '@dxp/ui';
import { ArrowLeft, Loader2, Search, Radio } from 'lucide-react';
import { CandleChart, type Bar } from '../_components/CandleChart';
import { DepthPanel, type Depth } from '../_components/DepthPanel';

const RANGE_OPTIONS = [
  { value: '3mo', label: '3 months' }, { value: '6mo', label: '6 months' },
  { value: '1y', label: '1 year' }, { value: '2y', label: '2 years' }, { value: '5y', label: '5 years' },
];
// Intraday granularity for live mode — today, minute-by-minute and coarser.
const INTERVAL_OPTIONS = [
  { value: '1m', label: '1 minute' }, { value: '5m', label: '5 minutes' }, { value: '15m', label: '15 minutes' },
];

interface Hit { symbol: string; name: string; exchange?: string; type?: string }
interface Live { marketOpen: boolean; source?: string; asOf?: number | null; ltpPaisa: number | null; changePct?: number | null; depth?: Depth | null; depthNote?: string }
const isExactSymbol = (s: string) => /[.=^]/.test(s);
const rupee = (p: number) => '₹' + (p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const clock = (sec?: number | null) => (sec ? new Date(sec * 1000).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—');

export default function ChartPage() {
  const [symbol, setSymbol] = useState('RELIANCE.NS');
  const [range, setRange] = useState('1y');
  const [live, setLive] = useState(false);
  const [bars, setBars] = useState<Bar[]>([]);
  const [loaded, setLoaded] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [hits, setHits] = useState<Hit[]>([]);
  const [showHits, setShowHits] = useState(false);
  const [liveData, setLiveData] = useState<Live | null>(null);
  const [liveTick, setLiveTick] = useState<{ price: number } | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [liveInterval, setLiveInterval] = useState('1m');
  const loadedRef = useRef('');

  // Type-ahead search (skip exact symbols).
  useEffect(() => {
    const q = symbol.trim();
    if (q.length < 2 || isExactSymbol(q)) { setHits([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/agent/watchlist/search?q=${encodeURIComponent(q)}&class=STOCK`).then((r) => r.json());
        setHits(r.results ?? []); setShowHits(true);
      } catch { setHits([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [symbol]);

  const loadCandles = useCallback(async (sym: string, useLive: boolean) => {
    const liveQs = (s: string) => `symbol=${encodeURIComponent(s)}&interval=${liveInterval}`;
    const histQs = (s: string) => `symbol=${encodeURIComponent(s)}&range=${range}`;
    const qs = useLive ? liveQs(sym) : histQs(sym);
    const r = await fetch(`/api/agent/instrument/ohlc?${qs}`).then((r) => r.json());
    let out: Bar[] = r.bars ?? [];
    if (!out.length && !isExactSymbol(sym)) { // bare Indian ticker → retry .NS
      const alt = `${sym.toUpperCase()}.NS`;
      const r2 = await fetch(`/api/agent/instrument/ohlc?${useLive ? liveQs(alt) : histQs(alt)}`).then((r) => r.json());
      if ((r2.bars ?? []).length) { out = r2.bars; return { bars: out, sym: alt }; }
    }
    return { bars: out, sym };
  }, [range, liveInterval]);

  const load = useCallback(async (override?: string) => {
    const want = (override ?? symbol).trim();
    if (!want) { toast.info('Enter a symbol or company name'); return; }
    setShowHits(false); setIsLoading(true);
    try {
      const { bars: out, sym } = await loadCandles(want, live);
      setBars(out); setLoaded(sym.toUpperCase()); loadedRef.current = sym.toUpperCase();
      if (!out.length) toast.info(live ? 'No intraday data (market may be closed)' : 'No data — try the search suggestions');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setIsLoading(false); }
  }, [symbol, live, loadCandles]);

  // Live polling: price banner + DOM + refreshing 5-min candles, every 15s.
  useEffect(() => {
    if (!live || !loaded) { setLiveData(null); return; }
    let stop = false;
    const tick = async () => {
      try {
        const d = await fetch(`/api/agent/instrument/live?symbol=${encodeURIComponent(loaded)}`).then((r) => r.json());
        if (!stop) setLiveData(d);
        const { bars: out } = await loadCandles(loaded, true);
        if (!stop && out.length) setBars(out);
      } catch { /* keep last */ }
    };
    tick();
    const id = setInterval(tick, 15000);
    return () => { stop = true; clearInterval(id); };
  }, [live, loaded, loadCandles]);

  // Live STREAM (Yahoo websocket via server SSE): push ticks → price banner +
  // the forming candle update in real time (no waiting for the 15s poll).
  useEffect(() => {
    if (!live || !loaded) { setStreaming(false); setLiveTick(null); return; }
    const es = new EventSource(`/api/agent/instrument/stream?symbol=${encodeURIComponent(loaded)}`);
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data) as { pricePaisa?: number; changePct?: number | null; type?: string };
        if (d.type === 'open') { setStreaming(true); return; }
        if (typeof d.pricePaisa === 'number') {
          setLiveTick({ price: d.pricePaisa / 100 });
          setLiveData((prev) => ({ ...(prev ?? { marketOpen: true }), ltpPaisa: d.pricePaisa!, changePct: d.changePct ?? prev?.changePct ?? null, source: 'YAHOO·stream', asOf: Math.floor(Date.now() / 1000) }));
        }
      } catch { /* ignore */ }
    };
    es.onerror = () => setStreaming(false);
    return () => { es.close(); setStreaming(false); };
  }, [live, loaded]);

  const pick = (h: Hit) => { setSymbol(h.symbol); setShowHits(false); setHits([]); load(h.symbol); };

  const up = (liveData?.changePct ?? 0) >= 0;

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
              <Input value={symbol} onChange={(e) => setSymbol(e.target.value)}
                onFocus={() => hits.length && setShowHits(true)} onBlur={() => setTimeout(() => setShowHits(false), 150)}
                placeholder="Reliance, Tata Motors, ^NSEI, GC=F" onKeyDown={(e) => e.key === 'Enter' && load()} />
              {showHits && hits.length > 0 && (
                <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded border border-[var(--dxp-border-light)] bg-[var(--dxp-surface)] shadow-lg">
                  {hits.map((h) => (
                    <li key={h.symbol}>
                      <button type="button" className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-[var(--dxp-bg)]" onMouseDown={(e) => { e.preventDefault(); pick(h); }}>
                        <span className="min-w-0"><span className="font-mono font-semibold text-[var(--dxp-text)]">{h.symbol}</span><span className="ml-2 truncate text-xs text-[var(--dxp-text-muted)]">{h.name}</span></span>
                        <span className="shrink-0 text-[10px] uppercase tracking-wider text-[var(--dxp-text-muted)]">{h.type || h.exchange}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="sm:w-40">
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">{live ? 'Interval' : 'Range'}</label>
              {live
                ? <Select value={liveInterval} onChange={setLiveInterval} options={INTERVAL_OPTIONS} />
                : <Select value={range} onChange={setRange} options={RANGE_OPTIONS} />}
            </div>
            <Button variant={live ? 'primary' : 'secondary'} onClick={() => setLive((v) => !v)} title="Live intraday (streaming candles + order book)">
              <Radio className={`mr-2 h-4 w-4 ${live ? 'animate-pulse' : ''}`} />{live ? 'Live: on' : 'Live'}
            </Button>
            <Button variant="primary" onClick={() => load()} disabled={isLoading}>
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}Load
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Live price banner */}
      {live && liveData && liveData.ltpPaisa != null && (
        <Card>
          <CardContent>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <div>
                <span className="font-mono text-2xl font-bold text-[var(--dxp-text)]">{rupee(liveData.ltpPaisa)}</span>
                {liveData.changePct != null && <span className={`ml-2 font-mono text-sm font-semibold ${up ? 'text-emerald-700' : 'text-rose-600'}`}>{up ? '▲' : '▼'} {Math.abs(liveData.changePct).toFixed(2)}%</span>}
              </div>
              <Badge variant={liveData.marketOpen ? 'success' : 'warning'}>{liveData.marketOpen ? 'Market open' : 'Market closed'}</Badge>
              {streaming && <Badge variant="info" className="animate-pulse">● streaming</Badge>}
              <span className="text-xs text-[var(--dxp-text-muted)]">source {liveData.source ?? '—'} · {clock(liveData.asOf)} · {streaming ? 'live ticks' : 'polled ~15s'}</span>
            </div>
          </CardContent>
        </Card>
      )}

      <div className={live ? 'grid gap-4 lg:grid-cols-3' : ''}>
        <Card className={live ? 'lg:col-span-2' : ''}>
          <CardHeader>
            <h3 className="text-base font-bold text-[var(--dxp-text)]">{loaded || 'Chart'}{live ? ` · ${INTERVAL_OPTIONS.find((o) => o.value === liveInterval)?.label}` : ''}</h3>
            <p className="text-xs text-[var(--dxp-text-muted)]">Scroll to zoom · drag to pan{live ? ' · candle updates live' : ''}</p>
          </CardHeader>
          <CardContent><CandleChart bars={bars} intraday={live} liveTick={liveTick} resetKey={`${loaded}|${live ? liveInterval : range}`} /></CardContent>
        </Card>
        {live && (
          <Card>
            <CardHeader><h3 className="text-base font-bold text-[var(--dxp-text)]">Depth of market</h3></CardHeader>
            <CardContent><DepthPanel depth={liveData?.depth ?? null} note={liveData?.depthNote} /></CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
