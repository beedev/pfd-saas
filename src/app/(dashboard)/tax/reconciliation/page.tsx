'use client';

/**
 * /tax/reconciliation — Sprint C (saas back-port).
 *
 * Books vs Form 16 vs 26AS table — the canonical at-a-glance answer to
 * "is everything in agreement?". Rows are colour-coded by status; rows
 * with a mismatch are expandable to show source notes for both sides.
 *
 * Server scopes the response by session.user.id; this page just renders.
 */

import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, Card, CardHeader, CardContent, Badge } from '@dxp/ui';
import {
  ArrowLeft,
  ArrowUpRight,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  ChevronDown,
  ChevronRight,
  Scale,
  Upload,
} from 'lucide-react';
import { useFinancialYear } from '@/components/providers/financial-year-provider';

type ReconStatus = 'matched' | 'mismatch' | 'missing_actual';

interface ReconDimension {
  dimension: string;
  label: string;
  books: { valuePaisa: number; source: string };
  form16: { valuePaisa: number | null; source: string; uploadId: number | null };
  form26as: { valuePaisa: number | null; source: string; uploadId: number | null };
  delta: { form16: number | null; form26as: number | null };
  status: ReconStatus;
}

interface ReconResponse {
  fy: string;
  reconciliation: ReconDimension[];
  overall: {
    allMatched: boolean;
    matchedCount: number;
    mismatchCount: number;
    missingCount: number;
  };
}

const fmtINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

function statusBadge(status: ReconStatus) {
  if (status === 'matched') {
    return (
      <Badge variant="success">
        <CheckCircle2 className="h-3 w-3 inline mr-1" /> matched
      </Badge>
    );
  }
  if (status === 'mismatch') {
    return (
      <Badge variant="warning">
        <AlertTriangle className="h-3 w-3 inline mr-1" /> mismatch
      </Badge>
    );
  }
  return (
    <Badge variant="info">
      <HelpCircle className="h-3 w-3 inline mr-1" /> missing actual
    </Badge>
  );
}

function deltaCell(books: number, actual: number | null) {
  if (actual == null) return <span className="text-[var(--dxp-text-muted)]">—</span>;
  const delta = books - actual;
  if (Math.abs(delta) <= 100 * 100) {
    return <span className="text-emerald-600 font-mono">✓ {fmtINR(0)}</span>;
  }
  const sign = delta > 0 ? '+' : '−';
  return (
    <span className="text-amber-600 font-mono">
      {sign}{fmtINR(Math.abs(delta))}
    </span>
  );
}

