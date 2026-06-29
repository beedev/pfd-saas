'use client';

/** Candlestick chart (lightweight-charts v5). Imports the lib lazily in an
 *  effect so it never runs during SSR. Bars are native price (rupees). */

import { useEffect, useRef } from 'react';

// Daily bars carry `date` (YYYY-MM-DD); intraday bars carry `time` (epoch sec).
export interface Bar { date?: string; time?: number; open: number; high: number; low: number; close: number }

export function CandleChart({ bars, intraday = false }: { bars: Bar[]; intraday?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current || !bars.length) return;
    let disposed = false;
    let chart: { remove: () => void } | null = null;

    (async () => {
      const { createChart, CandlestickSeries } = await import('lightweight-charts');
      if (disposed || !ref.current) return;
      const c = createChart(ref.current, {
        height: 380,
        layout: { background: { color: 'transparent' }, textColor: '#6b7280' },
        grid: { vertLines: { color: 'rgba(0,0,0,0.06)' }, horzLines: { color: 'rgba(0,0,0,0.06)' } },
        timeScale: { timeVisible: intraday, secondsVisible: false, borderColor: 'rgba(0,0,0,0.1)' },
        rightPriceScale: { borderColor: 'rgba(0,0,0,0.1)' },
      });
      chart = c;
      const series = c.addSeries(CandlestickSeries, {
        upColor: '#059669', downColor: '#e11d48', borderVisible: false,
        wickUpColor: '#059669', wickDownColor: '#e11d48',
      });
      series.setData(bars.map((b) => ({ time: (b.time ?? b.date) as never, open: b.open, high: b.high, low: b.low, close: b.close })));
      c.timeScale().fitContent();
    })();

    return () => { disposed = true; if (chart) chart.remove(); };
  }, [bars, intraday]);

  if (!bars.length) {
    return <div className="flex h-64 items-center justify-center text-sm text-[var(--dxp-text-muted)]">No data — load a symbol.</div>;
  }
  return <div ref={ref} className="w-full" />;
}
