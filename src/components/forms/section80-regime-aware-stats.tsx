'use client';

/**
 * Section 80 regime-aware stats — Sprint 5.2 commit 1 (D).
 *
 * Replaces the old 3-tile StatsDisplay (Total Deductions / Estimated Tax
 * Saved 30% / Document Coverage %) with a side-by-side OLD vs NEW
 * eligible-deductions breakdown plus the actual tax delta surfaced
 * straight from regime-compare.
 *
 * Reads from /api/tax/regime-compare (already aggregates per-regime
 * deductible amounts honouring 80D buckets + 80G categories).
 */

import { useEffect, useState } from 'react';
import { Card, CardHeader, CardContent } from '@dxp/ui';
import { Loader2, Scale } from 'lucide-react';

interface RegimeCompareResp {
  deductions: { oldRegime: number; newRegime: number };
  comparison: {
    old: { totalTaxPaisa: number };
    new: { totalTaxPaisa: number };
    recommendation: 'OLD' | 'NEW';
  };
}

const formatINR = (paisa: number): string =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

interface Props {
  fy: string;
}

export function Section80RegimeAwareStats({ fy }: Props) {
  const [data, setData] = useState<RegimeCompareResp | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/tax/regime-compare?fy=${fy}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) setData(d);
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
          <div className="flex items-center gap-2 py-3 text-[var(--dxp-text-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" /> Computing deduction impact…
          </div>
        </CardContent>
      </Card>
    );
  }
  if (!data) return null;

  const oldElig = data.deductions.oldRegime;
  const newElig = data.deductions.newRegime;
  // Tax delta isolating the deduction effect: NEW total − OLD total
  // (positive = OLD saves you that much extra by virtue of deductions).
  const deltaTax = data.comparison.new.totalTaxPaisa - data.comparison.old.totalTaxPaisa;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Scale className="h-4 w-4 text-[var(--dxp-brand)]" />
          <h3 className="text-base font-bold text-[var(--dxp-text)]">
            Section 80 — eligible per regime
          </h3>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-md border border-[var(--dxp-border)] p-3">
            <p className="text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
              Eligible under OLD
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-[var(--dxp-text)]">
              {formatINR(oldElig)}
            </p>
            <p className="text-[10px] text-[var(--dxp-text-muted)]">
              All Chapter VI-A rows + bucketed 80D + categorised 80G
            </p>
          </div>
          <div className="rounded-md border border-[var(--dxp-border)] p-3">
            <p className="text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
              Eligible under NEW
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-[var(--dxp-text)]">
              {formatINR(newElig)}
            </p>
            <p className="text-[10px] text-[var(--dxp-text-muted)]">
              Only rows flagged eligible_under_new (e.g. 80CCD(2) employer NPS)
            </p>
          </div>
        </div>
        <p className="mt-3 text-xs text-[var(--dxp-text-secondary)]">
          {deltaTax > 0 ? (
            <>
              OLD saves you <strong className="text-emerald-700">{formatINR(deltaTax)}</strong> vs
              NEW thanks to these deductions.
            </>
          ) : deltaTax < 0 ? (
            <>
              NEW is still cheaper by{' '}
              <strong className="text-emerald-700">{formatINR(Math.abs(deltaTax))}</strong> even
              after counting OLD deductions.
            </>
          ) : (
            <>OLD and NEW are tied for this FY.</>
          )}
        </p>
      </CardContent>
    </Card>
  );
}
