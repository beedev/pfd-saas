'use client';

/**
 * Cashflow Events — list & timeline view.
 *
 * Three layers:
 *   1. Tile strip — total inflow this FY, next 12 months, one-time
 *      upcoming count, recurring active count.
 *   2. Timeline — one horizontal bar per event positioned on a 0-40 year
 *      axis from today. Bars grouped by source_kind so the user can
 *      see at a glance "what kicks in when". Pure div / CSS — recharts
 *      would be overkill for ~30 rows.
 *   3. DataTable — all events with edit (inline) + delete affordances.
 *
 * First-load behaviour: if the user has zero events, fires one
 * /derive POST automatically so the page never shows empty when there's
 * any upstream signal to derive from.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  DataTable,
  Input,
  Select,
  StatsDisplay,
  type Column,
} from '@dxp/ui';
import {
  AlertTriangle,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';

import { CashflowTimeline } from '@/components/cashflow-timeline';

type CashflowSourceKind =
  | 'INSURANCE_MATURITY' | 'ANNUITY' | 'PENSION' | 'NPS_LUMPSUM' | 'NPS_ANNUITY'
  | 'PPF_MATURITY' | 'SSY_MATURITY' | 'NSC_MATURITY' | 'KVP_MATURITY'
  | 'RENTAL' | 'SALARY' | 'BUSINESS' | 'INHERITANCE' | 'OTHER'
  | 'SIP';

type CashflowFrequency = 'ONE_TIME' | 'MONTHLY' | 'YEARLY';
type CashflowTaxTreatment = 'TAX_FREE' | 'TAXABLE' | 'TDS';

interface CashflowEvent {
  id: number;
  name: string;
  sourceKind: CashflowSourceKind;
  sourceId: number | null;
  startDate: string;
  endDate: string | null;
  amountPaisa: number;
  frequency: CashflowFrequency;
  growthPctPerYear: number;
  taxTreatment: CashflowTaxTreatment;
  autoDerived: boolean;
  notes: string | null;
}

const KIND_LABELS: Record<CashflowSourceKind, string> = {
  INSURANCE_MATURITY: 'Insurance maturity',
  ANNUITY: 'Annuity',
  PENSION: 'Pension',
  NPS_LUMPSUM: 'NPS lumpsum',
  NPS_ANNUITY: 'NPS annuity',
  PPF_MATURITY: 'PPF maturity',
  SSY_MATURITY: 'SSY maturity',
  NSC_MATURITY: 'NSC maturity',
  KVP_MATURITY: 'KVP maturity',
  RENTAL: 'Rental',
  SALARY: 'Salary',
  BUSINESS: 'Business',
  INHERITANCE: 'Inheritance',
  OTHER: 'Other',
  SIP: 'SIP contribution',
};

const KIND_OPTIONS: Array<{ label: string; value: CashflowSourceKind }> = (
  Object.keys(KIND_LABELS) as CashflowSourceKind[]
).map((k) => ({ label: KIND_LABELS[k], value: k }));

const FREQUENCY_OPTIONS: Array<{ label: string; value: CashflowFrequency }> = [
  { label: 'One-time', value: 'ONE_TIME' },
  { label: 'Monthly', value: 'MONTHLY' },
  { label: 'Yearly', value: 'YEARLY' },
];

const TAX_OPTIONS: Array<{ label: string; value: CashflowTaxTreatment }> = [
  { label: 'Tax-free', value: 'TAX_FREE' },
  { label: 'Taxable', value: 'TAXABLE' },
  { label: 'TDS deducted', value: 'TDS' },
];

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

/** Annualised value of a single event in a given year — used for tile
 * sums and timeline bar width scaling. */
function annualInflowForYear(e: CashflowEvent, year: number): number {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const startsAfter = e.startDate > yearEnd;
  const endsBefore = e.endDate != null && e.endDate < yearStart;
  if (startsAfter || endsBefore) return 0;

  // Apply growth from start_date to year start (compounded).
  const startYear = new Date(e.startDate).getFullYear();
  const yearsFromStart = Math.max(0, year - startYear);
  const grown = e.amountPaisa * Math.pow(1 + (e.growthPctPerYear || 0) / 100, yearsFromStart);

  switch (e.frequency) {
    case 'ONE_TIME': {
      const evYear = new Date(e.startDate).getFullYear();
      return evYear === year ? grown : 0;
    }
    case 'MONTHLY':
      return grown * 12;
    case 'YEARLY':
      return grown;
  }
}

/** Get current Indian financial year as { startYear, endYear, label }. */
function currentFY(): { startYear: number; endYear: number; label: string } {
  const d = new Date();
  const startYear = d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1;
  return {
    startYear,
    endYear: startYear + 1,
    label: `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`,
  };
}

