'use client';

/**
 * Edit an existing presumptive-income row — Sprint 4.1.
 *
 * Fetches the row by id, prefills the shared form, lets the user
 * adjust + save (PATCH). Delete lives on the ITR-4 list page.
 */

import { useEffect, useState, Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Card, CardContent } from '@dxp/ui';
import { Loader2, AlertTriangle } from 'lucide-react';
import { PresumptiveForm, type PresumptiveFormInitial } from '../_form';
import { getCurrentFinancialYear } from '@/lib/finance/tax-constants';

function previousFy(): string {
  const current = getCurrentFinancialYear();
  const startYear = Number(current.split('-')[0]) - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

export default function EditPresumptivePage() {
  return (
    <Suspense fallback={<div className="p-6 text-[var(--dxp-text-muted)]">Loading…</div>}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const params = useParams<{ id: string }>();
  const sp = useSearchParams();
  const fy = sp.get('fy') ?? previousFy();
  const [row, setRow] = useState<PresumptiveFormInitial | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/tax/itr4/presumptive/${params.id}`);
        const j = await r.json();
        if (cancelled) return;
        if (!r.ok) {
          setError(j?.error || 'Failed');
          return;
        }
        const e = j.entry;
        setRow({
          id: e.id,
          fy: e.fy,
          section: e.section,
          businessName: e.businessName,
          natureOfBusiness: e.natureOfBusiness,
          grossReceiptsPaisa: e.grossReceiptsPaisa,
          receiptMode: e.receiptMode ?? 'DIGITAL',
          declaredProfitPaisa: e.declaredProfitPaisa,
          notes: e.notes,
        });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  if (error) {
    return (
      <Card>
        <CardContent>
          <div className="flex items-start gap-3 py-4">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <div>
              <p className="text-sm font-bold text-[var(--dxp-text)]">Cannot load row</p>
              <p className="text-xs text-[var(--dxp-text-muted)]">{error}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }
  if (!row) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--dxp-text-muted)]" />
      </div>
    );
  }
  return <PresumptiveForm mode="edit" fy={fy} initial={row} />;
}
