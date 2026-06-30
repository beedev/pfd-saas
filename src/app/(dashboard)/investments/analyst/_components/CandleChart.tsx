'use client';

/**
 * Candlestick chart (lightweight-charts v5). The chart instance is PERSISTED:
 * data updates (15s polls, live ticks) call setData/update WITHOUT refitting, so
 * the user's zoom/pan survive. It refits only on first load and when `resetKey`
 * (symbol/interval/range) changes. Scroll = zoom, drag = pan (library defaults).
 * Intraday time is rendered in IST. Prices are native (rupees).
 */

import { useEffect, useRef } from 'react';

// Daily bars carry `date` (YYYY-MM-DD); intraday bars carry `time` (epoch sec).
export interface Bar { date?: string; time?: number; open: number; high: number; low: number; close: number }
type SeriesLike = { update: (b: Record<string, unknown>) => void; setData: (d: Array<Record<string, unknown>>) => void };
type ChartLike = { remove: () => void; timeScale: () => { fitContent: () => void } };

const toPoint = (b: Bar) => ({ time: (b.time ?? b.date) as never, open: b.open, high: b.high, low: b.low, close: b.close });

export function CandleChart({ bars, intraday = false, liveTick, resetKey }: {
  bars: Bar[]; intraday?: boolean; liveTick?: { price: number } | null; resetKey?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ChartLike | null>(null);
  const seriesRef = useRef<SeriesLike | null>(null);
  const lastBarRef = useRef<Bar | null>(null);
  const fittedRef = useRef(false);
  const barsRef = useRef<Bar[]>(bars);
  barsRef.current = bars;

  // Create the chart once per intraday mode; persisted across data updates.
  useEffect(() => {
    if (!ref.current) return;
    let disposed = false;
    (async () => {
      const { createChart, CandlestickSeries } = await import('lightweight-charts');
      if (disposed || !ref.current) return;
      const istTime = (t: unknown) => new Date((t as number) * 1000).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
      const istFull = (t: unknown) => new Date((t as number) * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
      const c = createChart(ref.current, {
        autoSize: true, height: 380,
        layout: { background: { color: 'transparent' }, textColor: '#6b7280' },
        grid: { vertLines: { color: 'rgba(0,0,0,0.06)' }, horzLines: { color: 'rgba(0,0,0,0.06)' } },
        timeScale: { timeVisible: intraday, secondsVisible: false, borderColor: 'rgba(0,0,0,0.1)', rightOffset: 4, ...(intraday ? { tickMarkFormatter: (t: unknown) => istTime(t) } : {}) },
        rightPriceScale: { borderColor: 'rgba(0,0,0,0.1)' },
        handleScroll: true, handleScale: true, // scroll = zoom, drag = pan
        ...(intraday ? { localization: { timeFormatter: (t: unknown) => istFull(t) } } : {}),
      });
      const series = c.addSeries(CandlestickSeries, { upColor: '#059669', downColor: '#e11d48', borderVisible: false, wickUpColor: '#059669', wickDownColor: '#e11d48' });
      chartRef.current = c as unknown as ChartLike;
      seriesRef.current = series as unknown as SeriesLike;
      fittedRef.current = false;
      if (barsRef.current.length) {
        series.setData(barsRef.current.map(toPoint));
        c.timeScale().fitContent(); fittedRef.current = true;
        lastBarRef.current = { ...barsRef.current[barsRef.current.length - 1] };
      }
    })();
    return () => { disposed = true; chartRef.current?.remove(); chartRef.current = null; seriesRef.current = null; lastBarRef.current = null; };
  }, [intraday]);

  // New symbol/interval/range → allow one refit on the next data update.
  useEffect(() => { fittedRef.current = false; }, [resetKey]);

  // Data update: setData without refit (preserves zoom/pan); fit once after reset.
  useEffect(() => {
    const s = seriesRef.current;
    if (!s || !bars.length) return;
    s.setData(bars.map(toPoint));
    lastBarRef.current = { ...bars[bars.length - 1] };
    if (!fittedRef.current) { chartRef.current?.timeScale().fitContent(); fittedRef.current = true; }
  }, [bars]);

  // Live tick → update the forming (last) candle in place, no redraw.
  useEffect(() => {
    const s = seriesRef.current, lb = lastBarRef.current;
    if (!liveTick || !s || !lb) return;
    lb.close = liveTick.price;
    if (liveTick.price > lb.high) lb.high = liveTick.price;
    if (liveTick.price < lb.low) lb.low = liveTick.price;
    s.update(toPoint(lb));
  }, [liveTick]);

  return (
    <div className="relative w-full" style={{ minHeight: 380 }}>
      <div ref={ref} className="w-full" />
      {!bars.length && <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--dxp-text-muted)]">No data — load a symbol.</div>}
    </div>
  );
}
