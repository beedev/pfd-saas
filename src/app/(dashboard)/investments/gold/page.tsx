'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
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
  FilterBar,
  type Column,
} from '@dxp/ui';
import {
  Plus,
  RefreshCcw,
  Trash2,
  Loader2,
  Coins,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';

type GoldType = 'GOLD_BOND' | 'ETF' | 'PHYSICAL' | 'DIGITAL';
type Purity = '999' | '995' | '916';

interface GoldHolding {
  id: number;
  type: GoldType;
  name: string | null;
  grams: number | null;
  purity: Purity | null;
  purchaseDate: string | null;
  purchasePricePerGram: number | null; // paisa
  currentRatePerGram: number | null; // paisa
  totalInvestment: number | null; // paisa
  currentValue: number | null; // paisa
  gainLoss: number | null; // paisa
  gainLossPercent: number | null;
  lastRateUpdate: string | null;
  etfSymbol: string | null;
  etfUnits: number | null;
  sgbSeries: string | null;
}

interface GoldRate {
  ratePerGram24K: number;
  ratePerGram22K: number;
  asOfDate: string;
  source: string;
  breakdown?: {
    usdPerOz: number;
    usdInr: number;
    spotInrPerGram: number;
    premiumMultiplier: number;
  };
}

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

const formatPercent = (value: number) =>
  `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

const typeLabel: Record<GoldType, string> = {
  GOLD_BOND: 'SGB',
  ETF: 'ETF',
  PHYSICAL: 'Physical',
  DIGITAL: 'Digital',
};

const typeVariant: Record<GoldType, 'success' | 'info' | 'warning' | 'default'> = {
  GOLD_BOND: 'success',
  ETF: 'info',
  PHYSICAL: 'warning',
  DIGITAL: 'default', // rendered with purple override below
};

// Purity factor — converts native-purity grams to 24K-equivalent grams
const purityFactor = (p: Purity | null): number =>
  p === '916' ? 0.916 : p === '995' ? 0.995 : 1;

// Effective grams (24K equivalent) respecting purity
const effectiveGrams = (h: GoldHolding): number =>
  (h.grams ?? 0) * purityFactor(h.purity);

// Live rate applied to a holding's purity — returns INR per gram (rupees, not paisa)
// This makes the banner rate the single source of truth; stored currentRatePerGram
// is ignored for display so the row always matches the banner.
const liveRateForHolding = (h: GoldHolding, rate24K: number): number =>
  rate24K * purityFactor(h.purity);

// Compute current value in paisa from live rate + grams (derived, not stored)
const computeCurrentValuePaisa = (h: GoldHolding, rate24K: number): number => {
  const grams = h.grams ?? 0;
  const rate = liveRateForHolding(h, rate24K);  // ₹/g in rupees
  return Math.round(grams * rate * 100);          // convert to paisa
};

export default function GoldPage() {
  const [holdings, setHoldings] = useState<GoldHolding[]>([]);
  const [rate, setRate] = useState<GoldRate | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<GoldHolding | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [filter, setFilter] = useState<'ALL' | GoldType>('ALL');

  const load = useCallback(async () => {
    try {
      const [goldRes, rateRes] = await Promise.all([
        fetch('/api/investments/gold').then((r) => r.json()),
        fetch('/api/investments/gold/current-rate').then((r) => r.json()),
      ]);
      setHoldings(goldRes.gold || []);
      setRate(rateRes);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load gold holdings');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refreshRates = async () => {
    setIsRefreshing(true);
    try {
      const r = await fetch('/api/investments/gold/refresh-rates', { method: 'POST' });
      if (!r.ok) throw new Error('refresh failed');
      const data = await r.json();
      toast.success(`Refreshed ${data.updated} of ${data.total} holdings`);
      await load();
    } catch (e) {
      console.error(e);
      toast.error('Failed to refresh rates');
    } finally {
      setIsRefreshing(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const r = await fetch(`/api/investments/gold/${deleteTarget.id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('delete failed');
      toast.success(`Removed ${deleteTarget.name}`);
      setDeleteTarget(null);
      await load();
    } catch (e) {
      console.error(e);
      toast.error('Failed to delete holding');
    } finally {
      setIsDeleting(false);
    }
  };

  const filtered = useMemo(
    () => (filter === 'ALL' ? holdings : holdings.filter((h) => h.type === filter)),
    [holdings, filter]
  );

  // Single source of truth for "now": the live banner rate. Falls back to the
  // last stored per-holding rate only if the live rate hasn't loaded yet.
  const liveRate24K = rate?.ratePerGram24K ?? null;

  const currentValueOf = useCallback(
    (h: GoldHolding): number =>
      liveRate24K !== null ? computeCurrentValuePaisa(h, liveRate24K) : (h.currentValue ?? 0),
    [liveRate24K]
  );

  const totalGrams24K = holdings.reduce((s, h) => s + effectiveGrams(h), 0);
  const totalInvested = holdings.reduce((s, h) => s + (h.totalInvestment ?? 0), 0);
  const totalCurrent = holdings.reduce((s, h) => s + currentValueOf(h), 0);
  const totalGain = totalCurrent - totalInvested;
  const totalGainPct = totalInvested > 0 ? (totalGain / totalInvested) * 100 : 0;

  const columns: Column<GoldHolding>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (_v, h) => (
        <Link href={`/investments/gold/${h.id}`} className="flex flex-col hover:underline">
          <span className="font-semibold text-[var(--dxp-brand)]">{h.name}</span>
          {h.type === 'GOLD_BOND' && h.sgbSeries && (
            <span className="text-xs text-[var(--dxp-text-muted)]">{h.sgbSeries}</span>
          )}
          {h.type === 'ETF' && h.etfSymbol && (
            <span className="text-xs text-[var(--dxp-text-muted)] font-mono">{h.etfSymbol}</span>
          )}
        </Link>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      render: (_v, h) => {
        if (h.type === 'DIGITAL') {
          return (
            <span className="inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
              Digital
            </span>
          );
        }
        return <Badge variant={typeVariant[h.type]}>{typeLabel[h.type]}</Badge>;
      },
    },
    {
      key: 'grams',
      header: 'Grams',
      render: (_v, h) => (
        <span className="font-mono text-[var(--dxp-text)]">
          {h.grams !== null ? h.grams.toFixed(3) : '—'}
        </span>
      ),
    },
    {
      key: 'purity',
      header: 'Purity',
      render: (_v, h) => (
        <span className="text-[var(--dxp-text-secondary)] text-xs">{h.purity ?? '—'}</span>
      ),
    },
    {
      key: 'purchasePricePerGram',
      header: 'Buy rate',
      render: (_v, h) => (
        <span className="font-mono text-[var(--dxp-text)] text-xs">
          {h.purchasePricePerGram !== null ? `₹${(h.purchasePricePerGram / 100).toFixed(2)}` : '—'}
        </span>
      ),
    },
    {
      key: 'currentRatePerGram',
      header: 'Now rate',
      render: (_v, h) => {
        const r =
          liveRate24K !== null
            ? liveRateForHolding(h, liveRate24K)
            : h.currentRatePerGram !== null
            ? h.currentRatePerGram / 100
            : null;
        return (
          <span className="font-mono text-[var(--dxp-text)] text-xs">
            {r !== null ? `₹${r.toFixed(2)}` : '—'}
          </span>
        );
      },
    },
    {
      key: 'totalInvestment',
      header: 'Invested',
      render: (_v, h) => (
        <span className="font-mono text-[var(--dxp-text)]">
          {formatINR(h.totalInvestment ?? 0)}
        </span>
      ),
    },
    {
      key: 'currentValue',
      header: 'Current value',
      render: (_v, h) => (
        <span className="font-mono font-semibold text-[var(--dxp-text)]">
          {formatINR(currentValueOf(h))}
        </span>
      ),
    },
    {
      key: 'gainLoss',
      header: 'P&L',
      render: (_v, h) => {
        const cv = currentValueOf(h);
        const inv = h.totalInvestment ?? 0;
        const gl = cv - inv;
        const pct = inv > 0 ? (gl / inv) * 100 : 0;
        const positive = gl >= 0;
        return (
          <div
            className={`flex items-center gap-1 ${
              positive ? 'text-emerald-600' : 'text-rose-600'
            }`}
          >
            {positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            <span className="text-sm font-mono font-medium">{formatINR(gl)}</span>
            <span className="text-xs">({formatPercent(pct)})</span>
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
          <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">Gold</h1>
          <p className="text-[var(--dxp-text-secondary)]">
            Sovereign Gold Bonds, ETFs, physical and digital gold
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={refreshRates} disabled={isRefreshing}>
            {isRefreshing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCcw className="mr-2 h-4 w-4" />
            )}
            Refresh rates
          </Button>
          <Link href="/investments/gold/new">
            <Button variant="primary">
              <Plus className="mr-2 h-4 w-4" />
              Add gold
            </Button>
          </Link>
        </div>
      </div>

      {/* Today's rate banner */}
      {rate && (
        <Card className="border-l-4 border-l-amber-500 bg-amber-50">
          <CardContent>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-4">
                <Coins className="h-8 w-8 text-amber-600" />
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-amber-700">
                    Today&apos;s gold rate
                  </p>
                  <div className="flex items-baseline gap-4 mt-1">
                    <div>
                      <span className="text-2xl font-bold font-mono text-amber-900">
                        ₹{rate.ratePerGram24K.toFixed(2)}
                      </span>
                      <span className="text-xs text-amber-700 ml-1">/g · 24K</span>
                    </div>
                    <div>
                      <span className="text-lg font-bold font-mono text-amber-900">
                        ₹{rate.ratePerGram22K.toFixed(2)}
                      </span>
                      <span className="text-xs text-amber-700 ml-1">/g · 22K</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs text-amber-700">As of {rate.asOfDate}</p>
                <p className="text-[10px] text-amber-600 font-mono">source: {rate.source}</p>
              </div>
            </div>
            {rate.breakdown && (
              <p className="mt-2 text-[10px] text-amber-700 font-mono">
                ${rate.breakdown.usdPerOz.toFixed(2)}/oz × ₹{rate.breakdown.usdInr.toFixed(2)}/$ ÷
                31.10 g/oz = ₹{rate.breakdown.spotInrPerGram.toFixed(2)}/g spot · ×{' '}
                {rate.breakdown.premiumMultiplier.toFixed(2)} India retail premium = ₹
                {rate.ratePerGram24K.toFixed(2)}/g
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <StatsDisplay
        currency="INR"
        locale="en-IN"
        columns={4}
        stats={[
          {
            label: 'Total grams (24K eq)',
            value: totalGrams24K,
            format: 'number',
            delta: { value: 0, label: `${holdings.length} holdings` },
          },
          { label: 'Invested', value: totalInvested / 100, format: 'currency' },
          { label: 'Current value', value: totalCurrent / 100, format: 'currency' },
          {
            label: 'Unrealised P&L',
            value: totalGain / 100,
            format: 'currency',
            delta: { value: totalGainPct, label: 'total return' },
          },
        ]}
      />

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
              <Coins className="h-5 w-5 text-amber-600" />
              Holdings ({filtered.length})
            </h3>
            <FilterBar
              filters={[
                { key: 'ALL', label: 'All', value: 'ALL' },
                { key: 'GOLD_BOND', label: 'SGB', value: 'GOLD_BOND' },
                { key: 'ETF', label: 'ETF', value: 'ETF' },
                { key: 'PHYSICAL', label: 'Physical', value: 'PHYSICAL' },
                { key: 'DIGITAL', label: 'Digital', value: 'DIGITAL' },
              ]}
              activeFilters={[filter]}
              onToggle={(key) => setFilter(key as 'ALL' | GoldType)}
              onClear={() => setFilter('ALL')}
            />
          </div>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Coins className="h-12 w-12 text-[var(--dxp-text-muted)]" />
              <p className="text-[var(--dxp-text-muted)]">
                {holdings.length === 0
                  ? 'No gold holdings yet. Add your first position to get started.'
                  : 'No holdings match this filter.'}
              </p>
              {holdings.length === 0 && (
                <Link href="/investments/gold/new">
                  <Button variant="primary">
                    <Plus className="mr-2 h-4 w-4" />
                    Add gold
                  </Button>
                </Link>
              )}
            </div>
          ) : (
            <DataTable<GoldHolding> columns={columns} data={filtered} emptyMessage="No holdings" />
          )}
        </CardContent>
      </Card>

      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => !isDeleting && setDeleteTarget(null)}
        >
          <Card className="w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <h3 className="text-base font-bold text-[var(--dxp-text)]">Delete holding?</h3>
              <p className="text-xs text-[var(--dxp-text-secondary)]">
                This will remove <strong>{deleteTarget.name}</strong> from your portfolio. This
                cannot be undone.
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
