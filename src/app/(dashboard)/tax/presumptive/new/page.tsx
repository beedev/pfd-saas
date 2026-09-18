'use client';

/**
 * Create a new presumptive-income row — Sprint 4.1.
 *
 * Wrapper around <PresumptiveForm mode="create"> that reads the FY
 * from ?fy=... (falls back to previous FY).
 */

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { PresumptiveForm } from '../_form';
import { getCurrentFinancialYear } from '@/lib/finance/tax-constants';

function previousFy(): string {
  const current = getCurrentFinancialYear();
  const startYear = Number(current.split('-')[0]) - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

export default function NewPresumptivePage() {
  return (
    <Suspense fallback={<div className="p-6 text-[var(--dxp-text-muted)]">Loading…</div>}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const sp = useSearchParams();
  const fy = sp.get('fy') ?? previousFy();
  return <PresumptiveForm mode="create" fy={fy} />;
}
