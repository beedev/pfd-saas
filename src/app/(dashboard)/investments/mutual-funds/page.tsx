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
  Select,
  type Column,
} from '@dxp/ui';
import {
  Plus,
  RefreshCcw,
  Trash2,
  Loader2,
  PiggyBank,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  X,
} from 'lucide-react';

type Category = 'EQUITY' | 'DEBT' | 'HYBRID' | 'UNKNOWN';

interface MutualFund {
  id: number;
  isin: string;
  schemeName: string;
  fundType: 'EQUITY' | 'DEBT' | 'HYBRID' | 'LIQUID' | 'GOLD';
  category: Category;
  folioNumber: string | null;
  units: number;
  nav: number; // paisa
  totalInvestment: number; // paisa
  currentValue: number; // paisa
  gainLoss: number; // paisa
  gainLossPercent: number;
  lastNavDate: string | null;
  investmentStartDate: string | null;
}

const CATEGORY_OPTIONS: Array<{ label: string; value: Category }> = [
  { label: 'Equity', value: 'EQUITY' },
  { label: 'Debt', value: 'DEBT' },
  { label: 'Hybrid', value: 'HYBRID' },
  { label: 'Unknown', value: 'UNKNOWN' },
];

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

const formatPercent = (value: number) =>
  `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

const fundTypeVariant: Record<MutualFund['fundType'], 'success' | 'info' | 'warning' | 'default' | 'danger'> = {
  EQUITY: 'success',
  DEBT: 'info',
  HYBRID: 'warning',
  LIQUID: 'default',
  GOLD: 'warning',
};

export default function MutualFundsPage() {
  const [funds, setFunds] = useState<MutualFund[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MutualFund | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  // Sprint 5.7c — bulk-categorise modal state. Opens when the user
  // clicks the amber banner; collects per-row category choices and
  // commits via POST /api/investments/mutual-funds/bulk-categorise.
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkDraft, setBulkDraft] = useState<Map<number, Category>>(new Map());
  const [isBulkSaving, setIsBulkSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/investments/mutual-funds');
      const data = await r.json();
      setFunds(data.mutualFunds || []);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load mutual funds');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refreshNavs = async () => {
    if (!funds.length) return;
    setIsRefreshing(true);
    try {
      const r = await fetch('/api/investments/mutual-funds/refresh-navs', { method: 'POST' });
      if (!r.ok) throw new Error('refresh failed');
      const data = await r.json();
      toast.success(`Refreshed ${data.updated} of ${data.total} funds`);
      await load();
    } catch (e) {
      console.error(e);
      toast.error('Failed to refresh NAVs');
    } finally {
      setIsRefreshing(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const r = await fetch(`/api/investments/mutual-funds/${deleteTarget.id}`, {
        method: 'DELETE',
      });
      if (!r.ok) throw new Error('delete failed');
      toast.success(`Removed ${deleteTarget.schemeName}`);
      setDeleteTarget(null);
      await load();
    } catch (e) {
      console.error(e);
      toast.error('Failed to delete fund');
    } finally {
      setIsDeleting(false);
    }
  };

  const totalInvested = funds.reduce((s, f) => s + f.totalInvestment, 0);
  const totalCurrent = funds.reduce((s, f) => s + f.currentValue, 0);
  const totalGain = totalCurrent - totalInvested;
  const totalGainPct = totalInvested > 0 ? (totalGain / totalInvested) * 100 : 0;

  const uncategorised = funds.filter((f) => (f.category ?? 'UNKNOWN') === 'UNKNOWN');

  const openBulkModal = () => {
    // Seed every uncategorised fund with UNKNOWN; user picks from there.
    const seed = new Map<number, Category>();
    for (const f of uncategorised) seed.set(f.id, 'UNKNOWN');
    setBulkDraft(seed);
    setBulkOpen(true);
  };

  const commitBulk = async () => {
    // Only push rows the user actually moved off UNKNOWN — leaving a
    // row UNKNOWN is a no-op, no need to roundtrip it.
    const updates: Array<{ id: number; category: Category }> = [];
    for (const [id, cat] of bulkDraft.entries()) {
      if (cat !== 'UNKNOWN') updates.push({ id, category: cat });
    }
    if (updates.length === 0) {
      toast.info('Nothing to update — pick a category for at least one fund');
      return;
    }
    setIsBulkSaving(true);
    try {
      const r = await fetch('/api/investments/mutual-funds/bulk-categorise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Bulk save failed');
      toast.success(`Categorised ${data.updated} fund${data.updated === 1 ? '' : 's'}`);
      setBulkOpen(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Bulk save failed');
    } finally {
      setIsBulkSaving(false);
    }
  };

  const columns: Column<MutualFund>[] = [
    {
      key: 'schemeName',
      header: 'Scheme',
      render: (_v, f) => (
        <Link href={`/investments/mutual-funds/${f.id}`} className="flex flex-col hover:underline">
          <span className="font-semibold text-[var(--dxp-brand)]">{f.schemeName}</span>
          {f.folioNumber && (
            <span className="text-xs text-[var(--dxp-text-muted)] font-mono">
              Folio: {f.folioNumber}
            </span>
          )}
        </Link>
      ),
    },
    {
      key: 'fundType',
      header: 'Type',
      render: (_v, f) => <Badge variant={fundTypeVariant[f.fundType]}>{f.fundType}</Badge>,
    },
    {
      key: 'category',
      header: 'Category',
      render: (_v, f) => {
        const c = f.category ?? 'UNKNOWN';
        const variant: 'success' | 'info' | 'warning' | 'default' =
          c === 'EQUITY' ? 'success' : c === 'DEBT' ? 'info' : c === 'HYBRID' ? 'warning' : 'default';
        return <Badge variant={variant}>{c}</Badge>;
      },
    },
    {
      key: 'units',
      header: 'Units',
      render: (_v, f) => (
        <span className="font-mono text-[var(--dxp-text)]">{f.units.toFixed(3)}</span>
      ),
    },
    {
      key: 'nav',
      header: 'NAV',
      render: (_v, f) => (
        <span className="font-mono text-[var(--dxp-text)]">₹{(f.nav / 100).toFixed(2)}</span>
      ),
    },
    {
      key: 'totalInvestment',
      header: 'Invested',
      render: (_v, f) => (
        <span className="font-mono text-[var(--dxp-text)]">{formatINR(f.totalInvestment)}</span>
      ),
    },
    {
      key: 'currentValue',
      header: 'Current value',
      render: (_v, f) => (
        <span className="font-mono font-semibold text-[var(--dxp-text)]">
          {formatINR(f.currentValue)}
        </span>
      ),
    },
    {
      key: 'gainLoss',
      header: 'P&L',
      render: (_v, f) => {
        const positive = f.gainLoss >= 0;
        return (
          <div className={`flex items-center gap-1 ${positive ? 'text-emerald-600' : 'text-rose-600'}`}>
            {positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            <span className="text-sm font-mono font-medium">{formatINR(f.gainLoss)}</span>
            <span className="text-xs">({formatPercent(f.gainLossPercent)})</span>
          </div>
        );
      },
    },
    {
      key: 'id',
      header: '',
      render: (_v, f) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            setDeleteTarget(f);
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
          <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">Mutual Funds</h1>
          <p className="text-[var(--dxp-text-secondary)]">
            Track your MF holdings with live NAVs from AMFI India
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={refreshNavs}
            disabled={isRefreshing || funds.length === 0}
          >
            {isRefreshing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCcw className="mr-2 h-4 w-4" />
            )}
            Refresh NAVs
          </Button>
          <Link href="/investments/mutual-funds/new">
            <Button variant="primary">
              <Plus className="mr-2 h-4 w-4" />
              Add fund
            </Button>
          </Link>
        </div>
      </div>

      {uncategorised.length > 0 && (
        <div className="flex items-center justify-between gap-3 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>
              <strong>{uncategorised.length}</strong> fund
              {uncategorised.length === 1 ? '' : 's'} uncategorised — set a
              category (Equity/Debt/Hybrid) so projections use the right
              MF subclass growth rate.
            </span>
          </div>
          <Button variant="secondary" size="sm" onClick={openBulkModal}>
            Categorise now
          </Button>
        </div>
      )}

      <StatsDisplay
        currency="INR"
        locale="en-IN"
        columns={3}
        stats={[
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
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <PiggyBank className="h-5 w-5 text-[var(--dxp-brand)]" />
            Holdings ({funds.length})
          </h3>
        </CardHeader>
        <CardContent>
          {funds.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <p className="text-[var(--dxp-text-muted)]">
                No mutual funds yet. Add your first fund to get started.
              </p>
              <Link href="/investments/mutual-funds/new">
                <Button variant="primary">
                  <Plus className="mr-2 h-4 w-4" />
                  Add fund
                </Button>
              </Link>
            </div>
          ) : (
            <DataTable<MutualFund>
              columns={columns}
              data={funds}
              emptyMessage="No funds"
            />
          )}
        </CardContent>
      </Card>

      {bulkOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => !isBulkSaving && setBulkOpen(false)}
        >
          <Card
            className="w-full max-w-2xl mx-4 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <CardHeader>
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-[var(--dxp-text)]">
                  Categorise mutual funds
                </h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => !isBulkSaving && setBulkOpen(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-[var(--dxp-text-secondary)]">
                Pick a rate bucket for each fund. Equity = growth-heavy
                (~11%), Debt = bonds/liquid (~7%), Hybrid = multi-asset/
                arbitrage (~9%). Leave a row as Unknown to skip it.
              </p>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {uncategorised.map((f) => (
                  <div
                    key={f.id}
                    className="grid grid-cols-[1fr_180px] items-center gap-3 rounded border border-[var(--dxp-border)] px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[var(--dxp-text)]">
                        {f.schemeName}
                      </p>
                      <p className="text-xs text-[var(--dxp-text-muted)]">
                        {f.fundType} ·{' '}
                        {new Intl.NumberFormat('en-IN', {
                          style: 'currency',
                          currency: 'INR',
                          maximumFractionDigits: 0,
                        }).format(f.currentValue / 100)}
                      </p>
                    </div>
                    <Select
                      value={bulkDraft.get(f.id) ?? 'UNKNOWN'}
                      onChange={(v) => {
                        const next = new Map(bulkDraft);
                        next.set(f.id, v as Category);
                        setBulkDraft(next);
                      }}
                      options={CATEGORY_OPTIONS}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setBulkOpen(false)}
                  disabled={isBulkSaving}
                >
                  Cancel
                </Button>
                <Button variant="primary" onClick={commitBulk} disabled={isBulkSaving}>
                  {isBulkSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save all
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => !isDeleting && setDeleteTarget(null)}
        >
          <Card className="w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <h3 className="text-base font-bold text-[var(--dxp-text)]">Delete fund?</h3>
              <p className="text-xs text-[var(--dxp-text-secondary)]">
                This will remove <strong>{deleteTarget.schemeName}</strong> from your portfolio.
                This cannot be undone.
              </p>
            </CardHeader>
            <CardContent>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={isDeleting}>
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
