'use client';

/**
 * Small Savings — list page.
 *
 * One tile-strip on top (active count, total balance, total deposited,
 * total interest earned). Below: six scheme tabs (PPF / VPF / NSC / KVP /
 * SSY / SCSS). Active tab shows the matching DataTable; empty tab shows
 * a friendly "no accounts in this scheme" CTA.
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';

import { Button, Card, CardHeader, CardContent, Badge, StatsDisplay, DataTable, type Column } from '@dxp/ui';
import { Plus, Loader2, Landmark, Trash2 } from 'lucide-react';

type SmallSavingsScheme = 'PPF' | 'VPF' | 'NSC' | 'KVP' | 'SSY' | 'SCSS';
type SmallSavingsStatus = 'ACTIVE' | 'MATURED' | 'CLOSED' | 'EXTENDED';

interface Account {
  id: number;
  schemeType: SmallSavingsScheme;
  accountNumber: string;
  holderName: string;
  holderDob: string | null;
  institution: string | null;
  openingDate: string;
  maturityDate: string;
  currentBalancePaisa: number;
  totalDepositedPaisa: number;
  totalInterestPaisa: number;
  interestRatePercent: number;
  status: SmallSavingsStatus;
}

const SCHEME_META: Array<{ key: SmallSavingsScheme; label: string; tagline: string }> = [
  { key: 'PPF', label: 'PPF', tagline: 'Public Provident Fund' },
  { key: 'VPF', label: 'VPF', tagline: 'Voluntary Provident Fund' },
  { key: 'NSC', label: 'NSC', tagline: 'National Savings Certificate' },
  { key: 'KVP', label: 'KVP', tagline: 'Kisan Vikas Patra' },
  { key: 'SSY', label: 'SSY', tagline: 'Sukanya Samriddhi Yojana' },
  { key: 'SCSS', label: 'SCSS', tagline: 'Senior Citizens Savings Scheme' },
];

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

export default function SmallSavingsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeScheme, setActiveScheme] = useState<SmallSavingsScheme>('PPF');
  const [deleteTarget, setDeleteTarget] = useState<Account | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/investments/small-savings').then((r) => r.json());
      setAccounts(r.accounts || []);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load small savings accounts');
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
      const r = await fetch(`/api/investments/small-savings/${deleteTarget.id}`, {
        method: 'DELETE',
      });
      if (!r.ok) throw new Error('delete failed');
      toast.success('Removed');
      setDeleteTarget(null);
      await load();
    } catch (e) {
      console.error(e);
      toast.error('Failed to delete');
    } finally {
      setIsDeleting(false);
    }
  };

  // Aggregate over ACTIVE accounts only — matured / closed don't belong
  // in the running totals.
  const activeAccounts = accounts.filter((a) => a.status === 'ACTIVE' || a.status === 'EXTENDED');
  const totalBalance = activeAccounts.reduce((s, a) => s + a.currentBalancePaisa, 0);
  const totalDeposited = activeAccounts.reduce((s, a) => s + a.totalDepositedPaisa, 0);
  const totalInterest = activeAccounts.reduce((s, a) => s + a.totalInterestPaisa, 0);

  const filtered = accounts.filter((a) => a.schemeType === activeScheme);

  const columns: Column<Account>[] = [
    {
      key: 'accountNumber',
      header: 'Account',
      render: (_v, a) => (
        <div className="flex flex-col">
          <Link
            href={`/investments/small-savings/${a.id}`}
            className="font-semibold text-[var(--dxp-brand)] hover:underline"
          >
            {a.accountNumber}
          </Link>
          {a.institution && (
            <span className="text-xs text-[var(--dxp-text-muted)]">{a.institution}</span>
          )}
        </div>
      ),
    },
    {
      key: 'holderName',
      header: 'Holder',
      render: (_v, a) => (
        <div className="flex flex-col">
          <span className="text-sm text-[var(--dxp-text)]">{a.holderName}</span>
          {a.status !== 'ACTIVE' && (
            <Badge variant="warning">{a.status}</Badge>
          )}
        </div>
      ),
    },
    {
      key: 'openingDate',
      header: 'Opened',
      render: (_v, a) => <span className="text-sm text-[var(--dxp-text-secondary)]">{a.openingDate}</span>,
    },
    {
      key: 'maturityDate',
      header: 'Maturity',
      render: (_v, a) => <span className="text-sm text-[var(--dxp-text-secondary)]">{a.maturityDate}</span>,
    },
    {
      key: 'currentBalancePaisa',
      header: 'Balance',
      render: (_v, a) => (
        <span className="font-mono font-semibold text-[var(--dxp-text)]">
          {formatINR(a.currentBalancePaisa)}
        </span>
      ),
    },
    {
      key: 'interestRatePercent',
      header: 'Rate',
      render: (_v, a) => (
        <span className="font-mono text-sm text-[var(--dxp-text-secondary)]">
          {a.interestRatePercent.toFixed(2)}%
        </span>
      ),
    },
    {
      key: 'id',
      header: '',
      render: (_v, a) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            setDeleteTarget(a);
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
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
            Small Savings
          </h1>
          <p className="text-[var(--dxp-text-secondary)]">
            Govt-backed schemes: PPF, VPF, NSC, KVP, SSY and SCSS
          </p>
        </div>
        <Link href="/investments/small-savings/new">
          <Button variant="primary">
            <Plus className="mr-2 h-4 w-4" />
            Add account
          </Button>
        </Link>
      </div>

      <StatsDisplay
        currency="INR"
        locale="en-IN"
        columns={4}
        stats={[
          { label: 'Active accounts', value: activeAccounts.length, format: 'number' },
          { label: 'Total balance', value: totalBalance / 100, format: 'currency' },
          { label: 'Total deposited', value: totalDeposited / 100, format: 'currency' },
          { label: 'Interest earned', value: totalInterest / 100, format: 'currency' },
        ]}
      />

      {/* Scheme tab strip. Each tab shows the count for that scheme so
          the user can see at a glance where their accounts live. */}
      <div className="flex flex-wrap gap-2 border-b border-[var(--dxp-border)] pb-2">
        {SCHEME_META.map((s) => {
          const count = accounts.filter((a) => a.schemeType === s.key).length;
          const active = activeScheme === s.key;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setActiveScheme(s.key)}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
                active
                  ? 'bg-[var(--dxp-brand)] text-white'
                  : 'bg-[var(--dxp-surface-alt)] text-[var(--dxp-text-secondary)] hover:bg-[var(--dxp-surface)]'
              }`}
            >
              {s.label}
              {count > 0 && (
                <span
                  className={`ml-2 inline-flex items-center justify-center rounded-full px-2 text-xs ${
                    active ? 'bg-white/20 text-white' : 'bg-[var(--dxp-border)] text-[var(--dxp-text)]'
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <Landmark className="h-5 w-5 text-[var(--dxp-brand)]" />
            {SCHEME_META.find((s) => s.key === activeScheme)?.label} accounts ({filtered.length})
            <span className="text-xs font-normal text-[var(--dxp-text-muted)]">
              · {SCHEME_META.find((s) => s.key === activeScheme)?.tagline}
            </span>
          </h3>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Landmark className="h-12 w-12 text-[var(--dxp-text-muted)]" />
              <p className="text-[var(--dxp-text-muted)]">
                No {activeScheme} accounts yet
              </p>
              <Link
                href={`/investments/small-savings/new?scheme=${activeScheme}`}
              >
                <Button variant="primary">
                  <Plus className="mr-2 h-4 w-4" /> Add one
                </Button>
              </Link>
            </div>
          ) : (
            <DataTable<Account> columns={columns} data={filtered} emptyMessage="No accounts" />
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
              <h3 className="text-base font-bold text-[var(--dxp-text)]">Delete account?</h3>
              <p className="text-xs text-[var(--dxp-text-secondary)]">
                Removes <strong>{deleteTarget.accountNumber}</strong> ({deleteTarget.schemeType}).
                Transactions on this account are removed too.
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
