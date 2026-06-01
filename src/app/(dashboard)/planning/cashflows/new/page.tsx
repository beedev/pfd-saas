'use client';

/**
 * Cashflow Events — manual registration form.
 *
 * Manual events sit alongside derived ones in the same table; the
 * differentiator is `auto_derived=false`. Manual events are never
 * touched by /derive — useful for inheritances, expected windfalls,
 * side-gigs the derivation layer can't infer from existing assets.
 *
 * Money on the wire: RUPEES. POST handler multiplies by 100.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';

import { Button, Card, CardContent, CardHeader, Input, Select } from '@dxp/ui';
import { ArrowLeft, Loader2, TrendingUp } from 'lucide-react';

type CashflowSourceKind =
  | 'INSURANCE_MATURITY' | 'ANNUITY' | 'PENSION' | 'NPS_LUMPSUM' | 'NPS_ANNUITY'
  | 'PPF_MATURITY' | 'SSY_MATURITY' | 'NSC_MATURITY' | 'KVP_MATURITY'
  | 'RENTAL' | 'SALARY' | 'BUSINESS' | 'INHERITANCE' | 'OTHER'
  | 'SIP';

type CashflowFrequency = 'ONE_TIME' | 'MONTHLY' | 'YEARLY';
type CashflowTaxTreatment = 'TAX_FREE' | 'TAXABLE' | 'TDS';

interface Goal {
  id: number;
  name: string;
}

// Surface the source kinds that make sense as user-entered events
// before the more exotic auto-derived ones.
const KIND_OPTIONS: Array<{ label: string; value: CashflowSourceKind }> = [
  { label: 'Other', value: 'OTHER' },
  { label: 'Inheritance', value: 'INHERITANCE' },
  { label: 'Business', value: 'BUSINESS' },
  { label: 'Pension', value: 'PENSION' },
  { label: 'Annuity', value: 'ANNUITY' },
  { label: 'Rental', value: 'RENTAL' },
  { label: 'Salary', value: 'SALARY' },
  { label: 'Insurance maturity', value: 'INSURANCE_MATURITY' },
  { label: 'NPS lumpsum', value: 'NPS_LUMPSUM' },
  { label: 'NPS annuity', value: 'NPS_ANNUITY' },
  { label: 'PPF maturity', value: 'PPF_MATURITY' },
  { label: 'SSY maturity', value: 'SSY_MATURITY' },
  { label: 'NSC maturity', value: 'NSC_MATURITY' },
  { label: 'KVP maturity', value: 'KVP_MATURITY' },
];

const FREQUENCY_OPTIONS: Array<{ label: string; value: CashflowFrequency }> = [
  { label: 'One-time', value: 'ONE_TIME' },
  { label: 'Monthly', value: 'MONTHLY' },
  { label: 'Yearly', value: 'YEARLY' },
];

const TAX_OPTIONS: Array<{ label: string; value: CashflowTaxTreatment }> = [
  { label: 'Taxable', value: 'TAXABLE' },
  { label: 'Tax-free', value: 'TAX_FREE' },
  { label: 'TDS deducted', value: 'TDS' },
];

export default function NewCashflowEventPage() {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [goals, setGoals] = useState<Goal[]>([]);

  // Form state — strings throughout for native <input> round-tripping.
  const [name, setName] = useState('');
  const [sourceKind, setSourceKind] = useState<CashflowSourceKind>('OTHER');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState('');
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState<CashflowFrequency>('ONE_TIME');
  const [growthPct, setGrowthPct] = useState('0');
  const [taxTreatment, setTaxTreatment] = useState<CashflowTaxTreatment>('TAXABLE');
  const [goalId, setGoalId] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    // Best-effort goal fetch — used only to surface the "earmark for goal"
    // dropdown. If the goals endpoint doesn't exist or 404s, we silently
    // hide the goal picker.
    (async () => {
      try {
        const r = await fetch('/api/finance/goals');
        if (!r.ok) return;
        const data = await r.json();
        const list = Array.isArray(data?.goals) ? data.goals : Array.isArray(data) ? data : [];
        setGoals(
          list
            .filter((g: { id?: unknown; name?: unknown }) => typeof g?.id === 'number' && typeof g?.name === 'string')
            .map((g: { id: number; name: string }) => ({ id: g.id, name: g.name })),
        );
      } catch {
        // Quiet — goals are optional.
      }
    })();
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error('Amount must be a positive number');
      return;
    }
    if (!startDate) {
      toast.error('Start date is required');
      return;
    }

    setIsSaving(true);
    try {
      const body = {
        name: name.trim(),
        sourceKind,
        startDate,
        endDate: endDate || null,
        amountRupees: amt,
        frequency,
        growthPctPerYear: parseFloat(growthPct) || 0,
        taxTreatment,
        goalId: goalId ? Number(goalId) : null,
        notes: notes.trim() || null,
      };
      const r = await fetch('/api/cashflow-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Failed to create event');
      toast.success('Event added');
      router.push('/planning/cashflows');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create event';
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  };

  const goalOptions = [
    { label: '— no earmark —', value: '' },
    ...goals.map((g) => ({ label: g.name, value: String(g.id) })),
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/planning/cashflows"
          className="inline-flex items-center text-sm text-[var(--dxp-text-secondary)] hover:text-[var(--dxp-brand)]"
        >
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to cashflows
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
          Add Cashflow Event
        </h1>
        <p className="text-[var(--dxp-text-secondary)]">
          Manual events sit alongside auto-derived ones and survive re-derive runs.
        </p>
      </div>

      <Card>
        <CardHeader>
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <TrendingUp className="h-5 w-5 text-[var(--dxp-brand)]" />
            Event details
          </h3>
          <p className="text-xs text-[var(--dxp-text-secondary)]">All amounts in rupees (₹).</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                  Name
                </label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Father's gift, FY 2030 bonus, Inheritance"
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                  Source kind
                </label>
                <Select
                  value={sourceKind}
                  onChange={(v) => setSourceKind(v as CashflowSourceKind)}
                  options={KIND_OPTIONS}
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                  Frequency
                </label>
                <Select
                  value={frequency}
                  onChange={(v) => setFrequency(v as CashflowFrequency)}
                  options={FREQUENCY_OPTIONS}
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                  Start date
                </label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                  End date <span className="text-xs text-[var(--dxp-text-muted)]">(blank = lifelong)</span>
                </label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                  Amount (₹)
                </label>
                <Input
                  type="number"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="Per period (monthly amount for MONTHLY, etc.)"
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                  Growth (%/yr)
                </label>
                <Input
                  type="number"
                  step="0.1"
                  value={growthPct}
                  onChange={(e) => setGrowthPct(e.target.value)}
                  placeholder="0 = flat; 6 = inflation-linked"
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                  Tax treatment
                </label>
                <Select
                  value={taxTreatment}
                  onChange={(v) => setTaxTreatment(v as CashflowTaxTreatment)}
                  options={TAX_OPTIONS}
                />
              </div>
              {goals.length > 0 && (
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Earmark for goal
                  </label>
                  <Select
                    value={goalId}
                    onChange={(v) => setGoalId(v)}
                    options={goalOptions}
                  />
                </div>
              )}
            </div>

            <div>
              <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                Notes
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full rounded border border-[var(--dxp-border)] bg-[var(--dxp-surface)] p-2 text-sm text-[var(--dxp-text)] focus:border-[var(--dxp-brand)] focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => router.back()}
                disabled={isSaving}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={isSaving}>
                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save event
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
