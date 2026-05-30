'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';

import { Button, Card, CardHeader, CardContent, Badge, StatsDisplay, DataTable, type Column } from '@dxp/ui';
import { Plus, Trash2, Loader2, ShieldCheck } from 'lucide-react';

interface PFAccount {
  id: number;
  accountType: 'EPF' | 'PPF' | 'VPF';
  accountNumber: string | null;
  accountHolder: string;
  universalAccountNumber: string | null;
  employeeBalance: number | null;
  employerBalance: number | null;
  interestBalance: number | null;
  totalBalance: number;
  totalContributed: number;
  interestEarned: number | null;
  ppfMaturityDate: string | null;
  openingDate: string;
  notes: string | null;
}

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

const monthsBetween = (a: Date, b: Date) => {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
};

export default function PFPage() {
  const [accounts, setAccounts] = useState<PFAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<PFAccount | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/investments/pf').then((r) => r.json());
      setAccounts(r.accounts || []);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load PF accounts');
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
      const r = await fetch(`/api/investments/pf/${deleteTarget.id}`, { method: 'DELETE' });
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

  const totalAll = accounts.reduce((s, a) => s + a.totalBalance, 0);
  const epfTotal = accounts.filter((a) => a.accountType === 'EPF').reduce((s, a) => s + a.totalBalance, 0);
  const ppfTotal = accounts.filter((a) => a.accountType === 'PPF').reduce((s, a) => s + a.totalBalance, 0);
  const vpfTotal = accounts.filter((a) => a.accountType === 'VPF').reduce((s, a) => s + a.totalBalance, 0);

  const groups: Array<{ type: 'EPF' | 'PPF' | 'VPF'; label: string; rate: number }> = [
    { type: 'EPF', label: 'Employees Provident Fund', rate: 8.15 },
    { type: 'PPF', label: 'Public Provident Fund', rate: 7.1 },
    { type: 'VPF', label: 'Voluntary Provident Fund', rate: 8.15 },
  ];

  const columns: Column<PFAccount>[] = [
    {
      key: 'accountType',
      header: 'Type',
      render: (_v, a) => (
        <Badge variant={a.accountType === 'PPF' ? 'success' : a.accountType === 'EPF' ? 'info' : 'warning'}>
          {a.accountType}
        </Badge>
      ),
    },
    {
      key: 'accountNumber',
      header: 'Account / UAN',
      render: (_v, a) => (
        <Link
          href={`/investments/pf/${a.id}`}
          className="font-mono text-[var(--dxp-brand)] hover:underline"
        >
          {a.universalAccountNumber || a.accountNumber || a.accountHolder}
        </Link>
      ),
    },
    {
      key: 'accountHolder',
      header: 'Holder',
      render: (_v, a) => <span className="text-sm text-[var(--dxp-text)]">{a.accountHolder}</span>,
    },
    {
      key: 'totalBalance',
      header: 'Balance',
      render: (_v, a) => (
        <span className="font-mono font-semibold text-[var(--dxp-text)]">{formatINR(a.totalBalance)}</span>
      ),
    },
    {
      key: 'interestEarned',
      header: 'Interest Earned',
      render: (_v, a) => (
        <span className="font-mono text-[var(--dxp-text-secondary)]">{formatINR(a.interestEarned ?? 0)}</span>
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">Provident Fund</h1>
          <p className="text-[var(--dxp-text-secondary)]">EPF, PPF and VPF balances</p>
        </div>
        <Link href="/investments/pf/new">
          <Button variant="primary">
            <Plus className="mr-2 h-4 w-4" />
            Add PF account
          </Button>
        </Link>
      </div>

      <StatsDisplay
        currency="INR"
        locale="en-IN"
        columns={4}
        stats={[
          { label: 'Total PF', value: totalAll / 100, format: 'currency' },
          { label: 'EPF', value: epfTotal / 100, format: 'currency' },
          { label: 'PPF', value: ppfTotal / 100, format: 'currency' },
          { label: 'VPF', value: vpfTotal / 100, format: 'currency' },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-3">
        {groups.map((g) => {
          const list = accounts.filter((a) => a.accountType === g.type);
          const balance = list.reduce((s, a) => s + a.totalBalance, 0);
          const ppfAccount = g.type === 'PPF' ? list[0] : null;
          let maturityNote: string | null = null;
          if (ppfAccount?.ppfMaturityDate) {
            const months = monthsBetween(new Date(), new Date(ppfAccount.ppfMaturityDate));
            if (months > 0) {
              const years = Math.floor(months / 12);
              const rem = months % 12;
              maturityNote = `Matures in ${years}y ${rem}m`;
            } else {
              maturityNote = 'Matured';
            }
          }
          return (
            <Card key={g.type}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-[var(--dxp-text)]">{g.label}</h3>
                  <Badge variant="info">{g.type}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold font-mono text-[var(--dxp-text)]">
                  {formatINR(balance)}
                </p>
                <p className="mt-1 text-xs text-[var(--dxp-text-muted)]">
                  {list.length} account{list.length === 1 ? '' : 's'} · interest ~{g.rate}%
                </p>
                {maturityNote && (
                  <p className="mt-2 text-xs font-semibold text-amber-700">{maturityNote}</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <ShieldCheck className="h-5 w-5 text-[var(--dxp-brand)]" />
            Accounts ({accounts.length})
          </h3>
        </CardHeader>
        <CardContent>
          {accounts.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <ShieldCheck className="h-12 w-12 text-[var(--dxp-text-muted)]" />
              <p className="text-[var(--dxp-text-muted)]">No PF accounts yet.</p>
              <Link href="/investments/pf/new">
                <Button variant="primary">
                  <Plus className="mr-2 h-4 w-4" /> Add PF account
                </Button>
              </Link>
            </div>
          ) : (
            <DataTable<PFAccount> columns={columns} data={accounts} emptyMessage="No accounts" />
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
              <h3 className="text-base font-bold text-[var(--dxp-text)]">Delete PF account?</h3>
              <p className="text-xs text-[var(--dxp-text-secondary)]">
                Removes <strong>{deleteTarget.accountType}</strong> for {deleteTarget.accountHolder}.
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
