'use client';

/**
 * /tax/[id]/edit — edit a Section 80 deduction (Sprint 5.2 commit 2).
 *
 * Loads the row via GET /api/tax/deductions/{id}, renders the same
 * wizard form as /tax/new but pre-filled, and PATCHes on save.
 */

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  DeductionWizardForm,
  type DeductionWizardInitial,
} from '@/components/forms/deduction-wizard-form';

interface DeductionRow {
  id: number;
  section: string;
  subType: string | null;
  description: string | null;
  amountPaisa: number | null;
  paymentDate: string | null;
  paymentMethod: string | null;
  recipientName: string | null;
  recipientPan: string | null;
  recipient80gNumber: string | null;
  qualifyingPercent: number | null;
  hasUpperLimit: boolean | null;
  financialYear: string;
  notes: string | null;
  eightyDBucket: string | null;
  eightyGCategory: string | null;
  eligibleUnderNew: boolean | null;
}

export default function EditDeductionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const { id } = use(params);
  const [row, setRow] = useState<DeductionRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/tax/deductions/${id}`)
      .then(async (r) => {
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          throw new Error(e?.error || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((d) => {
        if (cancelled) return;
        setRow(d.deduction);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--dxp-text-muted)]" />
      </div>
    );
  }

  if (error || !row) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-bold text-[var(--dxp-text)]">Edit deduction</h1>
        <p className="text-sm text-rose-600">{error ?? 'Not found'}</p>
      </div>
    );
  }

  const initial: DeductionWizardInitial = {
    id: row.id,
    section: row.section,
    subType: row.subType,
    description: row.description,
    amountRupees: row.amountPaisa != null ? row.amountPaisa / 100 : undefined,
    paymentDate: row.paymentDate,
    paymentMethod: row.paymentMethod,
    recipientName: row.recipientName,
    recipientPan: row.recipientPan,
    recipient80gNumber: row.recipient80gNumber,
    qualifyingPercent: row.qualifyingPercent,
    hasUpperLimit: row.hasUpperLimit,
    financialYear: row.financialYear,
    notes: row.notes,
    eightyDBucket:
      row.eightyDBucket === 'SELF_FAMILY' || row.eightyDBucket === 'PARENTS'
        ? row.eightyDBucket
        : null,
    eightyGCategory:
      row.eightyGCategory === '50_NO_LIMIT' ||
      row.eightyGCategory === '100_NO_LIMIT' ||
      row.eightyGCategory === '50_WITH_LIMIT' ||
      row.eightyGCategory === '100_WITH_LIMIT'
        ? row.eightyGCategory
        : null,
    eligibleUnderNew: row.eligibleUnderNew,
  };

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
          Edit deduction
        </h1>
        <p className="text-[var(--dxp-text-secondary)]">
          Updating row #{row.id} — section {row.section}, FY {row.financialYear}.
        </p>
      </div>
      <DeductionWizardForm
        editId={row.id}
        initial={initial}
        onSaved={() => {
          toast.success('Updated');
          router.push('/tax');
        }}
        onCancel={() => router.push('/tax')}
      />
    </div>
  );
}
