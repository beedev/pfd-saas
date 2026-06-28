'use client';

/**
 * Recurring Deposits — list view with summary stats and table.
 * Mirrors the Fixed Deposits list page.
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
import { Plus, Trash2, Loader2, Repeat } from 'lucide-react';

interface RecurringDeposit {
  id: number;
  bankName: string;
  accountNumber: string | null;
  monthlyInstallmentPaisa: number;
  interestRate: number;
  compoundingFreq: string | null;
  tenureMonths: number;
  startDate: string;
  maturityDate: string;
  totalDepositPaisa: number | null;
  maturityAmountPaisa: number | null;
  status: 'ACTIVE' | 'MATURED' | 'BROKEN' | null;
  autoRenew: boolean;
  notes: string | null;
}

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

export default function RecurringDepositsPage() {
  const [rds, setRds] = useState<RecurringDeposit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<RecurringDeposit | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/investments/recurring-deposits').then((r) => r.json());
      setRds(r.recurringDeposits || []);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load recurring deposits');
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
      const r = await fetch(`/api/investments/recurring-deposits/${deleteTarget.id}`, {
        method: 'DELETE',
      });
      if (!r.ok) throw new Error('delete failed');
      toast.success(`Removed RD with ${deleteTarget.bankName}`);
      setDeleteTarget(null);
      await load();
    } catch (e) {
      console.error(e);
      toast.error('Failed to delete RD');
    } finally {
      setIsDeleting(false);
    }
  };

  const active = rds.filter((r) => r.status === 'ACTIVE');
  const totalDeposit = active.reduce(
    (s, r) => s + (r.totalDepositPaisa ?? r.monthlyInstallmentPaisa * r.tenureMonths),
    0,
  );
  const totalMaturity = active.reduce(
    (s, r) =>
      s + (r.maturityAmountPaisa ?? r.totalDepositPaisa ?? r.monthlyInstallmentPaisa * r.tenureMonths),
    0,
  );
  const projectedInterest = totalMaturity - totalDeposit;
  const today = new Date().toISOString().slice(0, 10);
  const oneYear = new Date();
  oneYear.setFullYear(oneYear.getFullYear() + 1);
  const oneYearIso = oneYear.toISOString().slice(0, 10);
  const next12mo = active
    .filter((r) => r.maturityDate >= today && r.maturityDate <= oneYearIso)
    .reduce((s, r) => s + (r.maturityAmountPaisa ?? 0), 0);

  const columns: Column<RecurringDeposit>[] = [
    {
      key: 'bankName',
      header: 'Bank',
      render: (_v, r) => (
        <div className="flex flex-col">
          <Link
            href={`/investments/recurring-deposits/${r.id}`}
            className="font-semibold text-[var(--dxp-brand)] hover:underline"
          >
            {r.bankName}
          </Link>
          {r.accountNumber && (
            <span className="text-xs text-[var(--dxp-text-muted)] font-mono">
              {r.accountNumber}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'monthlyInstallmentPaisa',
      header: 'Monthly',
      render: (_v, r) => (
        <span className="font-mono text-[var(--dxp-text)]">
          {formatINR(r.monthlyInstallmentPaisa)} × {r.tenureMonths}
        </span>
      ),
    },
    {
      key: 'interestRate',
      header: 'Rate',
      render: (_v, r) => (
        <span className="font-mono text-[var(--dxp-text)]">{r.interestRate.toFixed(2)}%</span>
      ),
    },
    {
      key: 'maturityAmountPaisa',
      header: 'At maturity',
      render: (_v, r) => (
        <span className="font-mono font-semibold text-emerald-700">
          {formatINR(r.maturityAmountPaisa ?? 0)}
        </span>
      ),
    },
    {
      key: 'maturityDate',
      header: 'Matures',
      render: (_v, r) => (
        <span className="text-xs text-[var(--dxp-text-secondary)]">{fmtDate(r.maturityDate)}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (_v, r) => {
        const variant =
          r.status === 'ACTIVE' ? 'success' : r.status === 'MATURED' ? 'info' : 'warning';
        return <Badge variant={variant}>{r.status}</Badge>;
      },
    },
    {
      key: 'id',
      header: '',
      render: (_v, r) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            setDeleteTarget(r);
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
            Recurring Deposits
          </h1>
          <p className="text-[var(--dxp-text-secondary)]">
            Monthly installments · projected maturity + interest
          </p>
        </div>
        <Link href="/investments/recurring-deposits/new">
          <Button variant="primary">
            <Plus className="mr-2 h-4 w-4" />
            Add recurring deposit
          </Button>
        </Link>
      </div>

      <StatsDisplay
        currency="INR"
        locale="en-IN"
        columns={4}
        stats={[
          { label: 'Active deposited', value: totalDeposit / 100, format: 'currency' },
          { label: 'At maturity', value: totalMaturity / 100, format: 'currency' },
          { label: 'Projected interest', value: projectedInterest / 100, format: 'currency' },
          { label: 'Matures in 12 mo', value: next12mo / 100, format: 'currency' },
        ]}
      />

      <Card>
        <CardHeader>
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <Repeat className="h-5 w-5 text-[var(--dxp-brand)]" />
            Deposits ({rds.length})
          </h3>
        </CardHeader>
        <CardContent>
          {rds.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Repeat className="h-12 w-12 text-[var(--dxp-text-muted)]" />
              <p className="text-[var(--dxp-text-muted)]">
                No recurring deposits yet. Add your first RD to get started.
              </p>
              <Link href="/investments/recurring-deposits/new">
                <Button variant="primary">
                  <Plus className="mr-2 h-4 w-4" />
                  Add recurring deposit
                </Button>
              </Link>
            </div>
          ) : (
            <DataTable<RecurringDeposit> columns={columns} data={rds} emptyMessage="No RDs" />
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
              <h3 className="text-base font-bold text-[var(--dxp-text)]">Delete recurring deposit?</h3>
              <p className="text-xs text-[var(--dxp-text-secondary)]">
                Remove the <strong>{deleteTarget.bankName}</strong> RD of{' '}
                {formatINR(deleteTarget.monthlyInstallmentPaisa)}/mo. This cannot be undone.
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
