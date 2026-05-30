'use client';

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Button,
  Card,
  CardHeader,
  CardContent,
  StatsDisplay,
  DataTable,
  type Column,
} from '@dxp/ui';
import { Camera, Loader2, TrendingUp } from 'lucide-react';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';

interface HistoryRow {
  date: string;
  stocksPaisa: number;
  mfPaisa: number;
  goldPaisa: number;
  npsPaisa: number;
  pfPaisa: number;
  realEstatePaisa: number;
  insurancePaisa: number;
  liabilitiesPaisa: number;
  netWorthPaisa: number;
}

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(
    paisa / 100
  );

const formatINRShort = (paisa: number) => {
  const lakhs = paisa / 10000000;
  if (Math.abs(lakhs) >= 1) return `₹${lakhs.toFixed(1)}Cr`;
  const l = paisa / 100000;
  if (Math.abs(l) >= 1) return `₹${(l / 100).toFixed(1)}L`;
  return `₹${(paisa / 100).toFixed(0)}`;
};

export default function NetWorthHistoryPage() {
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCapturing, setIsCapturing] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const r = await fetch('/api/networth/history?months=24').then((r) => r.json());
      setHistory(r.history || []);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-capture if no snapshot for today
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    const hasToday = history.some((h) => h.date === today);
    if (!hasToday && history.length >= 0 && !isLoading && !isCapturing) {
      // Only once — guard via state
      void capture(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  const capture = async (silent = false) => {
    setIsCapturing(true);
    try {
      const r = await fetch('/api/networth/snapshot', { method: 'POST' });
      if (!r.ok) throw new Error('Snapshot failed');
      if (!silent) toast.success('Snapshot captured');
      await load();
    } catch (e) {
      if (!silent) toast.error('Failed to capture snapshot');
      console.error(e);
    } finally {
      setIsCapturing(false);
    }
  };

  const current = history.length > 0 ? history[history.length - 1].netWorthPaisa : 0;

  // 30-day change
  const today = new Date();
  const monthAgoIso = new Date(today.getTime() - 30 * 86400000).toISOString().slice(0, 10);
  const thirtyAgo = history.find((h) => h.date >= monthAgoIso) || history[0];
  const change30d = thirtyAgo ? current - thirtyAgo.netWorthPaisa : 0;

  // YTD change
  const ytdStart = `${today.getFullYear()}-01-01`;
  const ytdRow = history.find((h) => h.date >= ytdStart) || history[0];
  const ytdChange = ytdRow ? current - ytdRow.netWorthPaisa : 0;

  const allTimeHigh = history.reduce((max, h) => Math.max(max, h.netWorthPaisa), 0);

  const chartData = history.map((h) => ({
    date: h.date,
    netWorth: h.netWorthPaisa / 100,
    stocks: h.stocksPaisa / 100,
    mf: h.mfPaisa / 100,
    gold: h.goldPaisa / 100,
    nps: h.npsPaisa / 100,
    pf: h.pfPaisa / 100,
    re: h.realEstatePaisa / 100,
    ins: h.insurancePaisa / 100,
  }));

  // Monthly snapshot table — pick last row of each month
  const monthly: HistoryRow[] = [];
  const seen = new Set<string>();
  for (const h of [...history].reverse()) {
    const key = h.date.slice(0, 7);
    if (!seen.has(key)) {
      seen.add(key);
      monthly.unshift(h);
    }
  }
  const monthlyWithDelta = monthly.map((row, idx) => ({
    ...row,
    momChange: idx > 0 ? row.netWorthPaisa - monthly[idx - 1].netWorthPaisa : 0,
  }));

  const columns: Column<typeof monthlyWithDelta[number]>[] = [
    { key: 'date', header: 'Date' },
    {
      key: 'netWorthPaisa',
      header: 'Net Worth',
      render: (_v, r) => <span className="font-mono font-bold">{formatINR(r.netWorthPaisa)}</span>,
    },
    {
      key: 'momChange',
      header: 'MoM Change',
      render: (_v, r) => (
        <span className={`font-mono ${r.momChange >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
          {r.momChange >= 0 ? '+' : ''}
          {formatINR(r.momChange)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">Net Worth History</h1>
          <p className="text-[var(--dxp-text-secondary)]">
            Time-series snapshots of your total net worth
          </p>
        </div>
        <Button variant="primary" onClick={() => capture(false)} disabled={isCapturing}>
          {isCapturing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
          Capture snapshot
        </Button>
      </div>

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--dxp-text-muted)]" />
        </div>
      ) : history.length === 0 ? (
        <Card>
          <CardContent>
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <TrendingUp className="h-12 w-12 text-[var(--dxp-text-muted)]" />
              <p className="text-[var(--dxp-text-muted)]">No snapshots yet — capture one to get started.</p>
              <Button variant="primary" onClick={() => capture(false)} disabled={isCapturing}>
                <Camera className="mr-2 h-4 w-4" /> Capture now
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <StatsDisplay
            currency="INR"
            locale="en-IN"
            columns={4}
            stats={[
              { label: 'Current Net Worth', value: current / 100, format: 'currency' },
              { label: 'Change (30d)', value: change30d / 100, format: 'currency' },
              { label: 'Change (YTD)', value: ytdChange / 100, format: 'currency' },
              { label: 'All-time High', value: allTimeHigh / 100, format: 'currency' },
            ]}
          />

          <Card>
            <CardHeader>
              <h3 className="text-base font-bold text-[var(--dxp-text)]">Net worth over time</h3>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(v) => formatINRShort(v * 100)} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={((v: unknown) => formatINR(Number(v) * 100)) as never} />
                    <Line type="monotone" dataKey="netWorth" stroke="#2563eb" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="text-base font-bold text-[var(--dxp-text)]">Composition by asset class</h3>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(v) => formatINRShort(v * 100)} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={((v: unknown) => formatINR(Number(v) * 100)) as never} />
                    <Legend />
                    <Area type="monotone" dataKey="stocks" stackId="1" stroke="#2563eb" fill="#3b82f6" />
                    <Area type="monotone" dataKey="mf" stackId="1" stroke="#10b981" fill="#34d399" />
                    <Area type="monotone" dataKey="gold" stackId="1" stroke="#f59e0b" fill="#fbbf24" />
                    <Area type="monotone" dataKey="nps" stackId="1" stroke="#8b5cf6" fill="#a78bfa" />
                    <Area type="monotone" dataKey="pf" stackId="1" stroke="#0ea5e9" fill="#38bdf8" />
                    <Area type="monotone" dataKey="re" stackId="1" stroke="#f97316" fill="#fb923c" />
                    <Area type="monotone" dataKey="ins" stackId="1" stroke="#ec4899" fill="#f472b6" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="text-base font-bold text-[var(--dxp-text)]">Monthly snapshots</h3>
            </CardHeader>
            <CardContent>
              <DataTable columns={columns} data={monthlyWithDelta} emptyMessage="No snapshots" />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
