'use client';

/**
 * Analyst (Paper) — dashboard: portfolio value + equity curve vs benchmark,
 * open positions, recent agent decisions w/ rationale, and a manual "Run now".
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';

import {
  Button,
  Card,
  CardHeader,
  CardContent,
  Badge,
  StatsDisplay,
  DataTable,
  type Column,
} from '@dxp/ui';
import { Bot, Play, Loader2, ListPlus, Settings } from 'lucide-react';

import { Disclaimer } from './_components/Disclaimer';
import { EquityCurveChart } from './_components/EquityCurveChart';

interface Summary {
  equityPaisa: number;
  cashPaisa: number;
  positionsValuePaisa: number;
  totalPnlPaisa: number;
  unrealizedPnlPaisa: number;
  returnPct: number;
  openPositions: number;
}
interface Position {
  id: number;
  assetClass: string;
  symbol: string;
  name: string;
  side: string;
  quantity: number;
  avgPricePaisa: number;
  lastPricePaisa: number | null;
  marketValuePaisa: number | null;
  unrealizedPnlPaisa: number | null;
}
interface Decision {
  id: number;
  action: string;
  assetClass: string;
  symbol: string;
  name: string;
  quantity: number | null;
  amountPaisa: number | null;
  rationale: string | null;
  confidence: string | null;
}
interface CurvePoint { date: string; price: number }

const inr = (paisa: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(paisa / 100);

const actionVariant = (a: string): 'success' | 'warning' | 'info' =>
  a === 'BUY' ? 'success' : a === 'SELL' ? 'warning' : 'info';

export default function AnalystPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [hasPortfolio, setHasPortfolio] = useState(true);
  const [positions, setPositions] = useState<Position[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [equity, setEquity] = useState<CurvePoint[]>([]);
  const [benchmark, setBenchmark] = useState<CurvePoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, pos, dec, curve] = await Promise.all([
        fetch('/api/agent/portfolio').then((r) => r.json()),
        fetch('/api/agent/positions').then((r) => r.json()),
        fetch('/api/agent/decisions').then((r) => r.json()),
        fetch('/api/agent/portfolio/equity-curve').then((r) => r.json()),
      ]);
      setHasPortfolio(!!p.portfolio);
      setSummary(p.summary ?? null);
      setPositions(pos.positions ?? []);
      setDecisions(dec.decisions ?? []);
      setEquity(curve.equity ?? []);
      setBenchmark(curve.benchmark ?? []);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load analyst data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const runNow = async () => {
    setIsRunning(true);
    try {
      const r = await fetch('/api/agent/run', { method: 'POST' }).then((r) => r.json());
      if (r.status === 'COMPLETED') toast.success(`Run complete — ${r.tradesExecuted ?? 0} trade(s)`);
      else if (r.status === 'SKIPPED') toast.info(`Skipped: ${r.reason}`);
      else toast.error(`Run failed: ${r.reason ?? 'unknown'}`);
      await load();
    } catch {
      toast.error('Run failed');
    } finally {
      setIsRunning(false);
    }
  };

  const positionCols: Column<Position>[] = [
    { key: 'name', header: 'Instrument', render: (_v, p) => (
      <div className="flex flex-col"><span className="font-semibold text-[var(--dxp-text)]">{p.name}</span>
      <span className="text-xs text-[var(--dxp-text-muted)] font-mono">{p.symbol || p.assetClass}</span></div>
    ) },
    { key: 'quantity', header: 'Qty', render: (_v, p) => <span className="font-mono">{p.quantity}</span> },
    { key: 'avgPricePaisa', header: 'Avg', render: (_v, p) => <span className="font-mono">{inr(p.avgPricePaisa)}</span> },
    { key: 'lastPricePaisa', header: 'Last', render: (_v, p) => <span className="font-mono">{p.lastPricePaisa != null ? inr(p.lastPricePaisa) : '—'}</span> },
    { key: 'marketValuePaisa', header: 'Value', render: (_v, p) => <span className="font-mono">{p.marketValuePaisa != null ? inr(p.marketValuePaisa) : '—'}</span> },
    { key: 'unrealizedPnlPaisa', header: 'Unrealized', render: (_v, p) => {
      const v = p.unrealizedPnlPaisa ?? 0;
      return <span className={`font-mono ${v >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>{inr(v)}</span>;
    } },
  ];

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-[var(--dxp-text-muted)]" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Bot className="h-7 w-7 text-[var(--dxp-brand)]" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">Analyst (Paper)</h1>
            <p className="text-[var(--dxp-text-secondary)]">Autonomous paper-trading advisor — stocks, mutual funds & futures</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href="/investments/analyst/watchlist"><Button variant="secondary"><ListPlus className="mr-2 h-4 w-4" />Watchlist</Button></Link>
          <Link href="/investments/analyst/settings"><Button variant="secondary"><Settings className="mr-2 h-4 w-4" />Settings</Button></Link>
          <Button variant="primary" onClick={runNow} disabled={isRunning}>
            {isRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}Run now
          </Button>
        </div>
      </div>

      <Disclaimer />

      {!hasPortfolio ? (
        <Card><CardContent>
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <Bot className="h-12 w-12 text-[var(--dxp-text-muted)]" />
            <p className="text-[var(--dxp-text-muted)]">No paper portfolio yet. Add instruments to your watchlist, then run the agent.</p>
            <Link href="/investments/analyst/watchlist"><Button variant="primary"><ListPlus className="mr-2 h-4 w-4" />Build watchlist</Button></Link>
          </div>
        </CardContent></Card>
      ) : (
        <>
          <StatsDisplay currency="INR" locale="en-IN" columns={4} stats={[
            { label: 'Portfolio value', value: (summary?.equityPaisa ?? 0) / 100, format: 'currency' },
            { label: 'Total P&L', value: (summary?.totalPnlPaisa ?? 0) / 100, format: 'currency' },
            { label: 'Return %', value: Number((summary?.returnPct ?? 0).toFixed(2)), format: 'number' },
            { label: 'Cash', value: (summary?.cashPaisa ?? 0) / 100, format: 'currency' },
            { label: 'Open positions', value: summary?.openPositions ?? 0, format: 'number' },
          ]} />

          <Card>
            <CardHeader><h3 className="text-base font-bold text-[var(--dxp-text)]">Equity vs benchmark (rebased to 100)</h3></CardHeader>
            <CardContent><EquityCurveChart equity={equity} benchmark={benchmark} /></CardContent>
          </Card>

          <Card>
            <CardHeader><h3 className="text-base font-bold text-[var(--dxp-text)]">Open positions ({positions.length})</h3></CardHeader>
            <CardContent>
              {positions.length === 0
                ? <p className="py-6 text-center text-[var(--dxp-text-muted)]">No open positions yet.</p>
                : <DataTable<Position> columns={positionCols} data={positions} emptyMessage="No positions" />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><h3 className="text-base font-bold text-[var(--dxp-text)]">Recent decisions</h3></CardHeader>
            <CardContent>
              {decisions.length === 0 ? (
                <p className="py-6 text-center text-[var(--dxp-text-muted)]">No decisions yet — run the agent.</p>
              ) : (
                <ul className="space-y-2">
                  {decisions.slice(0, 20).map((d) => (
                    <li key={d.id} className="flex items-start gap-3 rounded border border-[var(--dxp-border-light)] p-3">
                      <Badge variant={actionVariant(d.action)}>{d.action}</Badge>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-[var(--dxp-text)]">
                          {d.name} <span className="font-mono text-xs text-[var(--dxp-text-muted)]">{d.symbol || d.assetClass}</span>
                          {d.amountPaisa ? <span className="ml-2 text-xs text-[var(--dxp-text-secondary)]">{inr(d.amountPaisa)}</span> : null}
                        </div>
                        {d.rationale && <p className="text-xs text-[var(--dxp-text-secondary)]">{d.rationale}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
