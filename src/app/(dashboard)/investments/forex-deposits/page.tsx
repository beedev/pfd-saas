'use client';

/**
 * Forex Deposits — list page (Sprint 5.10d).
 *
 * Columns: Bank, Currency, Amount (foreign), Rate, INR value, Maturity,
 * Actions. The INR value is live — refreshed each page load via the
 * underlying /api/investments/forex-deposits endpoint which calls
 * getFxRatesToInr() with a 5-min cache. Rows where the live rate
 * didn't resolve show "rate unavailable" rather than zero.
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
import { Plus, Loader2, Banknote, Trash2 } from 'lucide-react';

interface ForexDeposit {
  id: number;
  bankName: string;
  accountNumber: string | null;
  currencyCode: string;
  amountInCurrency: number;
  interestRate: number | null;
  openingDate: string;
  maturityDate: string | null;
  status: 'ACTIVE' | 'MATURED' | 'CLOSED';
  fxRate: number | null;
  inrValuePaisa: number | null;
  notes: string | null;
}

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

const statusVariant: Record<ForexDeposit['status'], 'success' | 'default' | 'warning'> = {
  ACTIVE: 'success',
  MATURED: 'warning',
  CLOSED: 'default',
};

export default function ForexDepositsPage() {
  const [deposits, setDeposits] = useState<ForexDeposit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ForexDeposit | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/investments/forex-deposits');
      const data = await r.json();
      setDeposits(data.forexDeposits || []);
      setAsOf(data.inrValueAsOf ?? null);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load forex deposits');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const r = await fetch(`/api/investments/forex-deposits/${deleteTarget.id}`, {
        method: 'DELETE',
      });
      if (!r.ok) throw new Error('delete failed');
      toast.success(`Removed ${deleteTarget.bankName}`);
      setDeleteTarget(null);
      await load();
    } catch (e) {
      console.error(e);
      toast.error('Failed to delete deposit');
    } finally {
      setIsDeleting(false);
    }
  };

  const totalInrPaisa = deposits
    .filter((d) => d.status === 'ACTIVE' && d.inrValuePaisa !== null)
    .reduce((s, d) => s + (d.inrValuePaisa ?? 0), 0);
  const activeCount = deposits.filter((d) => d.status === 'ACTIVE').length;
  const distinctCurrencies = new Set(
    deposits.filter((d) => d.status === 'ACTIVE').map((d) => d.currencyCode),
  ).size;

  const columns: Column<ForexDeposit>[] = [
    {
      key: 'bankName',
      header: 'Bank',
      render: (_v, d) => (
        <Link href={`/investments/forex-deposits/${d.id}`} className="hover:underline">
          <span className="font-semibold text-[var(--dxp-brand)]">{d.bankName}</span>
          {d.accountNumber && (
            <p className="text-xs text-[var(--dxp-text-muted)] font-mono">{d.accountNumber}</p>
          )}
        </Link>
      ),
    },
    {
      key: 'currencyCode',
      header: 'Currency',
      render: (_v, d) => <Badge variant="info">{d.currencyCode}</Badge>,
    },
    {
      key: 'amountInCurrency',
      header: 'Amount',
      render: (_v, d) => (
        <span className="font-mono text-[var(--dxp-text)]">
          {d.amountInCurrency.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 4,
          })}{' '}
          <span className="text-xs text-[var(--dxp-text-muted)]">{d.currencyCode}</span>
        </span>
      ),
    },
    {
      key: 'fxRate',
      header: 'Rate (INR)',
      render: (_v, d) =>
        d.fxRate !== null ? (
          <span className="font-mono text-[var(--dxp-text)]">
            ₹{d.fxRate.toFixed(4)}
          </span>
        ) : (
          <span className="text-xs text-[var(--dxp-text-muted)]">unavailable</span>
        ),
    },
    {
      key: 'inrValuePaisa',
      header: 'INR value',
      render: (_v, d) =>
        d.inrValuePaisa !== null ? (
          <span className="font-mono font-semibold text-[var(--dxp-text)]">
            {formatINR(d.inrValuePaisa)}
          </span>
        ) : (
          <span className="text-xs text-[var(--dxp-text-muted)]">—</span>
        ),
    },
    {
      key: 'maturityDate',
      header: 'Maturity',
      render: (_v, d) =>
        d.maturityDate ? (
          <span className="text-sm text-[var(--dxp-text)]">{d.maturityDate}</span>
        ) : (
          <span className="text-xs text-[var(--dxp-text-muted)]">ongoing</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (_v, d) => <Badge variant={statusVariant[d.status]}>{d.status}</Badge>,
    },
    {
      key: 'id',
      header: '',
      render: (_v, d) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            setDeleteTarget(d);
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
          <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
            Forex Deposits
          </h1>
          <p className="text-[var(--dxp-text-secondary)]">
            Foreign-currency balances with live INR conversion
            {asOf && (
              <span className="ml-2 text-xs text-[var(--dxp-text-muted)]">
                · rates as of {new Date(asOf).toLocaleString('en-IN')}
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/investments/forex-deposits/new">
            <Button variant="primary">
              <Plus className="mr-2 h-4 w-4" />
              Add deposit
            </Button>
          </Link>
        </div>
      </div>

      <StatsDisplay
        currency="INR"
        locale="en-IN"
        columns={3}
        stats={[
          { label: 'Total INR value', value: totalInrPaisa / 100, format: 'currency' },
          { label: 'Active deposits', value: activeCount, format: 'number' },
          { label: 'Currencies', value: distinctCurrencies, format: 'number' },
        ]}
      />

      <Card>
        <CardHeader>
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <Banknote className="h-5 w-5 text-[var(--dxp-brand)]" />
            Deposits ({deposits.length})
          </h3>
        </CardHeader>
        <CardContent>
          {deposits.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <p className="text-[var(--dxp-text-muted)]">
                No forex deposits yet. Add your first deposit to track foreign-
                currency balances with live INR conversion.
              </p>
              <Link href="/investments/forex-deposits/new">
                <Button variant="primary">
                  <Plus className="mr-2 h-4 w-4" />
                  Add deposit
                </Button>
              </Link>
            </div>
          ) : (
            <DataTable<ForexDeposit>
              columns={columns}
              data={deposits}
              emptyMessage="No deposits"
            />
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
              <h3 className="text-base font-bold text-[var(--dxp-text)]">Delete deposit?</h3>
              <p className="text-xs text-[var(--dxp-text-secondary)]">
                This will remove <strong>{deleteTarget.bankName}</strong> (
                {deleteTarget.currencyCode} {deleteTarget.amountInCurrency.toLocaleString('en-US')}
                ). This cannot be undone.
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
