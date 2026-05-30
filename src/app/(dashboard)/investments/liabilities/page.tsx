'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';

import { Button, Card, CardHeader, CardContent, Badge, StatsDisplay, Input } from '@dxp/ui';
import { Plus, Loader2, CreditCard, Trash2, Banknote, Receipt, Pencil, CheckCircle2 } from 'lucide-react';

interface Liability {
  id: number;
  name: string;
  type: 'HOME_LOAN' | 'AUTO_LOAN' | 'PERSONAL_LOAN' | 'CREDIT_CARD' | 'EDUCATION_LOAN' | 'OTHER';
  status: string | null;
  creditorName: string;
  originalAmount: number;
  currentBalance: number;
  interestRate: number;
  monthlyEmi: number;
  startDate: string;
  maturityDate: string | null;
  remainingTenor: number | null;
  notes: string | null;
}

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

export default function LiabilitiesPage() {
  const [items, setItems] = useState<Liability[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<Liability | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Record/edit statement modal. If the card already has a statement this
  // period, the modal opens pre-filled so the user can adjust values — the
  // backend POST endpoint upserts by (card, due-date-month).
  const [stmtCard, setStmtCard] = useState<Liability | null>(null);
  const [stmtAmount, setStmtAmount] = useState('');
  const [stmtDate, setStmtDate] = useState(new Date().toISOString().substring(0, 10));
  const [stmtDueDate, setStmtDueDate] = useState('');
  const [stmtNotes, setStmtNotes] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isEditingExisting, setIsEditingExisting] = useState(false);
  const [stmtLoading, setStmtLoading] = useState(false);

  // Mark statement paid modal
  const [payCard, setPayCard] = useState<Liability | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [paySettledOn, setPaySettledOn] = useState(new Date().toISOString().substring(0, 10));
  const [isPaying, setIsPaying] = useState(false);

  const openStmtModal = async (card: Liability) => {
    setStmtCard(card);
    // Default to blank fields — gets overwritten only when there's an
    // outstanding (unpaid) statement to edit.
    setStmtAmount('');
    setStmtDate(new Date().toISOString().substring(0, 10));
    setStmtDueDate('');
    setStmtNotes('');
    setIsEditingExisting(false);
    setStmtLoading(true);
    try {
      const r = await fetch(`/api/investments/liabilities/${card.id}/expenses`);
      const data = await r.json();
      const expenses = data?.expenses ?? [];
      // Only pre-fill if there's an outstanding (paidAmount IS NULL) statement
      // — that's the user editing a due bill before paying it. When every
      // statement is settled, start fresh so the user can record the next
      // month's bill.
      const outstanding = expenses.find(
        (e: { paidAmount: number | null }) => e.paidAmount == null,
      );
      if (outstanding) {
        setStmtAmount(((outstanding.amount ?? 0) / 100).toFixed(2));
        setStmtDate(outstanding.statementDate ?? new Date().toISOString().substring(0, 10));
        setStmtDueDate(outstanding.dueDate ?? '');
        setStmtNotes(outstanding.notes ?? '');
        setIsEditingExisting(true);
      }
    } catch (e) {
      console.error('Failed to pre-fill statement:', e);
      // Non-blocking — user can still type fresh values
    } finally {
      setStmtLoading(false);
    }
  };

  const openPayModal = (card: Liability) => {
    setPayCard(card);
    setPayAmount(((card.currentBalance || 0) / 100).toFixed(2));
    setPaySettledOn(new Date().toISOString().substring(0, 10));
  };

  const markPaid = async () => {
    if (!payCard) return;
    const amt = Number(payAmount);
    if (!amt || amt <= 0) { toast.error('Enter a valid amount'); return; }
    if (!paySettledOn) { toast.error('Enter settled date'); return; }
    setIsPaying(true);
    try {
      const r = await fetch(`/api/investments/liabilities/${payCard.id}/mark-statement-paid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountRupees: amt, settledOn: paySettledOn }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || 'Failed');
      toast.success(`${payCard.name} — marked paid`);
      setPayCard(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to mark paid');
    } finally {
      setIsPaying(false);
    }
  };

  const recordStatement = async () => {
    if (!stmtCard) return;
    const amt = Number(stmtAmount);
    if (!amt || amt <= 0) { toast.error('Enter a valid amount'); return; }
    if (!stmtDate) { toast.error('Enter statement date'); return; }
    if (!stmtDueDate) { toast.error('Enter due date'); return; }
    setIsRecording(true);
    try {
      const r = await fetch(`/api/investments/liabilities/${stmtCard.id}/expenses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amt,
          statementDate: stmtDate,
          dueDate: stmtDueDate,
          notes: stmtNotes || null,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || 'Failed');
      const dueMo = new Date(stmtDueDate).toLocaleString('en-IN', { month: 'short', year: '2-digit' });
      toast.success(`${stmtCard.name} — ${dueMo} budget updated`);
      setStmtCard(null);
      load(); // refresh balances
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to record');
    } finally {
      setIsRecording(false);
    }
  };

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/investments/liabilities').then((r) => r.json());
      setItems(r.liabilities || []);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load liabilities');
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
      const r = await fetch(`/api/investments/liabilities/${deleteTarget.id}`, { method: 'DELETE' });
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

  const cards = items.filter((i) => i.type === 'CREDIT_CARD');
  const loans = items.filter((i) => i.type !== 'CREDIT_CARD');

  const totalDebt = items.reduce((s, i) => s + i.currentBalance, 0);
  const monthlyObligations = items.reduce((s, i) => s + i.monthlyEmi, 0);
  const totalCreditLimit = cards.reduce((s, c) => s + c.originalAmount, 0);
  const totalCardOutstanding = cards.reduce((s, c) => s + c.currentBalance, 0);
  const avgUtilisation =
    totalCreditLimit > 0 ? (totalCardOutstanding / totalCreditLimit) * 100 : 0;

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
          <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">Liabilities</h1>
          <p className="text-[var(--dxp-text-secondary)]">Loans, credit cards and other debts</p>
        </div>
        <Link href="/investments/liabilities/new">
          <Button variant="primary">
            <Plus className="mr-2 h-4 w-4" />
            Add liability
          </Button>
        </Link>
      </div>

      <StatsDisplay
        currency="INR"
        locale="en-IN"
        columns={4}
        stats={[
          { label: 'Total Debt', value: totalDebt / 100, format: 'currency' },
          { label: 'Monthly Obligations', value: monthlyObligations / 100, format: 'currency' },
          { label: 'Total Credit Limit', value: totalCreditLimit / 100, format: 'currency' },
          {
            label: 'Avg Utilisation',
            value: Math.round(avgUtilisation * 10) / 10,
            format: 'number',
          },
        ]}
      />

      {cards.length > 0 && (
        <Card>
          <CardHeader>
            <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
              <CreditCard className="h-5 w-5 text-[var(--dxp-brand)]" />
              Credit cards ({cards.length})
            </h3>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {cards.map((c) => {
                const used = c.currentBalance;
                const limit = c.originalAmount;
                const util = limit > 0 ? (used / limit) * 100 : 0;
                const high = util > 30;
                return (
                  <div
                    key={c.id}
                    className={`rounded-lg border p-4 ${
                      high ? 'border-amber-300 bg-amber-50' : 'border-[var(--dxp-border-light)] bg-[var(--dxp-surface)]'
                    }`}
                  >
                    <Link
                      href={`/investments/liabilities/${c.id}`}
                      className="font-bold text-[var(--dxp-text)] hover:text-[var(--dxp-brand)]"
                    >
                      {c.name}
                    </Link>
                    <p className="text-xs text-[var(--dxp-text-muted)]">{c.creditorName}</p>
                    <p className="mt-2 text-xs text-[var(--dxp-text-secondary)]">
                      Used <span className="font-mono font-bold text-[var(--dxp-text)]">{formatINR(used)}</span> of{' '}
                      {formatINR(limit)}
                    </p>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--dxp-border-light)]">
                      <div
                        className={`h-full ${high ? 'bg-amber-500' : 'bg-emerald-500'}`}
                        style={{ width: `${Math.min(100, util)}%` }}
                      />
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <p className="text-xs text-[var(--dxp-text-muted)]">{util.toFixed(1)}% utilisation</p>
                      <div className="flex gap-1">
                        <Link href={`/investments/liabilities/${c.id}`}>
                          <Button variant="ghost" size="sm">
                            <Pencil className="h-3 w-3" />
                          </Button>
                        </Link>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={(e) => { e.preventDefault(); openStmtModal(c); }}
                        >
                          <Receipt className="mr-1 h-3 w-3" /> Statement
                        </Button>
                        {used > 0 && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={(e) => { e.preventDefault(); openPayModal(c); }}
                          >
                            <CheckCircle2 className="mr-1 h-3 w-3" /> Mark Paid
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {loans.length > 0 && (
        <Card>
          <CardHeader>
            <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
              <Banknote className="h-5 w-5 text-[var(--dxp-brand)]" />
              Loans ({loans.length})
            </h3>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2">
              {loans.map((l) => (
                <div
                  key={l.id}
                  className="rounded-lg border border-[var(--dxp-border-light)] p-4 bg-[var(--dxp-surface)]"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <Link
                        href={`/investments/liabilities/${l.id}`}
                        className="font-bold text-[var(--dxp-text)] hover:text-[var(--dxp-brand)]"
                      >
                        {l.name}
                      </Link>
                      <p className="text-xs text-[var(--dxp-text-muted)]">{l.creditorName}</p>
                    </div>
                    <Badge variant="info">{l.type.replace('_', ' ')}</Badge>
                  </div>
                  <p className="mt-2 text-2xl font-bold font-mono text-[var(--dxp-text)]">
                    {formatINR(l.currentBalance)}
                  </p>
                  <div className="mt-1 grid grid-cols-3 gap-1 text-xs text-[var(--dxp-text-muted)]">
                    <span>EMI: <span className="font-mono text-[var(--dxp-text)]">{formatINR(l.monthlyEmi)}</span></span>
                    <span>Rate: <span className="font-mono text-[var(--dxp-text)]">{l.interestRate}%</span></span>
                    {l.remainingTenor && (
                      <span>{l.remainingTenor}m left</span>
                    )}
                  </div>
                  <div className="mt-3 flex justify-end gap-1">
                    <Link href={`/investments/liabilities/${l.id}`}>
                      <Button variant="ghost" size="sm">
                        <Pencil className="h-4 w-4 text-[var(--dxp-text-muted)]" />
                      </Button>
                    </Link>
                    <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(l)}>
                      <Trash2 className="h-4 w-4 text-rose-500" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {items.length === 0 && (
        <Card>
          <CardContent>
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <CreditCard className="h-12 w-12 text-[var(--dxp-text-muted)]" />
              <p className="text-[var(--dxp-text-muted)]">No liabilities yet.</p>
              <Link href="/investments/liabilities/new">
                <Button variant="primary">
                  <Plus className="mr-2 h-4 w-4" /> Add liability
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {monthlyObligations > 0 && (
        <Card>
          <CardHeader>
            <h3 className="text-base font-bold text-[var(--dxp-text)]">Debt health</h3>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-3 text-sm">
              <div>
                <p className="text-xs uppercase tracking-wider text-[var(--dxp-text-muted)]">Monthly outflow</p>
                <p className="font-mono text-lg font-bold text-[var(--dxp-text)]">{formatINR(monthlyObligations)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-[var(--dxp-text-muted)]">Annualised</p>
                <p className="font-mono text-lg font-bold text-[var(--dxp-text)]">{formatINR(monthlyObligations * 12)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-[var(--dxp-text-muted)]">Card utilisation</p>
                <p className={`font-mono text-lg font-bold ${avgUtilisation > 30 ? 'text-amber-700' : 'text-emerald-700'}`}>
                  {avgUtilisation.toFixed(1)}%
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => !isDeleting && setDeleteTarget(null)}
        >
          <Card className="w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <h3 className="text-base font-bold text-[var(--dxp-text)]">Delete liability?</h3>
              <p className="text-xs text-[var(--dxp-text-secondary)]">
                Removes <strong>{deleteTarget.name}</strong>.
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

      {stmtCard && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => !isRecording && setStmtCard(null)}
        >
          <Card className="w-full max-w-lg mx-4" onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <h3 className="text-base font-bold text-[var(--dxp-text)]">
                {isEditingExisting ? 'Edit statement' : 'Record statement'} — {stmtCard.name}
                {stmtLoading && (
                  <Loader2 className="inline ml-2 h-3.5 w-3.5 animate-spin text-[var(--dxp-text-muted)]" />
                )}
              </h3>
              <p className="text-xs text-[var(--dxp-text-secondary)]">
                {isEditingExisting
                  ? 'Editing the statement for this due-date month. Saving overwrites the existing values.'
                  : 'Budget will be updated for the due date month.'}
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                    Statement amount (₹)
                  </label>
                  <Input
                    type="number"
                    placeholder="e.g. 65000"
                    value={stmtAmount}
                    onChange={(e) => setStmtAmount(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                    Statement date
                  </label>
                  <Input
                    type="date"
                    value={stmtDate}
                    onChange={(e) => setStmtDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                    Due date
                  </label>
                  <Input
                    type="date"
                    value={stmtDueDate}
                    onChange={(e) => setStmtDueDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                    Notes
                  </label>
                  <Input
                    placeholder="Optional"
                    value={stmtNotes}
                    onChange={(e) => setStmtNotes(e.target.value)}
                  />
                </div>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setStmtCard(null)} disabled={isRecording}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={recordStatement} disabled={isRecording}>
                  {isRecording && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Record
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {payCard && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => !isPaying && setPayCard(null)}
        >
          <Card className="w-full max-w-lg mx-4" onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <h3 className="text-base font-bold text-[var(--dxp-text)]">
                Mark statement paid — {payCard.name}
              </h3>
              <p className="text-xs text-[var(--dxp-text-secondary)]">
                Outstanding balance will reduce by this amount (floored at ₹0).
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                    Amount paid (₹)
                  </label>
                  <Input
                    type="number"
                    placeholder="e.g. 65000"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                  />
                  <p className="mt-1 text-xs text-[var(--dxp-text-muted)]">
                    Current outstanding: {formatINR(payCard.currentBalance)}
                  </p>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                    Settled on
                  </label>
                  <Input
                    type="date"
                    value={paySettledOn}
                    onChange={(e) => setPaySettledOn(e.target.value)}
                  />
                </div>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setPayCard(null)} disabled={isPaying}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={markPaid} disabled={isPaying}>
                  {isPaying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Mark Paid
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
