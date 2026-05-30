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
  Input,
  type Column,
} from '@dxp/ui';
import {
  Plus,
  Loader2,
  Repeat,
  Calendar,
  TrendingUp,
  TrendingDown,
  Zap,
  ChevronDown,
  History,
} from 'lucide-react';

interface SIPRow {
  id: number;
  mutualFundId: number;
  schemeName: string | null;
  fundType: string | null;
  monthlyAmount: number; // paisa
  frequency: string;
  startDate: string;
  status: string;
  startingUnits: number;
  currentUnits: number;
  currentValue: number; // paisa
  currentNav: number; // paisa
  totalInvestedSoFar: number; // paisa
  expectedXirr: number | null;
  gainLossPercent: number;
  nextExecutionDate: string | null;
  lastExecutionDate: string | null;
}

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

const statusVariant: Record<string, 'success' | 'warning' | 'default'> = {
  ACTIVE: 'success',
  PAUSED: 'warning',
  COMPLETED: 'default',
};

export default function SipsPage() {
  const [rows, setRows] = useState<SIPRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isExecuting, setIsExecuting] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkExecDate, setBulkExecDate] = useState(new Date().toISOString().slice(0, 10));
  const [isAutoExecuting, setIsAutoExecuting] = useState(false);
  const [overdueDismissed, setOverdueDismissed] = useState(false);
  const [dueSoonOpen, setDueSoonOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(true);
  const [allSipsOpen, setAllSipsOpen] = useState(false);

  interface RecentTxn {
    sipId: number;
    schemeName: string;
    amount: number;        // paisa
    nav: number;           // paisa
    units: number;
    totalUnits: number;
    date: string;
  }
  const [recentTxns, setRecentTxns] = useState<RecentTxn[]>([]);

  const load = useCallback(async () => {
    try {
      const [sipRes, txnRes] = await Promise.all([
        fetch('/api/investments/sips').then((r) => r.json()),
        fetch('/api/investments/sips/recent-transactions').then((r) => r.json()).catch(() => ({ transactions: [] })),
      ]);
      setRows(sipRes.sips || []);
      setRecentTxns(txnRes.transactions || []);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load SIPs');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const activeSips = rows.filter((s) => s.status === 'ACTIVE');
  const monthlyOutflow = activeSips.reduce((s, r) => s + r.monthlyAmount, 0);
  const totalInvested = rows.reduce((s, r) => s + r.totalInvestedSoFar, 0);
  const combinedCurrent = rows.reduce((s, r) => s + r.currentValue, 0);
  const combinedGain = combinedCurrent - totalInvested;
  const combinedGainPct = totalInvested > 0 ? (combinedGain / totalInvested) * 100 : 0;

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllActive = () => {
    setSelectedIds(new Set(activeSips.map((s) => s.id)));
  };

  const clearSelection = () => setSelectedIds(new Set());

  const selectedActiveSips = rows.filter(
    (r) => selectedIds.has(r.id) && r.status === 'ACTIVE'
  );

  const executeBulk = async () => {
    if (!selectedActiveSips.length) return;
    setIsExecuting(true);
    try {
      const results = await Promise.allSettled(
        selectedActiveSips.map((sip) =>
          fetch(`/api/investments/sips/${sip.id}/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              executionDate: bulkExecDate,
              amount: sip.monthlyAmount / 100,
              navOnExecution: sip.currentNav / 100,
            }),
          }).then((r) => {
            if (!r.ok) throw new Error(`SIP #${sip.id} failed`);
            return r.json();
          })
        )
      );
      const succeeded = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) {
        toast.warning(`${succeeded} executed, ${failed} failed`);
      } else {
        toast.success(`${succeeded} SIP${succeeded > 1 ? 's' : ''} executed`);
      }
      setSelectedIds(new Set());
      setShowBulkModal(false);
      setIsLoading(true);
      await load();
    } catch (e) {
      console.error(e);
      toast.error('Bulk execution failed');
    } finally {
      setIsExecuting(false);
    }
  };

  // Overdue SIPs — nextExecutionDate is in the past
  const todayStr = new Date().toISOString().slice(0, 10);
  const overdueSips = activeSips.filter((s) => {
    if (!s.nextExecutionDate) return false;
    return s.nextExecutionDate <= todayStr;
  });

  const autoExecuteAll = async () => {
    setIsAutoExecuting(true);
    try {
      const r = await fetch('/api/investments/sips/auto-execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await r.json();
      if (!r.ok) {
        toast.error(data.error || 'Auto-execute failed');
        return;
      }
      const execCount = data.executed?.length ?? 0;
      const errCount = data.errors?.length ?? 0;
      const skipCount = data.skipped?.length ?? 0;
      if (errCount > 0) {
        toast.warning(`${execCount} executed, ${errCount} errors, ${skipCount} skipped`);
      } else {
        toast.success(`${execCount} installment${execCount !== 1 ? 's' : ''} auto-executed`);
      }
      setOverdueDismissed(true);
      setIsLoading(true);
      await load();
    } catch (e) {
      console.error(e);
      toast.error('Auto-execute failed');
    } finally {
      setIsAutoExecuting(false);
    }
  };

  // Weighted portfolio return by investment size
  const weightedReturn = (() => {
    const eligible = rows.filter((r) => r.totalInvestedSoFar > 0);
    if (!eligible.length) return null;
    const totalWeight = eligible.reduce((s, r) => s + r.totalInvestedSoFar, 0);
    if (totalWeight === 0) return null;
    const weighted = eligible.reduce(
      (s, r) => s + r.gainLossPercent * r.totalInvestedSoFar,
      0
    );
    return weighted / totalWeight;
  })();

  // Due in next 30 days
  const now = new Date();
  const cutoff = new Date();
  cutoff.setDate(now.getDate() + 30);
  const dueSoon = activeSips.filter((s) => {
    if (!s.nextExecutionDate) return false;
    const d = new Date(s.nextExecutionDate);
    return d >= now && d <= cutoff;
  });

  const allActiveSelected =
    activeSips.length > 0 && activeSips.every((s) => selectedIds.has(s.id));

  const columns: Column<SIPRow>[] = [
    {
      key: 'id',
      header: (
        <input
          type="checkbox"
          checked={allActiveSelected}
          onChange={() => (allActiveSelected ? clearSelection() : selectAllActive())}
          className="h-4 w-4 rounded border-[var(--dxp-border)]"
        />
      ),
      render: (_v, r) =>
        r.status === 'ACTIVE' ? (
          <input
            type="checkbox"
            checked={selectedIds.has(r.id)}
            onChange={() => toggleSelect(r.id)}
            className="h-4 w-4 rounded border-[var(--dxp-border)]"
          />
        ) : (
          <span />
        ),
    },
    {
      key: 'schemeName',
      header: 'Scheme',
      render: (_v, r) => (
        <div className="flex flex-col">
          <Link
            href={`/investments/sips/${r.id}`}
            className="font-semibold text-[var(--dxp-text)] hover:text-[var(--dxp-brand)]"
          >
            {r.schemeName ?? 'Unknown'}
          </Link>
          {r.fundType && (
            <span className="text-xs text-[var(--dxp-text-muted)]">{r.fundType}</span>
          )}
        </div>
      ),
    },
    {
      key: 'monthlyAmount',
      header: 'Amount',
      render: (_v, r) => (
        <span className="font-mono font-semibold text-[var(--dxp-text)]">
          {formatINR(r.monthlyAmount)}
        </span>
      ),
    },
    {
      key: 'startDate',
      header: 'Day',
      render: (_v, r) => (
        <span className="font-mono text-[var(--dxp-text-secondary)]">
          {new Date(r.startDate).getDate()}
        </span>
      ),
    },
    {
      key: 'startingUnits',
      header: 'Start units',
      render: (_v, r) => (
        <span className="font-mono text-[var(--dxp-text-secondary)]">{r.startingUnits.toFixed(3)}</span>
      ),
    },
    {
      key: 'currentUnits',
      header: 'Current units',
      render: (_v, r) => (
        <span className="font-mono text-[var(--dxp-text)]">{r.currentUnits.toFixed(3)}</span>
      ),
    },
    {
      key: 'totalInvestedSoFar',
      header: 'Invested',
      render: (_v, r) => (
        <span className="font-mono text-[var(--dxp-text)]">
          {formatINR(r.totalInvestedSoFar)}
        </span>
      ),
    },
    {
      key: 'currentValue',
      header: 'Current value',
      render: (_v, r) => (
        <span className="font-mono font-semibold text-[var(--dxp-text)]">
          {formatINR(r.currentValue)}
        </span>
      ),
    },
    {
      key: 'expectedXirr',
      header: 'XIRR',
      render: (_v, r) => {
        if (r.expectedXirr === null) return <span className="text-xs text-[var(--dxp-text-muted)]">—</span>;
        const positive = r.expectedXirr >= 0;
        return (
          <div className={`flex items-center gap-1 ${positive ? 'text-emerald-600' : 'text-rose-600'}`}>
            {positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            <span className="text-sm font-mono font-medium">{r.expectedXirr.toFixed(2)}%</span>
          </div>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (_v, r) => <Badge variant={statusVariant[r.status] ?? 'default'}>{r.status}</Badge>,
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
          <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">SIPs</h1>
          <p className="text-[var(--dxp-text-secondary)]">
            Systematic investment plans with XIRR tracking
          </p>
        </div>
        <div className="flex gap-2">
          {selectedActiveSips.length > 0 && (
            <Button
              variant="primary"
              onClick={() => setShowBulkModal(true)}
              disabled={isExecuting}
            >
              <Zap className="mr-2 h-4 w-4" />
              Execute {selectedActiveSips.length} SIP{selectedActiveSips.length > 1 ? 's' : ''}
            </Button>
          )}
          <Link href="/investments/sips/new">
            <Button variant="secondary">
              <Plus className="mr-2 h-4 w-4" />
              Register SIP
            </Button>
          </Link>
        </div>
      </div>

      <StatsDisplay
        currency="INR"
        locale="en-IN"
        columns={4}
        stats={[
          { label: 'Active SIPs', value: activeSips.length, format: 'number' },
          { label: 'Monthly outflow', value: monthlyOutflow / 100, format: 'currency' },
          { label: 'Total invested', value: totalInvested / 100, format: 'currency' },
          { label: 'Current value', value: combinedCurrent / 100, format: 'currency' },
        ]}
      />
      <StatsDisplay
        currency="INR"
        locale="en-IN"
        columns={3}
        stats={[
          {
            label: 'Absolute gain',
            value: combinedGain / 100,
            format: 'currency',
            delta: { value: Math.round(combinedGainPct * 100) / 100, label: 'return' },
          },
          {
            label: 'Portfolio return',
            value: weightedReturn !== null ? Math.round(weightedReturn * 100) / 100 : 0,
            format: 'percent',
          },
          { label: 'Annual outflow', value: (monthlyOutflow * 12) / 100, format: 'currency' },
        ]}
      />

      {/* Overdue SIPs banner */}
      {overdueSips.length > 0 && !overdueDismissed && (
        <div className="flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-700 dark:bg-amber-950/40">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            <span className="text-sm font-semibold text-amber-800 dark:text-amber-200">
              {overdueSips.length} SIP{overdueSips.length > 1 ? 's are' : ' is'} overdue
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={autoExecuteAll}
              disabled={isAutoExecuting}
            >
              {isAutoExecuting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Zap className="mr-2 h-4 w-4" />
              )}
              {isAutoExecuting ? 'Executing...' : 'Auto-execute all'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOverdueDismissed(true)}
              disabled={isAutoExecuting}
            >
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {/* Due-this-month strip */}
      {dueSoon.length > 0 && (
        <Card>
          <CardHeader>
            <button
              type="button"
              className="flex w-full items-center justify-between text-left"
              onClick={() => setDueSoonOpen((p) => !p)}
            >
              <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
                <Calendar className="h-5 w-5 text-[var(--dxp-brand)]" />
                Due in next 30 days ({dueSoon.length})
              </h3>
              <ChevronDown
                className={`h-5 w-5 text-[var(--dxp-text-muted)] transition-transform ${dueSoonOpen ? 'rotate-180' : ''}`}
              />
            </button>
          </CardHeader>
          {dueSoonOpen && (
            <CardContent>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {dueSoon.map((s) => (
                  <div
                    key={s.id}
                    className="flex flex-col gap-2 rounded-md border border-[var(--dxp-border)] bg-[var(--dxp-surface)] p-3"
                  >
                    <p className="text-sm font-semibold text-[var(--dxp-text)] line-clamp-1">
                      {s.schemeName}
                    </p>
                    <p className="text-xs text-[var(--dxp-text-muted)]">
                      {formatINR(s.monthlyAmount)} • due{' '}
                      {s.nextExecutionDate
                        ? new Date(s.nextExecutionDate).toLocaleDateString('en-IN')
                        : '—'}
                    </p>
                    <Link href={`/investments/sips/${s.id}`}>
                      <Button variant="secondary" size="sm" className="w-full">
                        Execute
                      </Button>
                    </Link>
                  </div>
                ))}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* Invested in past 30 days */}
      {recentTxns.length > 0 && (
        <Card>
          <CardHeader>
            <button
              type="button"
              className="flex w-full items-center justify-between text-left"
              onClick={() => setRecentOpen((p) => !p)}
            >
              <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
                <History className="h-5 w-5 text-emerald-600" />
                Invested in past 30 days ({recentTxns.length})
                <span className="text-sm font-normal text-[var(--dxp-text-muted)]">
                  {formatINR(recentTxns.reduce((s, t) => s + t.amount, 0))}
                </span>
              </h3>
              <ChevronDown
                className={`h-5 w-5 text-[var(--dxp-text-muted)] transition-transform ${recentOpen ? 'rotate-180' : ''}`}
              />
            </button>
          </CardHeader>
          {recentOpen && (
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--dxp-border)] text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-muted)]">
                      <th className="py-2 text-left">Date</th>
                      <th className="py-2 text-left">Scheme</th>
                      <th className="py-2 text-right">Amount</th>
                      <th className="py-2 text-right">NAV</th>
                      <th className="py-2 text-right">Units</th>
                      <th className="py-2 text-right">Total units</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentTxns.map((t, i) => (
                      <tr key={i} className="border-b border-[var(--dxp-border-light)]">
                        <td className="py-2 font-mono text-xs text-[var(--dxp-text-secondary)]">
                          {t.date}
                        </td>
                        <td className="py-2 text-[var(--dxp-text)]">
                          <Link
                            href={`/investments/sips/${t.sipId}`}
                            className="hover:text-[var(--dxp-brand)] hover:underline"
                          >
                            {t.schemeName}
                          </Link>
                        </td>
                        <td className="py-2 text-right font-mono font-semibold text-[var(--dxp-text)]">
                          {formatINR(t.amount)}
                        </td>
                        <td className="py-2 text-right font-mono text-[var(--dxp-text-secondary)]">
                          ₹{(t.nav / 100).toFixed(2)}
                        </td>
                        <td className="py-2 text-right font-mono text-[var(--dxp-text)]">
                          {t.units.toFixed(3)}
                        </td>
                        <td className="py-2 text-right font-mono text-[var(--dxp-text-secondary)]">
                          {t.totalUnits.toFixed(3)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-[var(--dxp-border)] font-semibold">
                      <td className="py-2" colSpan={2}>Total</td>
                      <td className="py-2 text-right font-mono text-[var(--dxp-text)]">
                        {formatINR(recentTxns.reduce((s, t) => s + t.amount, 0))}
                      </td>
                      <td />
                      <td className="py-2 text-right font-mono text-[var(--dxp-text)]">
                        {recentTxns.reduce((s, t) => s + t.units, 0).toFixed(3)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardContent>
          )}
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <button
              type="button"
              className="flex items-center gap-2 text-left"
              onClick={() => setAllSipsOpen((p) => !p)}
            >
              <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
                <Repeat className="h-5 w-5 text-[var(--dxp-brand)]" />
                All SIPs ({rows.length})
              </h3>
              <ChevronDown
                className={`h-5 w-5 text-[var(--dxp-text-muted)] transition-transform ${allSipsOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {selectedIds.size > 0 && (
              <Button variant="ghost" size="sm" onClick={clearSelection}>
                Clear selection ({selectedIds.size})
              </Button>
            )}
          </div>
        </CardHeader>
        {allSipsOpen && (
          <CardContent>
            {rows.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <p className="text-[var(--dxp-text-muted)]">
                  No SIPs registered yet. Set up your first systematic investment plan.
                </p>
                <Link href="/investments/sips/new">
                  <Button variant="primary">
                    <Plus className="mr-2 h-4 w-4" />
                    Register SIP
                  </Button>
                </Link>
              </div>
            ) : (
              <DataTable<SIPRow> columns={columns} data={rows} emptyMessage="No SIPs" />
            )}
          </CardContent>
        )}
      </Card>

      {/* Bulk execute confirmation modal */}
      {showBulkModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => !isExecuting && setShowBulkModal(false)}
        >
          <Card className="w-full max-w-lg mx-4" onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
                <Zap className="h-5 w-5 text-[var(--dxp-brand)]" />
                Execute {selectedActiveSips.length} SIP{selectedActiveSips.length > 1 ? 's' : ''}
              </h3>
              <p className="text-xs text-[var(--dxp-text-secondary)]">
                Each SIP will be executed at its monthly amount using current NAV.
              </p>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Execution date
                  </label>
                  <Input
                    type="date"
                    value={bulkExecDate}
                    onChange={(e) => setBulkExecDate(e.target.value)}
                  />
                </div>

                <div className="rounded-md border border-[var(--dxp-border)] bg-[var(--dxp-surface)]">
                  <div className="grid grid-cols-3 gap-2 px-3 py-2 border-b border-[var(--dxp-border)] text-xs font-semibold text-[var(--dxp-text-muted)]">
                    <span>Scheme</span>
                    <span className="text-right">Amount</span>
                    <span className="text-right">NAV</span>
                  </div>
                  {selectedActiveSips.map((sip) => (
                    <div
                      key={sip.id}
                      className="grid grid-cols-3 gap-2 px-3 py-2 text-sm border-b last:border-b-0 border-[var(--dxp-border)]"
                    >
                      <span className="text-[var(--dxp-text)] truncate">
                        {sip.schemeName ?? 'Unknown'}
                      </span>
                      <span className="text-right font-mono text-[var(--dxp-text)]">
                        {formatINR(sip.monthlyAmount)}
                      </span>
                      <span className="text-right font-mono text-[var(--dxp-text-secondary)]">
                        {'\u20B9'}{(sip.currentNav / 100).toFixed(2)}
                      </span>
                    </div>
                  ))}
                  <div className="grid grid-cols-3 gap-2 px-3 py-2 bg-[var(--dxp-surface-accent)] font-semibold text-sm">
                    <span className="text-[var(--dxp-text)]">Total</span>
                    <span className="text-right font-mono text-[var(--dxp-text)]">
                      {formatINR(selectedActiveSips.reduce((s, r) => s + r.monthlyAmount, 0))}
                    </span>
                    <span />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    variant="secondary"
                    onClick={() => setShowBulkModal(false)}
                    disabled={isExecuting}
                  >
                    Cancel
                  </Button>
                  <Button variant="primary" onClick={executeBulk} disabled={isExecuting}>
                    {isExecuting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Zap className="mr-2 h-4 w-4" />
                    )}
                    {isExecuting ? 'Executing...' : 'Confirm'}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