export default function ReconciliationPage() {
  const { fy } = useFinancialYear();
  const [data, setData] = useState<ReconResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/tax/reconciliation?fy=${encodeURIComponent(fy)}`);
      if (!r.ok) {
        setData(null);
      } else {
        const j = (await r.json()) as ReconResponse;
        setData(j);
        // Auto-expand any mismatch rows so the user sees the source notes
        const next = new Set<string>();
        for (const d of j.reconciliation) {
          if (d.status === 'mismatch') next.add(d.dimension);
        }
        setExpanded(next);
      }
    } finally {
      setLoading(false);
    }
  }, [fy]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = (dimension: string) => {
    const next = new Set(expanded);
    if (next.has(dimension)) next.delete(dimension);
    else next.add(dimension);
    setExpanded(next);
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Link
            href="/tax"
            className="text-sm text-[var(--dxp-text-muted)] hover:underline inline-flex items-center gap-1 mb-2"
          >
            <ArrowLeft className="h-3 w-3" /> Back to Tax
          </Link>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Scale className="h-7 w-7" /> Tax Reconciliation
          </h1>
          <p className="text-sm text-[var(--dxp-text-muted)] mt-1">
            Books vs Form 16 vs Form 26AS — does everything agree for FY {fy}?
          </p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <Link href="/tax/form-16">
            <Button variant="secondary">
              <Upload className="h-4 w-4 mr-1" /> Upload Form 16
            </Button>
          </Link>
          <Link href="/tax/form-26as">
            <Button variant="secondary">
              <Upload className="h-4 w-4 mr-1" /> Upload 26AS
            </Button>
          </Link>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12 text-[var(--dxp-text-muted)]">
          <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading…
        </div>
      )}

      {!loading && data && (
        <>
          {/* Overall status banner */}
          <Card
            className={
              data.overall.allMatched
                ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30'
                : data.overall.mismatchCount > 0
                  ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/30'
                  : ''
            }
          >
            <CardContent>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  {data.overall.allMatched ? (
                    <>
                      <p className="text-lg font-bold text-emerald-700 dark:text-emerald-300">
                        Everything agrees for FY {data.fy}
                      </p>
                      <p className="text-sm text-[var(--dxp-text-muted)] mt-1">
                        All {data.overall.matchedCount} dimensions match within ±₹100 tolerance.
                      </p>
                    </>
                  ) : data.overall.mismatchCount > 0 ? (
                    <>
                      <p className="text-lg font-bold text-amber-700 dark:text-amber-300">
                        {data.overall.mismatchCount} mismatch
                        {data.overall.mismatchCount === 1 ? '' : 'es'} found
                      </p>
                      <p className="text-sm text-[var(--dxp-text-muted)] mt-1">
                        {data.overall.matchedCount} matched · {data.overall.missingCount} missing actual.
                        Review the rows below.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-lg font-bold">
                        {data.overall.missingCount} dimension
                        {data.overall.missingCount === 1 ? '' : 's'} not yet reconciled
                      </p>
                      <p className="text-sm text-[var(--dxp-text-muted)] mt-1">
                        Upload Form 16 and 26AS to complete the comparison.
                      </p>
                    </>
                  )}
                </div>
                <div className="flex gap-2 text-xs">
                  <Badge variant="success">{data.overall.matchedCount} matched</Badge>
                  {data.overall.mismatchCount > 0 && (
                    <Badge variant="warning">{data.overall.mismatchCount} mismatch</Badge>
                  )}
                  {data.overall.missingCount > 0 && (
                    <Badge variant="info">{data.overall.missingCount} missing</Badge>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Reconciliation table */}
          <Card>
            <CardHeader>
              <h2 className="text-lg font-bold">Per-dimension comparison</h2>
              <p className="text-xs text-[var(--dxp-text-muted)] mt-1">
                Click a row to see source details for both sides. Δ shown as books − actual.
              </p>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-[var(--dxp-text-muted)] border-b border-[var(--dxp-border)]">
                      <th className="py-2 pr-2 w-6"></th>
                      <th className="py-2 pr-2">Dimension</th>
                      <th className="py-2 pr-2 text-right">Books</th>
                      <th className="py-2 pr-2 text-right">Form 16</th>
                      <th className="py-2 pr-2 text-right">26AS</th>
                      <th className="py-2 pr-2 text-right">Δ Form 16</th>
                      <th className="py-2 pr-2 text-right">Δ 26AS</th>
                      <th className="py-2 pr-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.reconciliation.map((d) => {
                      const isOpen = expanded.has(d.dimension);
                      const rowClass =
                        d.status === 'mismatch'
                          ? 'bg-amber-50/40 dark:bg-amber-950/10'
                          : '';
                      return (
                        <Fragment key={d.dimension}>
                          <tr
                            className={`border-b border-[var(--dxp-border)] cursor-pointer hover:bg-[var(--dxp-surface-alt,var(--dxp-surface))] ${rowClass}`}
                            onClick={() => toggle(d.dimension)}
                          >
                            <td className="py-2 pr-2">
                              {isOpen ? (
                                <ChevronDown className="h-3 w-3 text-[var(--dxp-text-muted)]" />
                              ) : (
                                <ChevronRight className="h-3 w-3 text-[var(--dxp-text-muted)]" />
                              )}
                            </td>
                            <td className="py-2 pr-2 font-medium">{d.label}</td>
                            <td className="py-2 pr-2 text-right font-mono">
                              {fmtINR(d.books.valuePaisa)}
                            </td>
                            <td className="py-2 pr-2 text-right font-mono">
                              {d.form16.valuePaisa != null ? fmtINR(d.form16.valuePaisa) : '—'}
                            </td>
                            <td className="py-2 pr-2 text-right font-mono">
                              {d.form26as.valuePaisa != null ? fmtINR(d.form26as.valuePaisa) : '—'}
                            </td>
                            <td className="py-2 pr-2 text-right">
                              {deltaCell(d.books.valuePaisa, d.form16.valuePaisa)}
                            </td>
                            <td className="py-2 pr-2 text-right">
                              {deltaCell(d.books.valuePaisa, d.form26as.valuePaisa)}
                            </td>
                            <td className="py-2 pr-2">{statusBadge(d.status)}</td>
                          </tr>

                          {isOpen && (
                            <tr className="border-b border-[var(--dxp-border)] bg-[var(--dxp-surface-alt,var(--dxp-surface))]">
                              <td></td>
                              <td colSpan={7} className="py-3 pr-2 text-xs space-y-2">
                                <div>
                                  <span className="font-bold uppercase tracking-wide text-[var(--dxp-text-muted)]">Books: </span>
                                  <span className="text-[var(--dxp-text-secondary)]">{d.books.source}</span>
                                </div>
                                <div>
                                  <span className="font-bold uppercase tracking-wide text-[var(--dxp-text-muted)]">Form 16: </span>
                                  <span className="text-[var(--dxp-text-secondary)]">{d.form16.source}</span>
                                  {d.form16.uploadId != null && (
                                    <Link
                                      href={`/tax/form-16/${d.form16.uploadId}`}
                                      className="ml-2 text-[var(--dxp-brand)] hover:underline inline-flex items-center gap-1"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      Open <ArrowUpRight className="h-3 w-3" />
                                    </Link>
                                  )}
                                </div>
                                <div>
                                  <span className="font-bold uppercase tracking-wide text-[var(--dxp-text-muted)]">26AS: </span>
                                  <span className="text-[var(--dxp-text-secondary)]">{d.form26as.source}</span>
                                  {d.form26as.uploadId != null && (
                                    <Link
                                      href="/tax/form-26as"
                                      className="ml-2 text-[var(--dxp-brand)] hover:underline inline-flex items-center gap-1"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      Open <ArrowUpRight className="h-3 w-3" />
                                    </Link>
                                  )}
                                </div>
                                {d.status === 'mismatch' && (
                                  <p className="text-amber-700 dark:text-amber-300 pt-1">
                                    <AlertTriangle className="h-3 w-3 inline mr-1" />
                                    Reconcile by editing the lower-value side or correcting books.
                                  </p>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
