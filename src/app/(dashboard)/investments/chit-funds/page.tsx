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
  Loader2,
  Users,
  Calendar,
  Trash2,
  TrendingUp,
  TrendingDown,
  FileUp,
  ChevronDown,
  History,
  IndianRupee,
} from 'lucide-react';

interface ChitRow {
  id: number;
  foremanName: string;
  schemeName: string;
  chitValue: number;
  monthlyInstallment: number;
  durationMonths: number;
  installmentsPaid: number | null;
  totalPaid: number | null;
  totalDividends: number | null;
  netContribution: number | null;
  status: 'ACTIVE' | 'WON' | 'COMPLETED' | 'WITHDRAWN';
  winAmountReceived: number | null;
  xirr: number | null;
  nextDueDate: string | null;
}

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

const statusVariant: Record<string, 'success' | 'warning' | 'default'> = {
  ACTIVE: 'default',
  WON: 'success',
  COMPLETED: 'default',
  WITHDRAWN: 'warning',
};

export default function ChitFundsPage() {
  const [rows, setRows] = useState<ChitRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dueSoonOpen, setDueSoonOpen] = useState(true);
  const [recentOpen, setRecentOpen] = useState(true);
  const [allChitsOpen, setAllChitsOpen] = useState(false);

  // Quick-pay modal state
  const [payTarget, setPayTarget] = useState<ChitRow | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payDividend, setPayDividend] = useState('');
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [payMethod, setPayMethod] = useState('NEFT');
  const [isPaying, setIsPaying] = useState(false);

  interface RecentInstallment {
    chitId: number;
    schemeName: string;
    monthNumber: number;
    installmentPaid: number;
    dividendReceived: number;
    netOutgo: number;
    paidOn: string;
  }
  const [recentInstallments, setRecentInstallments] = useState<RecentInstallment[]>([]);

  const load = useCallback(async () => {
    try {
      const [chitRes, recentRes] = await Promise.all([
        fetch('/api/investments/chit-funds').then((r) => r.json()),
        fetch('/api/investments/chit-funds/recent-installments').then((r) => r.json()).catch(() => ({ installments: [] })),
      ]);
      setRows(chitRes.chitFunds || []);
      setRecentInstallments(recentRes.installments || []);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load chit funds');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this chit fund and its installment history?')) return;
    try {
      const r = await fetch(`/api/investments/chit-funds/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('delete failed');
      toast.success('Chit fund deleted');
      await load();
    } catch (e) {
      console.error(e);
      toast.error('Failed to delete chit fund');
    }
  };

  const openPayModal = (c: ChitRow) => {
    setPayTarget(c);
    setPayAmount('');
    setPayDividend('0');
    setPayDate(new Date().toISOString().slice(0, 10));
    setPayMethod('NEFT');
  };

  // Auto-calculate dividend when amount paid changes
  const handlePayAmountChange = (val: string) => {
    setPayAmount(val);
    if (payTarget && val) {
      const installment = payTarget.monthlyInstallment / 100;
      const paid = Number(val) || 0;
      const dividend = Math.max(0, installment - paid);
      setPayDividend(dividend > 0 ? dividend.toString() : '0');
    }
  };

  const handlePay = async () => {
    if (!payTarget) return;
    setIsPaying(true);
    try {
      const r = await fetch(`/api/investments/chit-funds/${payTarget.id}/installments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          installmentPaid: Number(payAmount) || 0,
          dividendReceived: Number(payDividend) || 0,
          paidOn: payDate,
          paymentMethod: payMethod,
        }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error || 'Payment failed');
      }
      toast.success(`Installment #${(payTarget.installmentsPaid ?? 0) + 1} recorded for ${payTarget.schemeName}`);
      setPayTarget(null);
      setIsLoading(true);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Payment failed');
    } finally {
      setIsPaying(false);
    }
  };

  const activeChits = rows.filter((c) => c.status === 'ACTIVE');
  const totalValue = rows.reduce((s, r) => s + r.monthlyInstallment * (r.installmentsPaid ?? 0), 0);
  const totalNetOutgo = rows.reduce((s, r) => s + (r.totalPaid ?? 0), 0);
  const totalDividends = rows.reduce((s, r) => s + (r.totalDividends ?? 0), 0);
  const totalWinnings = rows.reduce((s, r) => s + (r.winAmountReceived ?? 0), 0);

  // Weighted XIRR by net outgo
  const weightedXirr = (() => {
    const eligible = rows.filter((r) => r.xirr !== null && (r.totalPaid ?? 0) > 0);
    if (!eligible.length) return null;
    const totalWeight = eligible.reduce((s, r) => s + (r.totalPaid ?? 0), 0);
    if (totalWeight === 0) return null;
    const weighted = eligible.reduce(
      (s, r) => s + (r.xirr ?? 0) * (r.totalPaid ?? 0),
      0
    );
    return weighted / totalWeight;
  })();

  // Due within next 30 days
  const now = new Date();
  const cutoff = new Date();
  cutoff.setDate(now.getDate() + 30);
  const dueSoon = activeChits.filter((c) => {
    if (!c.nextDueDate) return false;
    const d = new Date(c.nextDueDate);
    return d >= now && d <= cutoff;
  });

  const columns: Column<ChitRow>[] = [
    {
      key: 'schemeName',
      header: 'Scheme',
      render: (_v, r) => (
        <div className="flex flex-col">
          <Link
            href={`/investments/chit-funds/${r.id}`}
            className="font-semibold text-[var(--dxp-text)] hover:text-[var(--dxp-brand)]"
          >
            {r.schemeName}
          </Link>
          <span className="text-xs text-[var(--dxp-text-muted)]">{r.foremanName}</span>
        </div>
      ),
    },
    {
      key: 'chitValue',
      header: 'Chit value',
      render: (_v, r) => (
        <span className="font-mono text-[var(--dxp-text)]">{formatINR(r.chitValue)}</span>
      ),
    },
    {
      key: 'monthlyInstallment',
      header: 'Installment',
      render: (_v, r) => (
        <span className="font-mono text-[var(--dxp-text)]">
          {formatINR(r.monthlyInstallment)}
        </span>
      ),
    },
    {
      key: 'installmentsPaid',
      header: 'Progress',
      render: (_v, r) => (
        <span className="font-mono text-[var(--dxp-text-secondary)]">
          {r.installmentsPaid ?? 0} / {r.durationMonths}
        </span>
      ),
    },
    {
      key: 'totalPaid',
      header: 'Net outgo',
      render: (_v, r) => (
        <span className="font-mono font-semibold text-[var(--dxp-text)]">
          {formatINR(r.totalPaid ?? 0)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (_v, r) => (
        <Badge variant={statusVariant[r.status] ?? 'default'}>{r.status}</Badge>
      ),
    },
    {
      key: 'xirr',
      header: 'XIRR',
      render: (_v, r) => {
        if (r.xirr === null) return <span className="text-xs text-[var(--dxp-text-muted)]">—</span>;
        const positive = r.xirr >= 0;
        return (
          <div
            className={`flex items-center gap-1 ${positive ? 'text-emerald-600' : 'text-rose-600'}`}
          >
            {positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            <span className="text-sm font-mono font-medium">{r.xirr.toFixed(2)}%</span>
          </div>
        );
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
            handleDelete(r.id);
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
          <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">Chit Funds</h1>
          <p className="text-[var(--dxp-text-secondary)]">
            Track your chit subscriptions with auction dividends and XIRR
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/investments/import?type=chit">
            <Button variant="secondary">
              <FileUp className="mr-2 h-4 w-4" />
              Import from PDF
            </Button>
          </Link>
          <Link href="/investments/chit-funds/new">
            <Button variant="primary">
              <Plus className="mr-2 h-4 w-4" />
              Register chit
            </Button>
          </Link>
        </div>
      </div>

      <StatsDisplay
        currency="INR"
        locale="en-IN"
        columns={3}
        stats={[
          { label: 'Active chits', value: activeChits.length, format: 'number' },
          { label: 'Total value', value: totalValue / 100, format: 'currency' },
          { label: 'Net outgo', value: totalNetOutgo / 100, format: 'currency' },
        ]}
      />
      <StatsDisplay
        currency="INR"
        locale="en-IN"
        columns={3}
        stats={[
          { label: 'Dividends received', value: totalDividends / 100, format: 'currency' },
          { label: 'Winnings received', value: totalWinnings / 100, format: 'currency' },
          { label: 'Portfolio XIRR', value: weightedXirr ?? 0, format: 'percent' },
        ]}
      />

      {/* Due in next 30 days */}
      {dueSoon.length > 0 && (
        <Card>
          <CardHeader>
            <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setDueSoonOpen((p) => !p)}>
              <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
                <Calendar className="h-5 w-5 text-[var(--dxp-brand)]" />
                Due in next 30 days ({dueSoon.length})
              </h3>
              <ChevronDown className={`h-5 w-5 text-[var(--dxp-text-muted)] transition-transform ${dueSoonOpen ? 'rotate-180' : ''}`} />
            </button>
          </CardHeader>
          {dueSoonOpen && (
            <CardContent>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {dueSoon.map((c) => {
                  const days = c.nextDueDate
                    ? Math.max(0, Math.ceil((new Date(c.nextDueDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
                    : 0;
                  return (
                    <div key={c.id} className="flex flex-col gap-2 rounded-md border border-[var(--dxp-border)] bg-[var(--dxp-surface)] p-3">
                      <p className="text-sm font-semibold text-[var(--dxp-text)] line-clamp-1">{c.schemeName}</p>
                      <p className="text-xs text-[var(--dxp-text-muted)]">
                        {formatINR(c.monthlyInstallment)} • #{(c.installmentsPaid ?? 0) + 1} of {c.durationMonths} • in {days} day{days === 1 ? '' : 's'}
                      </p>
                      <Button variant="primary" size="sm" className="w-full" onClick={() => openPayModal(c)}>
                        <IndianRupee className="mr-1 h-3 w-3" /> Pay installment
                      </Button>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* Recent payments (past 30 days) */}
      {recentInstallments.length > 0 && (
        <Card>
          <CardHeader>
            <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setRecentOpen((p) => !p)}>
              <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
                <History className="h-5 w-5 text-emerald-600" />
                Paid this month ({recentInstallments.length})
                <span className="text-sm font-normal text-[var(--dxp-text-muted)]">
                  {formatINR(recentInstallments.reduce((s, t) => s + t.installmentPaid, 0))}
                </span>
              </h3>
              <ChevronDown className={`h-5 w-5 text-[var(--dxp-text-muted)] transition-transform ${recentOpen ? 'rotate-180' : ''}`} />
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
                      <th className="py-2 text-right">Month #</th>
                      <th className="py-2 text-right">Paid</th>
                      <th className="py-2 text-right">Dividend</th>
                      <th className="py-2 text-right">Installment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentInstallments.map((t, i) => (
                      <tr key={i} className="border-b border-[var(--dxp-border-light)]">
                        <td className="py-2 font-mono text-xs text-[var(--dxp-text-secondary)]">{t.paidOn}</td>
                        <td className="py-2 text-[var(--dxp-text)]">
                          <Link href={`/investments/chit-funds/${t.chitId}`} className="hover:text-[var(--dxp-brand)] hover:underline">
                            {t.schemeName}
                          </Link>
                        </td>
                        <td className="py-2 text-right font-mono text-[var(--dxp-text-secondary)]">{t.monthNumber}</td>
                        <td className="py-2 text-right font-mono font-semibold text-[var(--dxp-text)]">{formatINR(t.installmentPaid)}</td>
                        <td className="py-2 text-right font-mono text-emerald-600">{formatINR(t.dividendReceived)}</td>
                        <td className="py-2 text-right font-mono text-[var(--dxp-text-secondary)]">{formatINR(t.installmentPaid + t.dividendReceived)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-[var(--dxp-border)] font-semibold">
                      <td className="py-2" colSpan={3}>Total</td>
                      <td className="py-2 text-right font-mono">{formatINR(recentInstallments.reduce((s, t) => s + t.installmentPaid, 0))}</td>
                      <td className="py-2 text-right font-mono text-emerald-600">{formatINR(recentInstallments.reduce((s, t) => s + t.dividendReceived, 0))}</td>
                      <td className="py-2 text-right font-mono">{formatINR(recentInstallments.reduce((s, t) => s + t.installmentPaid + t.dividendReceived, 0))}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* All chit funds */}
      <Card>
        <CardHeader>
          <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setAllChitsOpen((p) => !p)}>
            <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
              <Users className="h-5 w-5 text-[var(--dxp-brand)]" />
              All chit funds ({rows.length})
            </h3>
            <ChevronDown className={`h-5 w-5 text-[var(--dxp-text-muted)] transition-transform ${allChitsOpen ? 'rotate-180' : ''}`} />
          </button>
        </CardHeader>
        {allChitsOpen && (
          <CardContent>
            {rows.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <p className="text-[var(--dxp-text-muted)]">No chit funds registered yet.</p>
                <Link href="/investments/chit-funds/new">
                  <Button variant="primary"><Plus className="mr-2 h-4 w-4" /> Register chit</Button>
                </Link>
              </div>
            ) : (
              <DataTable<ChitRow> columns={columns} data={rows} emptyMessage="No chit funds" />
            )}
          </CardContent>
        )}
      </Card>

      {/* Quick-pay modal */}
      {payTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => !isPaying && setPayTarget(null)}>
          <Card className="w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <h3 className="text-base font-bold text-[var(--dxp-text)]">
                Record installment #{(payTarget.installmentsPaid ?? 0) + 1}
              </h3>
              <p className="text-xs text-[var(--dxp-text-secondary)]">
                {payTarget.schemeName} · {payTarget.foremanName}
              </p>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                  Monthly installment: <span className="font-mono font-bold">{formatINR(payTarget.monthlyInstallment)}</span>
                  <span className="text-amber-600 ml-2">(enter amount actually paid — dividend auto-calculates)</span>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                    Amount paid (₹)
                  </label>
                  <input
                    type="number"
                    value={payAmount}
                    onChange={(e) => handlePayAmountChange(e.target.value)}
                    placeholder={`e.g. ${(payTarget.monthlyInstallment / 100) - 2000}`}
                    className="w-full rounded border border-[var(--dxp-border)] bg-[var(--dxp-surface)] p-2 text-sm font-mono text-[var(--dxp-text)] focus:border-[var(--dxp-brand)] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                    Dividend (auto-calculated)
                  </label>
                  <input
                    type="number"
                    value={payDividend}
                    onChange={(e) => setPayDividend(e.target.value)}
                    className="w-full rounded border border-[var(--dxp-border)] bg-[var(--dxp-surface)] p-2 text-sm font-mono text-emerald-700 focus:border-[var(--dxp-brand)] focus:outline-none"
                  />
                  <p className="mt-1 text-xs text-[var(--dxp-text-muted)]">
                    = {formatINR(payTarget.monthlyInstallment)} installment − ₹{Number(payAmount || 0).toLocaleString('en-IN')} paid
                  </p>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                    Paid on
                  </label>
                  <input
                    type="date"
                    value={payDate}
                    onChange={(e) => setPayDate(e.target.value)}
                    className="w-full rounded border border-[var(--dxp-border)] bg-[var(--dxp-surface)] p-2 text-sm text-[var(--dxp-text)] focus:border-[var(--dxp-brand)] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                    Payment method
                  </label>
                  <select
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value)}
                    className="w-full rounded border border-[var(--dxp-border)] bg-[var(--dxp-surface)] p-2 text-sm text-[var(--dxp-text)] focus:border-[var(--dxp-brand)] focus:outline-none"
                  >
                    <option value="NEFT">NEFT / RTGS</option>
                    <option value="UPI">UPI</option>
                    <option value="CHEQUE">Cheque</option>
                    <option value="CASH">Cash</option>
                    <option value="CARD">Card</option>
                  </select>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="secondary" onClick={() => setPayTarget(null)} disabled={isPaying}>Cancel</Button>
                  <Button variant="primary" onClick={handlePay} disabled={isPaying || !payAmount}>
                    {isPaying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <IndianRupee className="mr-2 h-4 w-4" />}
                    {isPaying ? 'Recording...' : 'Record payment'}
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
