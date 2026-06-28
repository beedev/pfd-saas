'use client';

/**
 * Equity vs benchmark curve. Both series are rebased to 100 at the first date
 * they share so a portfolio (₹) and an index level are directly comparable.
 */

import { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
} from 'recharts';

interface Point {
  date: string;
  price: number; // paisa (equity) or index level ×100 (benchmark)
}

export function EquityCurveChart({
  equity,
  benchmark,
}: {
  equity: Point[];
  benchmark: Point[];
}) {
  const data = useMemo(() => {
    const benchByDate = new Map(benchmark.map((b) => [b.date, b.price]));
    const eqBase = equity[0]?.price || 0;
    let benchBase = 0;
    for (const e of equity) {
      const b = benchByDate.get(e.date);
      if (b) { benchBase = b; break; }
    }
    return equity.map((e) => {
      const b = benchByDate.get(e.date);
      return {
        date: e.date.slice(5), // MM-DD
        Portfolio: eqBase ? Number(((e.price / eqBase) * 100).toFixed(2)) : 100,
        Benchmark: b && benchBase ? Number(((b / benchBase) * 100).toFixed(2)) : null,
      };
    });
  }, [equity, benchmark]);

  if (!equity.length) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-[var(--dxp-text-muted)]">
        No equity history yet — run the agent to start the curve.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--dxp-border-light)" />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} domain={['auto', 'auto']} />
        <Tooltip formatter={(v) => `${v} (base 100)`} />
        <Legend />
        <Line type="monotone" dataKey="Portfolio" stroke="#059669" dot={false} strokeWidth={2} />
        <Line type="monotone" dataKey="Benchmark" stroke="#6b7280" dot={false} strokeWidth={1.5} strokeDasharray="4 3" connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}
