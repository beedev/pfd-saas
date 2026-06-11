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
import { Plus, Trash2, Loader2, Landmark } from 'lucide-react';
import { ContextualImport } from '@/components/import/contextual-import';
import type { NpsSotParsed } from '@/lib/services/statement-parsers';

interface NPSAccount {
  id: number;
  accountNumber: string;
  accountHolder: string;
  pan: string;
  tier: 'TIER1' | 'TIER2';
  status: string | null;
  equityFundValue: number | null;
  debtFundValue: number | null;
  alternativeFundValue: number | null;
  totalValue: number;
  totalContributed: number;
  employerContribution: number | null;
  gainLoss: number | null;
  openingDate: string;
  expectedMaturityDate: string | null;
  notes: string | null;
}

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

export default function NPSPage() {
  const [accounts, setAccounts] = useState<NPSAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<NPSAccount | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/investments/nps').then((r) => r.json());
      setAccounts(r.accounts || []);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load NPS accounts');
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
      const r = await fetch(`/api/investments/nps/${deleteTarget.id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('delete failed');
      toast.success(`Removed ${deleteTarget.accountNumber}`);
      setDeleteTarget(null);
      await load();
    } catch (e) {
      console.error(e);
      toast.error('Failed to delete account');
    } finally {
      setIsDeleting(false);
    }
  };

  const totalValue = accounts.reduce((s, a) => s + a.totalValue, 0);
  const totalContributed = accounts.reduce((s, a) => s + a.totalContributed, 0);
  const tier1Value = accounts.filter((a) => a.tier === 'TIER1').reduce((s, a) => s + a.totalValue, 0);
  const tier2Value = accounts.filter((a) => a.tier === 'TIER2').reduce((s, a) => s + a.totalValue, 0);

  const totalEquity = accounts.reduce((s, a) => s + (a.equityFundValue ?? 0), 0);
  const totalDebt = accounts.reduce((s, a) => s + (a.debtFundValue ?? 0), 0);
  const totalAlt = accounts.reduce((s, a) => s + (a.alternativeFundValue ?? 0), 0);
  const allocTotal = totalEquity + totalDebt + totalAlt;
  const equityPct = allocTotal > 0 ? (totalEquity / allocTotal) * 100 : 0;
  const debtPct = allocTotal > 0 ? (totalDebt / allocTotal) * 100 : 0;
  const altPct = allocTotal > 0 ? (totalAlt / allocTotal) * 100 : 0;

  const columns: Column<NPSAccount>[] = [
    {
      key: 'accountNumber',
      header: 'PRAN',
      render: (_v, a) => (
        <div className="flex flex-col">
          <Link
            href={`/investments/nps/${a.id}`}
            className="font-mono font-semibold text-[var(--dxp-brand)] hover:underline"
          >
            {a.accountNumber}
          </Link>
          <span className="text-xs text-[var(--dxp-text-muted)]">{a.accountHolder}</span>
        </div>
      ),
    },
    {
      key: 'tier',
      header: 'Tier',
      render: (_v, a) => (
        <Badge variant={a.tier === 'TIER1' ? 'success' : 'info'}>
          {a.tier === 'TIER1' ? 'Tier I' : 'Tier II'}
        </Badge>
      ),
    },
    {
      key: 'totalValue',
      header: 'Current Value',
      render: (_v, a) => (
        <span className="font-mono font-semibold text-[var(--dxp-text)]">
          {formatINR(a.totalValue)}
        </span>
      ),
    },
    {
      key: 'totalContributed',
      header: 'Contributions',
      render: (_v, a) => (
        <span className="font-mono text-[var(--dxp-text-secondary)]">
          {formatINR(a.totalContributed)}
        </span>
      ),
    },
    {
      key: 'openingDate',
      header: 'Opened',
      render: (_v, a) => (
        <span className="text-xs text-[var(--dxp-text-secondary)]">{a.openingDate}</span>
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
          <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">NPS</h1>
          <p className="text-[var(--dxp-text-secondary)]">National Pension System accounts</p>
        </div>
        <div className="flex gap-3">
          <ContextualImport<NpsSotParsed>
            buttonLabel="Import NPS statement"
            title="Import NPS Statement of Transactions"
            subtitle="Protean / KFin CRA Statement of Transactions PDF"
            accept=".pdf"
            hint="nps-sot"
            canImport={(p) => p?.type === 'nps-sot'}
            commit={async (p) => {
              const r = await fetch('/api/investments/import/commit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'nps-sot', data: p.data }),
              });
              const d = await r.json();
              if (!r.ok) throw new Error(d?.error || 'Import failed');
            }}
            onImported={load}
            renderPreview={(p) => (
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <Badge variant="info">{p.confidence}</Badge>
                  <span className="text-xs text-[var(--dxp-text-muted)]">
                    {p.data.subscriberName || 'NPS subscriber'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <span className="text-[var(--dxp-text-muted)]">PRAN</span>
                  <span className="font-mono">{p.data.pran || '—'}</span>
                  <span className="text-[var(--dxp-text-muted)]">Tier</span>
                  <span className="font-mono">{p.data.tier || '—'}</span>
                  <span className="text-[var(--dxp-text-muted)]">Total value</span>
                  <span className="font-mono">{formatINR(p.data.totalValuePaisa)}</span>
                  <span className="text-[var(--dxp-text-muted)]">Contributed</span>
                  <span className="font-mono">{formatINR(p.data.totalContributedPaisa)}</span>
                </div>
                {p.warnings.map((w, i) => (
                  <p key={i} className="rounded bg-amber-50 p-2 text-xs text-amber-800">⚠ {w}</p>
                ))}
              </div>
            )}
          />
          <Link href="/investments/nps/new">
            <Button variant="primary">
              <Plus className="mr-2 h-4 w-4" />
              Add NPS account
            </Button>
          </Link>
        </div>
      </div>

      <StatsDisplay
        currency="INR"
        locale="en-IN"
        columns={4}
        stats={[
          { label: 'Total NPS Value', value: totalValue / 100, format: 'currency' },
          { label: 'Tier I Value', value: tier1Value / 100, format: 'currency' },
          { label: 'Tier II Value', value: tier2Value / 100, format: 'currency' },
          { label: 'Total Contributions', value: totalContributed / 100, format: 'currency' },
        ]}
      />

      {allocTotal > 0 && (
        <Card>
          <CardHeader>
            <h3 className="text-base font-bold text-[var(--dxp-text)]">Asset allocation</h3>
            <p className="text-xs text-[var(--dxp-text-muted)]">Across all NPS accounts</p>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-semibold text-[var(--dxp-text)]">Equity</span>
                  <span className="font-mono text-[var(--dxp-text-secondary)]">
                    {equityPct.toFixed(1)}% · {formatINR(totalEquity)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[var(--dxp-border-light)]">
                  <div className="h-full bg-[var(--dxp-brand)]" style={{ width: `${equityPct}%` }} />
                </div>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-semibold text-[var(--dxp-text)]">Debt (Corp + Govt)</span>
                  <span className="font-mono text-[var(--dxp-text-secondary)]">
                    {debtPct.toFixed(1)}% · {formatINR(totalDebt)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[var(--dxp-border-light)]">
                  <div className="h-full bg-emerald-500" style={{ width: `${debtPct}%` }} />
                </div>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-semibold text-[var(--dxp-text)]">Alternative</span>
                  <span className="font-mono text-[var(--dxp-text-secondary)]">
                    {altPct.toFixed(1)}% · {formatINR(totalAlt)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[var(--dxp-border-light)]">
                  <div className="h-full bg-amber-500" style={{ width: `${altPct}%` }} />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <Landmark className="h-5 w-5 text-[var(--dxp-brand)]" />
            Accounts ({accounts.length})
          </h3>
        </CardHeader>
        <CardContent>
          {accounts.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Landmark className="h-12 w-12 text-[var(--dxp-text-muted)]" />
              <p className="text-[var(--dxp-text-muted)]">
                No NPS accounts yet. Add your first account to get started.
              </p>
              <Link href="/investments/nps/new">
                <Button variant="primary">
                  <Plus className="mr-2 h-4 w-4" />
                  Add NPS account
                </Button>
              </Link>
            </div>
          ) : (
            <DataTable<NPSAccount> columns={columns} data={accounts} emptyMessage="No accounts" />
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
                This will remove <strong>{deleteTarget.accountNumber}</strong>. This cannot be undone.
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
