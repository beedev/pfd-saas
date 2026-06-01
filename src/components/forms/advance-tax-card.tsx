'use client';

/**
 * Advance tax planner card — Sprint 4 Phase 3.
 *
 * Drops into /tax below the regime-comparison card. 4 quarterly slots
 * shown as a row of cards, each with due date / expected / paid /
 * status. Inline "Mark paid" form appears on click.
 *
 * Reads /api/tax/advance-tax?fy=<fy> which auto-seeds the 4 rows on
 * first call. Refetches whenever `fy` prop changes.
 */

import { useEffect, useState, useCallback } from 'react';
import { Card, CardHeader, CardContent, Badge, Button, Input } from '@dxp/ui';
import { CalendarClock, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

interface Installment {
  id: number;
  installmentOrder: number;
  dueDate: string;
  duePct: number;
  expectedDuePaisa: number;
  paidAmountPaisa: number;
  paidDate: string | null;
  notes: string | null;
  status: 'UPCOMING' | 'DUE' | 'PAID' | 'OVERDUE';
}

interface AdvanceTaxResp {
  fy: string;
  projectedAnnualTaxPaisa: number;
  recommendedRegime: 'OLD' | 'NEW' | null;
  installments: Installment[];
  totals: {
    expectedPaisa: number;
    paidPaisa: number;
    pendingPaisa: number;
    cumulativeDueAsOfTodayPaisa: number;
    shortfallPaisa: number;
    triggers234BC: boolean;
  };
}

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

const statusBadge = (s: Installment['status']) => {
  switch (s) {
    case 'PAID':
      return <Badge variant="success">Paid</Badge>;
    case 'DUE':
      return <Badge variant="warning">Due soon</Badge>;
    case 'OVERDUE':
      return <Badge variant="danger">Overdue</Badge>;
    case 'UPCOMING':
    default:
      return <Badge variant="info">Upcoming</Badge>;
  }
};

export function AdvanceTaxCard({ fy }: { fy: string }) {
  const [data, setData] = useState<AdvanceTaxResp | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const r = await fetch(`/api/tax/advance-tax?fy=${encodeURIComponent(fy)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || 'Failed');
      setData(d);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setIsLoading(false);
    }
  }, [fy]);

  useEffect(() => {
    load();
  }, [load]);

  const openEdit = (i: Installment) => {
    setEditingId(i.id);
    setEditAmount(
      i.paidAmountPaisa > 0
        ? String(Math.round(i.paidAmountPaisa / 100))
        : String(Math.round(i.expectedDuePaisa / 100)),
    );
    setEditDate(i.paidDate ?? new Date().toISOString().slice(0, 10));
    setEditNotes(i.notes ?? '');
  };

  const save = async () => {
    if (!editingId) return;
    const amt = Number(editAmount);
    if (!Number.isFinite(amt) || amt < 0) {
      toast.error('Enter a valid amount in rupees');
      return;
    }
    if (!editDate) {
      toast.error('Pick a payment date');
      return;
    }
    setIsSaving(true);
    try {
      const r = await fetch(`/api/tax/advance-tax/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paidAmountPaisa: Math.round(amt * 100),
          paidDate: editDate,
          notes: editNotes || undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || 'Failed');
      toast.success('Payment recorded');
      setEditingId(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading || !data) {
    return (
      <Card>
        <CardContent>
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-[var(--dxp-text-muted)]" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <CalendarClock className="h-5 w-5 text-[var(--dxp-brand)]" />
            Advance Tax — FY {fy}
          </h3>
          <div className="text-xs text-[var(--dxp-text-muted)]">
            Projected annual tax (
            {data.recommendedRegime ? `${data.recommendedRegime} regime` : 'recommended regime'}
            ):{' '}
            <span className="font-mono font-bold text-[var(--dxp-text)]">
              {formatINR(data.projectedAnnualTaxPaisa)}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {data.projectedAnnualTaxPaisa === 0 && (
          <p className="mb-3 text-xs text-[var(--dxp-text-muted)]">
            No income / slab data for FY {fy} yet. Add salary + business income to see expected
            installment amounts.
          </p>
        )}

        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {data.installments.map((i) => (
            <div
              key={i.id}
              className="rounded border border-[var(--dxp-border-light)] p-3 text-sm"
            >
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-muted)]">
                  Q{i.installmentOrder} — {i.duePct}%
                </p>
                {statusBadge(i.status)}
              </div>
              <p className="text-sm font-bold text-[var(--dxp-text)]">{i.dueDate}</p>
              <p className="mt-1 text-xs text-[var(--dxp-text-muted)]">
                Expected:{' '}
                <span className="font-mono text-[var(--dxp-text-secondary)]">
                  {formatINR(i.expectedDuePaisa)}
                </span>
              </p>
              <p className="text-xs text-[var(--dxp-text-muted)]">
                Paid:{' '}
                <span className="font-mono font-bold text-[var(--dxp-text)]">
                  {formatINR(i.paidAmountPaisa)}
                </span>
                {i.paidDate && (
                  <span className="ml-1 text-[var(--dxp-text-muted)]">on {i.paidDate}</span>
                )}
              </p>
              {editingId === i.id ? (
                <div className="mt-2 space-y-2">
                  <Input
                    type="number"
                    placeholder="Amount in ₹"
                    value={editAmount}
                    onChange={(e) => setEditAmount(e.target.value)}
                  />
                  <Input
                    type="date"
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                  />
                  <Input
                    placeholder="Challan / notes"
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <Button variant="primary" size="sm" onClick={save} disabled={isSaving}>
                      {isSaving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />} Save
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-2 w-full"
                  onClick={() => openEdit(i)}
                >
                  {i.paidAmountPaisa > 0 ? 'Edit payment' : 'Mark paid'}
                </Button>
              )}
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--dxp-border-light)] pt-3 text-xs">
          <p className="text-[var(--dxp-text-secondary)]">
            Total expected:{' '}
            <span className="font-mono font-bold text-[var(--dxp-text)]">
              {formatINR(data.totals.expectedPaisa)}
            </span>{' '}
            · Paid so far:{' '}
            <span className="font-mono font-bold text-[var(--dxp-text)]">
              {formatINR(data.totals.paidPaisa)}
            </span>{' '}
            · Pending:{' '}
            <span className="font-mono font-bold text-[var(--dxp-text)]">
              {formatINR(data.totals.pendingPaisa)}
            </span>
          </p>
        </div>

        {data.totals.triggers234BC && (
          <div className="mt-3 flex items-start gap-2 rounded border border-amber-400/50 bg-amber-50 p-3 text-xs dark:bg-amber-900/20">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-500" />
            <div>
              <p className="font-bold text-amber-700 dark:text-amber-300">
                Underpayment may trigger 234B/234C interest at year-end.
              </p>
              <p className="text-amber-700/80 dark:text-amber-300/80">
                You&apos;re short by {formatINR(data.totals.shortfallPaisa)} against the
                cumulative-due as of today (govt tolerates a 10% gap). Penalty math is slab-based
                and deferred to a later phase.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