export default function CashflowEventsPage() {
  const [events, setEvents] = useState<CashflowEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeriving, setIsDeriving] = useState(false);
  const [editTarget, setEditTarget] = useState<CashflowEvent | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CashflowEvent | null>(null);
  const [hasAutoDerived, setHasAutoDerived] = useState(false);
  // Data-quality signal — count of insurance policies that would
  // derive an INSURANCE_MATURITY or ANNUITY event if their
  // maturity_date (or annuity_start_date) were filled in. Surfaces as
  // a banner so the user knows why their event list looks sparse.
  const [policyGap, setPolicyGap] = useState<{
    missingMaturity: number;
    totalEndowmentLike: number;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/cashflow-events').then((r) => r.json());
      setEvents(r.events || []);
      return r.events as CashflowEvent[];
    } catch (e) {
      console.error(e);
      toast.error('Failed to load cashflow events');
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  const derive = useCallback(async (silent = false): Promise<void> => {
    setIsDeriving(true);
    try {
      const r = await fetch('/api/cashflow-events/derive', { method: 'POST' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Failed to derive');
      if (!silent) {
        toast.success(
          `Synced — ${data.upserted} new, ${data.kept} kept, ${data.deleted} removed`,
        );
      }
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to derive';
      if (!silent) toast.error(msg);
      console.error(e);
    } finally {
      setIsDeriving(false);
    }
  }, [load]);

  useEffect(() => {
    (async () => {
      const initial = await load();
      // First-time visit gets one auto-derive so the page is never
      // empty when there's anything upstream. Guarded by hasAutoDerived
      // so React StrictMode double-invokes don't double-fire it.
      if (initial.length === 0 && !hasAutoDerived) {
        setHasAutoDerived(true);
        await derive(true);
      }

      // Independently fetch insurance policies to surface the
      // "missing maturity_date" data-quality gap. Endowment-style
      // policies need maturity_date to derive an event; we count
      // how many active rows are missing it.
      try {
        const r = await fetch('/api/investments/insurance').then((res) => res.json());
        const policies: Array<{
          status: string;
          policyType: string;
          maturityDate: string | null;
        }> = r.policies || [];
        const endowmentLike = policies.filter(
          (p) =>
            p.status === 'ACTIVE' &&
            ['ENDOWMENT', 'MONEY_BACK', 'ULIP', 'WHOLE_LIFE'].includes(p.policyType),
        );
        const missing = endowmentLike.filter((p) => !p.maturityDate).length;
        setPolicyGap({
          missingMaturity: missing,
          totalEndowmentLike: endowmentLike.length,
        });
      } catch {
        /* non-fatal — banner just doesn't show */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ─── derived state for the tiles ──────────────────────────────── */
  const fy = useMemo(() => currentFY(), []);

  const totalFY = useMemo(
    () => events.reduce((sum, e) => sum + annualInflowForYear(e, fy.startYear), 0),
    [events, fy.startYear],
  );

  const total12mo = useMemo(() => {
    // Sum each event's contribution over today → today+12mo.
    const now = new Date();
    const horizon = new Date();
    horizon.setMonth(horizon.getMonth() + 12);
    const todayIso = now.toISOString().slice(0, 10);
    const horizonIso = horizon.toISOString().slice(0, 10);

    return events.reduce((sum, e) => {
      if (e.startDate > horizonIso) return sum;
      if (e.endDate && e.endDate < todayIso) return sum;
      switch (e.frequency) {
        case 'ONE_TIME':
          return e.startDate >= todayIso && e.startDate <= horizonIso
            ? sum + e.amountPaisa
            : sum;
        case 'MONTHLY':
          return sum + e.amountPaisa * 12;
        case 'YEARLY':
          return sum + e.amountPaisa;
      }
    }, 0);
  }, [events]);

  const oneTimeUpcomingCount = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return events.filter((e) => e.frequency === 'ONE_TIME' && e.startDate >= today).length;
  }, [events]);

  const recurringActiveCount = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return events.filter(
      (e) =>
        e.frequency !== 'ONE_TIME' &&
        e.startDate <= today &&
        (!e.endDate || e.endDate >= today),
    ).length;
  }, [events]);


  /* ─── delete ───────────────────────────────────────────────────── */
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      const r = await fetch(`/api/cashflow-events/${deleteTarget.id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('delete failed');
      toast.success('Removed');
      setDeleteTarget(null);
      await load();
    } catch (e) {
      console.error(e);
      toast.error('Failed to delete');
    }
  };

  /* ─── inline edit (modal) ──────────────────────────────────────── */
  const onSaveEdit = async (updated: CashflowEvent, amountRupees: number) => {
    try {
      const r = await fetch(`/api/cashflow-events/${updated.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: updated.name,
          sourceKind: updated.sourceKind,
          startDate: updated.startDate,
          endDate: updated.endDate,
          amountRupees,
          frequency: updated.frequency,
          growthPctPerYear: updated.growthPctPerYear,
          taxTreatment: updated.taxTreatment,
          notes: updated.notes,
          // Promote to manual override — protects the user's edit from
          // future /derive calls.
          autoDerived: false,
        }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update');
      }
      toast.success('Updated');
      setEditTarget(null);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to update';
      toast.error(msg);
    }
  };

  /* ─── table columns ────────────────────────────────────────────── */
  const columns: Column<CashflowEvent>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (_v, e) => (
        <div className="flex flex-col">
          <span className="font-semibold text-[var(--dxp-text)]">{e.name}</span>
          {e.notes && (
            <span className="text-xs text-[var(--dxp-text-muted)]">{e.notes}</span>
          )}
        </div>
      ),
    },
    {
      key: 'sourceKind',
      header: 'Type',
      render: (_v, e) => (
        <div className="flex flex-col gap-1">
          <span className="text-sm text-[var(--dxp-text-secondary)]">
            {KIND_LABELS[e.sourceKind]}
          </span>
          {!e.autoDerived && <Badge variant="info">Manual</Badge>}
        </div>
      ),
    },
    {
      key: 'startDate',
      header: 'Start',
      render: (_v, e) => (
        <span className="text-sm text-[var(--dxp-text-secondary)]">{e.startDate}</span>
      ),
    },
    {
      key: 'endDate',
      header: 'End',
      render: (_v, e) => (
        <span className="text-sm text-[var(--dxp-text-muted)]">
          {e.endDate || (e.frequency === 'ONE_TIME' ? '—' : 'lifelong')}
        </span>
      ),
    },
    {
      key: 'amountPaisa',
      header: 'Amount',
      render: (_v, e) => (
        <span className="font-mono font-semibold text-[var(--dxp-text)]">
          {formatINR(e.amountPaisa)}
        </span>
      ),
    },
    {
      key: 'frequency',
      header: 'Frequency',
      render: (_v, e) => (
        <Badge variant={e.frequency === 'ONE_TIME' ? 'warning' : 'success'}>
          {e.frequency}
        </Badge>
      ),
    },
    {
      key: 'growthPctPerYear',
      header: 'Growth',
      render: (_v, e) => (
        <span className="font-mono text-sm text-[var(--dxp-text-secondary)]">
          {e.growthPctPerYear ? `${e.growthPctPerYear.toFixed(1)}%` : '—'}
        </span>
      ),
    },
    {
      key: 'taxTreatment',
      header: 'Tax',
      render: (_v, e) => (
        <Badge variant={e.taxTreatment === 'TAX_FREE' ? 'success' : 'warning'}>
          {e.taxTreatment}
        </Badge>
      ),
    },
    {
      key: 'id',
      header: '',
      render: (_v, e) => (
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={(ev) => {
              ev.stopPropagation();
              setEditTarget(e);
            }}
            aria-label="Edit"
          >
            <Pencil className="h-4 w-4 text-[var(--dxp-text-secondary)]" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(ev) => {
              ev.stopPropagation();
              setDeleteTarget(e);
            }}
            aria-label="Delete"
          >
            <Trash2 className="h-4 w-4 text-rose-500" />
          </Button>
        </div>
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
            Cashflow Events
          </h1>
          <p className="text-[var(--dxp-text-secondary)]">
            Future income & maturity events that fund your goals. Auto-derived from your portfolio.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => derive(false)}
            disabled={isDeriving}
          >
            {isDeriving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Re-derive from assets
          </Button>
          <Link href="/planning/cashflows/new">
            <Button variant="primary">
              <Plus className="mr-2 h-4 w-4" />
              Add event
            </Button>
          </Link>
        </div>
      </div>

      <StatsDisplay
        currency="INR"
        locale="en-IN"
        columns={4}
        stats={[
          { label: `Inflow ${fy.label}`, value: totalFY / 100, format: 'currency' },
          { label: 'Inflow next 12 months', value: total12mo / 100, format: 'currency' },
          { label: 'One-time upcoming', value: oneTimeUpcomingCount, format: 'number' },
          { label: 'Recurring active', value: recurringActiveCount, format: 'number' },
        ]}
      />

      {/* Data-quality banner — flag insurance policies missing
          maturity_date. The user often sees fewer events than they
          expected because we can't derive a maturity event without
          the date. Surfacing this lets them fix the data once and
          have everything light up. */}
      {policyGap && policyGap.missingMaturity > 0 && (
        <Card className="border-amber-400 bg-amber-50/40">
          <CardContent className="py-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 flex-shrink-0 text-amber-600" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-amber-900">
                  {policyGap.missingMaturity} of your {policyGap.totalEndowmentLike}{' '}
                  endowment-style policies are missing a maturity date
                </p>
                <p className="mt-0.5 text-xs text-amber-800">
                  Their payouts can&apos;t be derived as cashflow events until
                  the date is filled in. Open each policy and set its
                  maturity date (or policy start date + term).
                </p>
                <Link
                  href="/investments/insurance"
                  className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-amber-700 hover:text-amber-900"
                >
                  Fix in Life Insurance →
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Vertical year-grouped timeline. Events appear in the year
          they start, sorted by month. Recurring events appear once
          with their lifelong / end-year context — they don't repeat
          across every year of their lifetime. */}
      <Card>
        <CardHeader>
          <h3 className="text-base font-bold text-[var(--dxp-text)]">
            Timeline · when each event fires
          </h3>
          <p className="text-xs text-[var(--dxp-text-secondary)]">
            Moments money lands, grouped by year. Recurring streams appear
            once in the year they begin; one-time events show their
            calendar month.
          </p>
        </CardHeader>
        <CardContent>
          <CashflowTimeline
            events={events}
            emptyMessage="No events yet. Click Re-derive from assets to populate from your portfolio."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h3 className="text-base font-bold text-[var(--dxp-text)]">
            All events ({events.length})
          </h3>
        </CardHeader>
        <CardContent>
          <DataTable<CashflowEvent>
            columns={columns}
            data={events}
            emptyMessage="No events yet — add one or re-derive."
          />
        </CardContent>
      </Card>

      {editTarget && (
        <EditEventModal
          event={editTarget}
          onClose={() => setEditTarget(null)}
          onSave={onSaveEdit}
        />
      )}

      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setDeleteTarget(null)}
        >
          <Card className="w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <h3 className="text-base font-bold text-[var(--dxp-text)]">Delete event?</h3>
              <p className="text-xs text-[var(--dxp-text-secondary)]">
                Removes <strong>{deleteTarget.name}</strong>. If this event was
                auto-derived, the next re-derive will recreate it.
              </p>
            </CardHeader>
            <CardContent>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
                  Cancel
                </Button>
                <Button variant="danger" onClick={confirmDelete}>
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

/* ─── Edit modal ──────────────────────────────────────────────────── */

interface EditModalProps {
  event: CashflowEvent;
  onClose: () => void;
  onSave: (updated: CashflowEvent, amountRupees: number) => Promise<void>;
}

function EditEventModal({ event, onClose, onSave }: EditModalProps) {
  const [draft, setDraft] = useState<CashflowEvent>(event);
  const [amountRupees, setAmountRupees] = useState(String(event.amountPaisa / 100));
  const [isSaving, setIsSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(amountRupees);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error('Amount must be a positive number');
      return;
    }
    setIsSaving(true);
    try {
      await onSave(draft, amt);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-[var(--dxp-text)]">Edit event</h3>
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
              <X className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-[var(--dxp-text-secondary)]">
            Saving promotes this to a manual override — future re-derives won&apos;t touch it.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Name</label>
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Source kind</label>
                <Select
                  value={draft.sourceKind}
                  onChange={(v) => setDraft({ ...draft, sourceKind: v as CashflowSourceKind })}
                  options={KIND_OPTIONS}
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Frequency</label>
                <Select
                  value={draft.frequency}
                  onChange={(v) => setDraft({ ...draft, frequency: v as CashflowFrequency })}
                  options={FREQUENCY_OPTIONS}
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Start date</label>
                <Input
                  type="date"
                  value={draft.startDate}
                  onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                  End date <span className="text-xs text-[var(--dxp-text-muted)]">(blank = lifelong)</span>
                </label>
                <Input
                  type="date"
                  value={draft.endDate ?? ''}
                  onChange={(e) => setDraft({ ...draft, endDate: e.target.value || null })}
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Amount (₹)</label>
                <Input
                  type="number"
                  step="0.01"
                  value={amountRupees}
                  onChange={(e) => setAmountRupees(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Growth (%/yr)</label>
                <Input
                  type="number"
                  step="0.1"
                  value={draft.growthPctPerYear}
                  onChange={(e) => setDraft({ ...draft, growthPctPerYear: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Tax treatment</label>
                <Select
                  value={draft.taxTreatment}
                  onChange={(v) => setDraft({ ...draft, taxTreatment: v as CashflowTaxTreatment })}
                  options={TAX_OPTIONS}
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Notes</label>
                <textarea
                  value={draft.notes ?? ''}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value || null })}
                  rows={2}
                  className="w-full rounded border border-[var(--dxp-border)] bg-[var(--dxp-surface)] p-2 text-sm text-[var(--dxp-text)] focus:border-[var(--dxp-brand)] focus:outline-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={onClose} disabled={isSaving}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={isSaving}>
                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save changes
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
