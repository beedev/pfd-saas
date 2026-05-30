'use client';

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
import {
  Plus,
  RefreshCcw,
  Trash2,
  Loader2,
  LineChart,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';

interface Holding {
  id: number;
  symbol: string;
  quantity: number;
  averagePrice: number; // paisa
  currentPrice: number; // paisa
  purchaseDate: string;
  totalInvestment: number; // paisa
  currentValue: number; // paisa
  gainLoss: number; // paisa
  gainLossPercent: number;
  notes: string | null;
}

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

const formatPercent = (value: number) =>
  `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

export default function StocksPage() {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Holding | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadHoldings = useCallback(async () => {
    try {
      const response = await fetch('/api/investments/stocks');
      const data = await response.json();
      setHoldings(data.holdings || []);
    } catch (error) {
      console.error('Failed to load holdings:', error);
      toast.error('Failed to load holdings');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHoldings();
  }, [loadHoldings]);

  const refreshPrices = async () => {
    if (!holdings.length) return;
    setIsRefreshing(true);
    try {
      const symbols = holdings.map((h) => h.symbol).join(',');
      const response = await fetch(
        `/api/investments/quotes?symbols=${encodeURIComponent(symbols)}`
      );
      const data = await response.json();

      const quotes = (data.quotes ?? []) as Array<{
        symbol: string;
        regularMarketPrice: number;
      }>;

      // Persist updated current price per holding so totals stay consistent.
      await Promise.all(
        holdings.map(async (h) => {
          const quote = quotes.find((q) => q.symbol === h.symbol);
          if (!quote) return;
          await fetch(`/api/investments/stocks/${h.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPrice: quote.regularMarketPrice }),
          });
        })
      );

      await loadHoldings();
      toast.success('Prices refreshed');
    } catch (error) {
      console.error('Failed to refresh prices:', error);
      toast.error('Failed to refresh prices');
    } finally {
      setIsRefreshing(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const response = await fetch(
        `/api/investments/stocks/${deleteTarget.id}`,
        { method: 'DELETE' }
      );
      if (!response.ok) throw new Error('delete failed');
      toast.success(`Removed ${deleteTarget.symbol}`);
      setDeleteTarget(null);
      await loadHoldings();
    } catch (error) {
      console.error(error);
      toast.error('Failed to delete holding');
    } finally {
      setIsDeleting(false);
    }
  };

  const totalInvestedPaisa = holdings.reduce((s, h) => s + h.totalInvestment, 0);
  const totalCurrentPaisa = holdings.reduce((s, h) => s + h.currentValue, 0);
  const totalGainPaisa = totalCurrentPaisa - totalInvestedPaisa;
  const totalGainPercent =
    totalInvestedPaisa > 0 ? (totalGainPaisa / totalInvestedPaisa) * 100 : 0;

  // DataTable columns (typed against Holding row shape)
  const columns: Column<Holding>[] = [
    {
      key: 'symbol',
      header: 'Symbol',
      render: (_v, h) => (
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold text-[var(--dxp-text)]">{h.symbol}</span>
          <Badge variant="default">NSE</Badge>
        </div>
      ),
    },
    {
      key: 'quantity',
      header: 'Qty',
      render: (_v, h) => (
        <span className="font-mono text-[var(--dxp-text)]">{h.quantity}</span>
      ),
    },
    {
      key: 'averagePrice',
      header: 'Avg price',
      render: (_v, h) => (
        <span className="font-mono text-[var(--dxp-text)]">
          {formatINR(h.averagePrice)}
        </span>
      ),
    },
    {
      key: 'currentPrice',
      header: 'Current price',
      render: (_v, h) => (
        <span className="font-mono font-semibold text-[var(--dxp-text)]">
          {formatINR(h.currentPrice)}
        </span>
      ),
    },
    {
      key: 'totalInvestment',
      header: 'Invested',
      render: (_v, h) => (
        <span className="font-mono text-[var(--dxp-text)]">
          {formatINR(h.totalInvestment)}
        </span>
      ),
    },
    {
      key: 'currentValue',
      header: 'Current value',
      render: (_v, h) => (
        <span className="font-mono font-semibold text-[var(--dxp-text)]">
          {formatINR(h.currentValue)}
        </span>
      ),
    },
    {
      key: 'gainLoss',
      header: 'P&L',
      render: (_v, h) => {
        const positive = h.gainLoss >= 0;
        return (
          <div
            className={`flex items-center gap-1 ${
              positive ? 'text-emerald-600' : 'text-rose-600'
            }`}
          >
            {positive ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )}
            <span className="text-sm font-mono font-medium">
              {formatINR(h.gainLoss)}
            </span>
            <span className="text-xs">({formatPercent(h.gainLossPercent)})</span>
          </div>
        );
      },
    },
    {
      key: 'id',
      header: '',
      render: (_v, h) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            setDeleteTarget(h);
          }}
        >
          <Trash2 className="h-4 w-4 text-rose-500" />
        </Button>
      ),
    },
  ];

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--dxp-text-muted)]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">Stocks</h1>
          <p className="text-[var(--dxp-text-secondary)]">
            Track your equity holdings with live prices from Yahoo Finance
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={refreshPrices}
            disabled={isRefreshing || holdings.length === 0}
          >
            {isRefreshing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCcw className="mr-2 h-4 w-4" />
            )}
            Refresh prices
          </Button>
          <Link href="/investments/stocks/new">
            <Button variant="primary">
              <Plus className="mr-2 h-4 w-4" />
              Add stock
            </Button>
          </Link>
        </div>
      </div>

      {/* Summary stats */}
      <StatsDisplay
        currency="INR"
        locale="en-IN"
        columns={3}
        stats={[
          { label: 'Invested', value: totalInvestedPaisa / 100, format: 'currency' },
          { label: 'Current value', value: totalCurrentPaisa / 100, format: 'currency' },
          {
            label: 'Unrealised P&L',
            value: totalGainPaisa / 100,
            format: 'currency',
            delta: { value: totalGainPercent, label: 'total return' },
          },
        ]}
      />

      {/* Holdings table */}
      <Card>
        <CardHeader>
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <LineChart className="h-5 w-5 text-[var(--dxp-brand)]" />
            Holdings ({holdings.length})
          </h3>
        </CardHeader>
        <CardContent>
          {holdings.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <p className="text-[var(--dxp-text-muted)]">
                No stocks yet. Add your first holding to get started.
              </p>
              <Link href="/investments/stocks/new">
                <Button variant="primary">
                  <Plus className="mr-2 h-4 w-4" />
                  Add stock
                </Button>
              </Link>
            </div>
          ) : (
            <DataTable<Holding>
              columns={columns}
              data={holdings}
              emptyMessage="No holdings"
            />
          )}
        </CardContent>
      </Card>

      {/* Delete confirmation — minimal inline modal */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => !isDeleting && setDeleteTarget(null)}
        >
          <Card
            className="w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <CardHeader>
              <h3 className="text-base font-bold text-[var(--dxp-text)]">Delete holding?</h3>
              <p className="text-xs text-[var(--dxp-text-secondary)]">
                This will remove <strong className="font-mono">{deleteTarget.symbol}</strong> from
                your portfolio. This cannot be undone.
              </p>
            </CardHeader>
            <CardContent>
              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setDeleteTarget(null)}
                  disabled={isDeleting}
                >
                  Cancel
                </Button>
                <Button variant="danger" onClick={confirmDelete} disabled={isDeleting}>
                  {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Delete
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
