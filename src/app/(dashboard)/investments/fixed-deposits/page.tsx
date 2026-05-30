'use client';

/**
 * Fixed Deposits — list view with summary stats and table.
 * Follows the same pattern as NPS / Gold / Insurance list pages.
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
import { Plus, Trash2, Loader2, PiggyBank } from 'lucide-react';

interface FixedDeposit {
  id: number;
  bankName: string;
  accountNumber: string | null;
  principalPaisa: number;
  interestRate: number;
  compoundingFreq: string | null;
  interestType: string | null;
  startDate: string;
  maturityDate: string;
  tenureMonths: number | null;
  maturityAmountPaisa: number | null;
  status: 'ACTIVE' | 'MATURED' | 'BROKEN' | null;
  isTaxSaver: boolean;
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

export default function FixedDepositsPage() {
  const [fds, setFds] = useState<FixedDeposit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<FixedDeposit | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/investments/fixed-deposits').then((r) => r.json());
      setFds(r.fixedDeposits || []);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load fixed deposits');
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
      const r = await fetch(`/api/investments/fixed-deposits/${deleteTarget.id}`, {
        method: 'DELETE',
      });
      if (!r.ok) throw new Error('delete failed');
      toast.success(`Removed FD with ${deleteTarget.bankName}`);
      setDeleteTarget(null);
      await load();
    } catch (e) {
      console.error(e);
      toast.error('Failed to delete FD');
    } finally {
      setIsDeleting(false);
    }
  };

  const active = fds.filter((f) => f.status === 'ACTIVE');
  const totalPrincipal = active.reduce((s, f) => s + f.principalPaisa, 0);
  const totalMaturity = active.reduce(
    (s, f) => s + (f.maturityAmountPaisa ?? f.principalPaisa),
    0,
  );
  const projectedInterest = totalMaturity - totalPrincipal;
  // Next-12-months maturity surfaces what's about to come due (and into cash).
  const today = new Date().toISOString().slice(0, 10);
  const oneYear = new Date();
  oneYear.setFullYear(oneYear.getFullYear() + 1);
  const oneYearIso = oneYear.toISOString().slice(0, 10);
  const next12mo = active
    .filter((f) => f.maturityDate >= today && f.maturityDate <= oneYearIso)
    .reduce((s, f) => s + (f.maturityAmountPaisa ?? f.principalPaisa), 0);

  const columns: Column<FixedDeposit>[] = [
    {
      key: 'bankName',
      header: 'Bank',
      render: (_v, f) => (
        <div className="flex flex-col">
          <Link
            href={`/investments/fixed-deposits/${f.id}`}
            className="font-semibold text-[var(--dxp-brand)] hover:underline"
          >
            {f.bankName}
          </Link>
          {f.accountNumber && (
            <span className="text-xs text-[var(--dxp-text-muted)] font-mono">
              {f.accountNumber}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'principalPaisa',
      header: 'Principal',
      render: (_v, f) => (
        <span className="font-mono text-[var(--dxp-text)]">{formatINR(f.principalPaisa)}</span>
      ),
    },
    {
      key: 'interestRate',
      header: 'Rate',
      render: (_v, f) => (
        <span className="font-mono text-[var(--dxp-text)]">{f.interestRate.toFixed(2)}%</span>
      ),
    },
    {
      key: 'maturityAmountPaisa',
      header: 'At maturity',
      render: (_v, f) => (
        <span className="font-mono font-semibold text-emerald-700">
          {formatINR(f.maturityAmountPaisa ?? f.principalPaisa)}
        </span>
      ),
    },
    {
      key: 'maturityDate',
      header: 'Matures',
      render: (_v, f) => (
        <span className="text-xs text-[var(--dxp-text-secondary)]">{fmtDate(f.maturityDate)}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (_v, f) => {
        const variant =
          f.status === 'ACTIVE'
            ? 'success'
            : f.status === 'MATURED'
              ? 'info'
              : 'warning';
        return (
          <div className="flex items-center gap-1">
            <Badge variant={variant}>{f.status}</Badge>
            {f.isTaxSaver && (
              <Badge variant="info" className="text-[10px]">
                80C
              </Badge>
            )}
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
          <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
            Fixed Deposits
          </h1>
          <p className="text-[var(--dxp-text-secondary)]">
            Bank FDs · principal + projected maturity
          </p>
        </div>
        <Link href="/investments/fixed-deposits/new">
          <Button variant="primary">
            <Plus className="mr-2 h-4 w-4" />
            Add fixed deposit
          </Button>
        </Link>
      </div>

      <StatsDisplay
        currency="INR"
        locale="en-IN"
        columns={4}
        stats={[
          { label: 'Active principal', value: totalPrincipal / 100, format: 'currency' },
          { label: 'At maturity', value: totalMaturity / 100, format: 'currency' },
          { label: 'Projected interest', value: projectedInterest / 100, format: 'currency' },
          { label: 'Matures in 12 mo', value: next12mo / 100, format: 'currency' },
        ]}
      />

      <Card>
        <CardHeader>
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <PiggyBank className="h-5 w-5 text-[var(--dxp-brand)]" />
            Deposits ({fds.length})
          </h3>
        </CardHeader>
        <CardContent>
          {fds.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <PiggyBank className="h-12 w-12 text-[var(--dxp-text-muted)]" />
              <p className="text-[var(--dxp-text-muted)]">
                No fixed deposits yet. Add your first FD to get started.
              </p>
              <Link href="/investments/fixed-deposits/new">
                <Button variant="primary">
                  <Plus className="mr-2 h-4 w-4" />
                  Add fixed deposit
                </Button>
              </Link>
            </div>
          ) : (
            <DataTable<FixedDeposit> columns={columns} data={fds} emptyMessage="No FDs" />
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
              <h3 className="text-base font-bold text-[var(--dxp-text)]">Delete fixed deposit?</h3>
              <p className="text-xs text-[var(--dxp-text-secondary)]">
                Remove the <strong>{deleteTarget.bankName}</strong> FD of{' '}
                {formatINR(deleteTarget.principalPaisa)}. This cannot be undone.
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
