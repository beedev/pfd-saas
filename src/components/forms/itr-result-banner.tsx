'use client';

/**
 * ITR result banner — Sprint 5.2 commit 1 (E).
 *
 * Sits directly under the page title on /tax/itr1, /itr2, /itr3, /itr4.
 * Surfaces the headline numbers (tax, TDS, balance/refund) so the user
 * doesn't have to scroll. Also offers a "Switch form" CTA to the ITR
 * wizard.
 *
 * Data sources:
 *   • totalTaxPaisa: passed in by caller (already computed for the form)
 *   • TDS: salary TDS (passed in) + sum of /api/tax/itr3/tds entries
 *   • Advance: /api/tax/advance-tax
 *
 * The caller passes the form name + regime + total tax + (optional) the
 * salary TDS it already has so we don't double-fetch.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, Button, Badge } from '@dxp/ui';
import { Loader2, ArrowRight } from 'lucide-react';

interface Props {
  fy: string;
  form: 'ITR-1' | 'ITR-2' | 'ITR-3' | 'ITR-4';
  regime: 'OLD' | 'NEW';
  totalTaxPaisa: number;
  /** If the caller already has salary TDS, pass it. We'll add non-salary
   *  TDS from /api/tax/itr3/tds on top. */
  salaryTdsPaisa?: number;
}

const formatINR = (paisa: number): string =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

export function ItrResultBanner({
  fy,
  form,
  regime,
  totalTaxPaisa,
  salaryTdsPaisa,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [nonSalaryTdsPaisa, setNonSalaryTdsPaisa] = useState(0);
  const [advancePaisa, setAdvancePaisa] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetch(`/api/tax/itr3/tds?fy=${fy}`).then(async (r) =>
        r.ok ? await r.json() : null,
      ),
      fetch(`/api/tax/advance-tax?fy=${fy}`).then(async (r) =>
        r.ok ? await r.json() : null,
      ),
    ])
      .then(([tds, adv]) => {
        if (cancelled) return;
        const tdsSum =
          tds?.entries?.reduce(
            (s: number, r: { tdsPaisa: number }) => s + (r.tdsPaisa ?? 0),
            0,
          ) ?? 0;
        setNonSalaryTdsPaisa(tdsSum);
        const advSum =
          adv?.installments?.reduce(
            (s: number, i: { paidAmountPaisa: number }) =>
              s + (i.paidAmountPaisa ?? 0),
            0,
          ) ?? 0;
        setAdvancePaisa(advSum);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fy]);

  if (loading) {
    return (
      <Card>
        <CardContent>
          <div className="flex items-center gap-2 py-2 text-[var(--dxp-text-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading ITR result…
          </div>
        </CardContent>
      </Card>
    );
  }

  const totalTdsPaisa = (salaryTdsPaisa ?? 0) + nonSalaryTdsPaisa;
  const balance = totalTaxPaisa - totalTdsPaisa - advancePaisa;
  const isRefund = balance < 0;

  const toneClass = isRefund
    ? 'border-emerald-300 bg-emerald-50/60'
    : balance > 0
    ? 'border-amber-300 bg-amber-50/40'
    : 'border-sky-300 bg-sky-50/40';

  return (
    <div className={`rounded-md border p-3 ${toneClass}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-[var(--dxp-text)]">
            Form {form}
          </span>
          <Badge variant="info">Regime {regime}</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="text-[var(--dxp-text-secondary)]">
            Total tax:{' '}
            <span className="font-mono font-bold text-[var(--dxp-text)]">
              {formatINR(totalTaxPaisa)}
            </span>
          </span>
          <span className="text-[var(--dxp-text-secondary)]">
            TDS:{' '}
            <span className="font-mono font-bold text-[var(--dxp-text)]">
              {formatINR(totalTdsPaisa)}
            </span>
          </span>
          <span className="text-[var(--dxp-text-secondary)]">
            {isRefund ? 'Refund:' : 'Balance:'}{' '}
            <span
              className={`font-mono font-bold ${
                isRefund ? 'text-emerald-700' : 'text-[var(--dxp-text)]'
              }`}
            >
              {formatINR(Math.abs(balance))}
            </span>
          </span>
        </div>
        <Link href={`/tax/itr-wizard?fy=${encodeURIComponent(fy)}`}>
          <Button variant="secondary" size="sm">
            Switch form <ArrowRight className="ml-1 h-3 w-3" />
          </Button>
        </Link>
      </div>
    </div>
  );
}
