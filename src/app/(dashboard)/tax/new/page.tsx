'use client';

/**
 * /tax/new — guided Section 80 entry wizard (Sprint 5.2 commit 2).
 *
 * Replaces the old flat form with a 4-step single-page wizard. Honours
 * `?section=80G` (or any code) on mount to pre-select the section, so
 * old links like /tax/80g/new still land here with the right preset.
 *
 * Also surfaces the U8 carry-forward banner when the user has prior-FY
 * rows that haven't yet been copied to the current FY.
 */

import { useEffect, useState, useCallback, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardHeader, CardContent, Button } from '@dxp/ui';
import { Loader2, X, History } from 'lucide-react';
import { toast } from 'sonner';
import { DeductionWizardForm } from '@/components/forms/deduction-wizard-form';
import { getCurrentFinancialYear } from '@/lib/finance/tax-constants';

function currentFy(): string {
  return getCurrentFinancialYear();
}

function previousFy(): string {
  const c = currentFy();
  const s = Number(c.split('-')[0]) - 1;
  return `${s}-${String((s + 1) % 100).padStart(2, '0')}`;
}

interface PriorDeduction {
  id: number;
  section: string;
  description: string | null;
  amountPaisa: number | null;
  paymentDate: string | null;
}

function formatINR(paisa: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);
}

function NewDeductionInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialSection = searchParams.get('section') ?? undefined;

  const [priorRows, setPriorRows] = useState<PriorDeduction[]>([]);
  const [carryBannerDismissed, setCarryBannerDismissed] = useState(false);
  const [showCarryModal, setShowCarryModal] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isCarrying, setIsCarrying] = useState(false);
  const [carryAll, setCarryAll] = useState(true);

  const cur = currentFy();
  const prev = previousFy();

  // Fetch prior-FY rows (for the U8 banner). Only show if any exist.
  useEffect(() => {
    fetch(`/api/tax/deductions?fy=${encodeURIComponent(prev)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setPriorRows(d?.deductions ?? []))
      .catch(() => setPriorRows([]));
  }, [prev]);

  const carryForward = useCallback(
    async (mode: 'all' | 'selected') => {
      const ids = mode === 'selected' ? Array.from(selectedIds) : undefined;
      if (mode === 'selected' && (!ids || ids.length === 0)) {
        toast.error('Pick at least one row to carry forward');
        return;
      }
      setIsCarrying(true);
      try {
        const r = await fetch('/api/tax/deductions/carry-forward', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fromFy: prev, toFy: cur, deductionIds: ids }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error || 'Carry-forward failed');
        toast.success(`Carried ${d.copiedCount} row(s) into FY ${cur}`);
        setShowCarryModal(false);
        setCarryBannerDismissed(true);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Carry-forward failed');
      } finally {
        setIsCarrying(false);
      }
    },
    [selectedIds, prev, cur],
  );

  const toggleSelected = (id: number) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const showBanner = useMemo(
    () => priorRows.length > 0 && !carryBannerDismissed,
    [priorRows, carryBannerDismissed],
  );

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
          Add Section 80 deduction
        </h1>
        <p className="text-[var(--dxp-text-secondary)]">
          Four steps — pick the section, sub-type, amount, then any extras.
        </p>
      </div>

      {/* U8 — Carry-forward banner */}
      {showBanner && (
        <div className="flex items-center gap-3 rounded-md border border-sky-300 bg-sky-50/40 p-3">
          <History className="h-5 w-5 text-sky-700" />
          <div className="flex-1 text-sm text-[var(--dxp-text)]">
            <span className="font-bold">{priorRows.length}</span> deduction
            {priorRows.length === 1 ? '' : 's'} from FY {prev} — carry into FY {cur}?
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setCarryAll(true);
              setShowCarryModal(true);
            }}
            disabled={isCarrying}
          >
            Carry forward all
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setCarryAll(false);
              setShowCarryModal(true);
              setSelectedIds(new Set(priorRows.map((r) => r.id)));
            }}
          >
            Pick which ones
          </Button>
          <button
            onClick={() => setCarryBannerDismissed(true)}
            className="rounded p-1 hover:bg-sky-100"
            title="Dismiss"
          >
            <X className="h-4 w-4 text-sky-700" />
          </button>
        </div>
      )}

      {/* Modal — carry-forward picker */}
      {showCarryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-2xl">
            <CardHeader>
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-[var(--dxp-text)]">
                  {carryAll ? `Carry ALL ${priorRows.length} rows` : 'Pick rows to carry'}
                </h3>
                <button onClick={() => setShowCarryModal(false)} className="rounded p-1 hover:bg-[var(--dxp-surface-alt,var(--dxp-surface))]">
                  <X className="h-4 w-4 text-[var(--dxp-text-muted)]" />
                </button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="max-h-80 overflow-y-auto space-y-1">
                {priorRows.map((r) => (
                  <label
                    key={r.id}
                    className={`flex items-center gap-3 rounded border border-[var(--dxp-border-light)] px-3 py-2 text-sm ${
                      carryAll ? 'opacity-70' : 'cursor-pointer hover:bg-[var(--dxp-surface-alt,var(--dxp-surface))]'
                    }`}
                  >
                    {!carryAll && (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(r.id)}
                        onChange={() => toggleSelected(r.id)}
                      />
                    )}
                    <span className="font-bold text-[var(--dxp-text)]">{r.section}</span>
                    <span className="flex-1 text-[var(--dxp-text-secondary)]">{r.description}</span>
                    <span className="font-mono text-[var(--dxp-text)]">{formatINR(r.amountPaisa ?? 0)}</span>
                  </label>
                ))}
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setShowCarryModal(false)}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={() => carryForward(carryAll ? 'all' : 'selected')}
                  disabled={isCarrying}
                >
                  {isCarrying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Carry into FY {cur}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <DeductionWizardForm
        initialSection={initialSection}
        onSaved={() => router.push('/tax')}
        onCancel={() => router.push('/tax')}
      />
    </div>
  );
}

export default function NewDeductionPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--dxp-text-muted)]" />
        </div>
      }
    >
      <NewDeductionInner />
    </Suspense>
  );
}
