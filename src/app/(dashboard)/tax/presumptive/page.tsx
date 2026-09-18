'use client';

/**
 * /tax/presumptive — declare presumptive income (44AD / 44ADA / 44AE).
 *
 * Why this page exists as a top-level destination rather than a card inside
 * /tax/itr4 (where it used to live):
 *
 * Presumptive income is an INCOME declaration, not an artifact of one ITR form.
 * It sets your taxable business profit, which then feeds regime-compare, the
 * advance-tax projection and the ITR selector. Burying it under the ITR-4
 * walkthrough made it circular — the wizard picks your form from your income
 * composition, but whether you file presumptively IS part of that composition,
 * so you were asked to accept a form recommendation before you were allowed to
 * state the fact the recommendation depends on. In practice it was unreachable:
 * the only path was wizard -> "Continue to ITR-4 walkthrough" -> Add row.
 *
 * The consequence was real. Without a declaration for an FY,
 * lib/finance/tax-compute falls back to taxing GROSS RECEIPTS in full, which for
 * a 44ADA professional roughly doubles the taxable figure. See
 * docs/changes/CHANGES-2026-09-18.md.
 *
 * So this page also shows the FY's GST receipts next to the declaration, which
 * is the comparison that makes a missing or wrong declaration obvious.
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardContent, Badge, Button, StatsDisplay } from '@dxp/ui';
import {
  Loader2,
  Plus,
  Pencil,
  Trash2,
  Briefcase,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useFinancialYear } from '@/components/providers/financial-year-provider';

interface PresumptiveRow {
  id: number;
  fy: string;
  section: '44AD' | '44ADA' | '44AE';
  businessName: string | null;
  grossReceiptsPaisa: number;
  receiptMode: 'DIGITAL' | 'CASH' | 'MIXED' | null;
  declaredProfitPaisa: number;
}

const formatINR = (paisa: number) =>
  '₹' + Math.round(paisa / 100).toLocaleString('en-IN');

/** Statutory minimum deemed profit. 44AE has no auto-minimum (per-vehicle). */
function minimumProfitPaisa(row: PresumptiveRow): number | null {
  if (row.section === '44ADA') return Math.round(row.grossReceiptsPaisa * 0.5);
  if (row.section === '44AD') {
    const pct = row.receiptMode === 'CASH' ? 0.08 : 0.06;
    return Math.round(row.grossReceiptsPaisa * pct);
  }
  return null;
}

const SECTION_BLURB: Record<string, string> = {
  '44AD': 'Small business — deemed profit 6% of digital receipts, 8% of cash.',
  '44ADA': 'Professionals — deemed profit 50% of gross receipts.',
  '44AE': 'Goods carriage — profit derived per vehicle, declared manually.',
};

export default function PresumptivePage() {
  const { fy } = useFinancialYear();
  const [rows, setRows] = useState<PresumptiveRow[]>([]);
  const [gstReceiptsPaisa, setGstReceiptsPaisa] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [pr, rc] = await Promise.all([
        fetch(`/api/tax/presumptive?fy=${encodeURIComponent(fy)}`).then((r) => r.json()),
        // regime-compare knows the FY's GST receipts — reuse it rather than
        // re-deriving the FY window here and risking a second source of truth.
        fetch(`/api/tax/regime-compare?fy=${encodeURIComponent(fy)}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);
      setRows(pr?.entries ?? []);
      setGstReceiptsPaisa(rc?.income?.businessGrossReceipts ?? null);
    } catch {
      toast.error('Could not load presumptive income');
    } finally {
      setIsLoading(false);
    }
  }, [fy]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (id: number) => {
    if (!confirm('Delete this presumptive declaration?')) return;
    const r = await fetch(`/api/tax/presumptive/${id}`, { method: 'DELETE' });
    if (r.ok) {
      toast.success('Deleted');
      void load();
    } else {
      toast.error('Delete failed');
    }
  };

  const declaredTotal = rows.reduce((s, r) => s + r.declaredProfitPaisa, 0);
  const receiptsTotal = rows.reduce((s, r) => s + r.grossReceiptsPaisa, 0);
  const undeclared = rows.length === 0 && (gstReceiptsPaisa ?? 0) > 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-[var(--dxp-text)]">Presumptive income</h1>
        <p className="text-sm text-[var(--dxp-text-secondary)]">
          Sections 44AD / 44ADA / 44AE — for FY {fy}. This sets your taxable business
          profit for every form and every regime.
        </p>
      </div>

      {/* The case this page exists for: receipts on file, nothing declared. */}
      {undeclared && (
        <Card>
          <CardContent>
            <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
              <div className="text-sm text-amber-900">
                <p className="font-semibold">
                  You have {formatINR(gstReceiptsPaisa!)} of GST receipts for FY {fy} and no
                  presumptive declaration.
                </p>
                <p className="mt-1 leading-relaxed">
                  Until you declare, your tax is computed on the{' '}
                  <strong>full receipts</strong> as if every rupee were profit. Under 44ADA
                  only <strong>{formatINR(Math.round(gstReceiptsPaisa! * 0.5))}</strong> would
                  be taxable; under 44AD, 6–8%. Declaring is an election you make per year —
                  it is not carried forward automatically.
                </p>
                <Link href={`/tax/presumptive/new?fy=${encodeURIComponent(fy)}`}>
                  <Button variant="primary" size="sm" className="mt-2">
                    <Plus className="mr-1 h-3 w-3" /> Declare for FY {fy}
                  </Button>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {rows.length > 0 && (
        <StatsDisplay
          currency="INR"
          locale="en-IN"
          columns={3}
          stats={[
            {
              label: 'Gross receipts declared',
              value: receiptsTotal / 100,
              format: 'currency',
            },
            {
              label: 'Profit declared (taxable)',
              value: declaredTotal / 100,
              format: 'currency',
            },
            {
              label: 'Effective rate',
              value: receiptsTotal > 0 ? (declaredTotal / receiptsTotal) * 100 : 0,
              format: 'percent',
            },
          ]}
        />
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-[var(--dxp-text-muted)]" />
              <h3 className="text-base font-bold text-[var(--dxp-text)]">
                Declarations for FY {fy}
              </h3>
            </div>
            <Link href={`/tax/presumptive/new?fy=${encodeURIComponent(fy)}`}>
              <Button variant="primary" size="sm">
                <Plus className="mr-1 h-3 w-3" /> Add declaration
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-[var(--dxp-text-muted)]" />
            </div>
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--dxp-text-muted)]">
              No presumptive income declared for FY {fy}.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--dxp-border)] text-left text-xs text-[var(--dxp-text-muted)]">
                    <th className="py-2 pr-3">Section</th>
                    <th className="py-2 pr-3">Business</th>
                    <th className="py-2 pr-3 text-right">Gross receipts</th>
                    <th className="py-2 pr-3 text-right">Declared profit</th>
                    <th className="py-2 pr-3">Against minimum</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const min = minimumProfitPaisa(r);
                    const ok = min === null || r.declaredProfitPaisa >= min;
                    return (
                      <tr key={r.id} className="border-b border-[var(--dxp-border)] last:border-0">
                        <td className="py-2 pr-3">
                          <Badge variant="info">{r.section}</Badge>
                        </td>
                        <td className="py-2 pr-3 text-[var(--dxp-text-secondary)]">
                          {r.businessName || '—'}
                          {r.section === '44AD' && r.receiptMode && (
                            <span className="ml-1 text-[10px] text-[var(--dxp-text-muted)]">
                              · {r.receiptMode.toLowerCase()}
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {formatINR(r.grossReceiptsPaisa)}
                        </td>
                        <td className="py-2 pr-3 text-right font-medium tabular-nums">
                          {formatINR(r.declaredProfitPaisa)}
                        </td>
                        <td className="py-2 pr-3">
                          {min === null ? (
                            <span className="text-xs text-[var(--dxp-text-muted)]">
                              manual (44AE)
                            </span>
                          ) : ok ? (
                            <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                              <CheckCircle2 className="h-3 w-3" /> ≥ {formatINR(min)}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700">
                              <AlertTriangle className="h-3 w-3" /> below {formatINR(min)} —
                              audit under 44AB(e)
                            </span>
                          )}
                        </td>
                        <td className="py-2 text-right">
                          <Link href={`/tax/presumptive/${r.id}?fy=${encodeURIComponent(fy)}`}>
                            <Button variant="ghost" size="sm">
                              <Pencil className="h-3 w-3" />
                            </Button>
                          </Link>
                          <Button variant="ghost" size="sm" onClick={() => remove(r.id)}>
                            <Trash2 className="h-3 w-3 text-red-600" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h3 className="text-sm font-bold text-[var(--dxp-text)]">Which section applies</h3>
        </CardHeader>
        <CardContent>
          <dl className="space-y-2 text-sm">
            {(['44ADA', '44AD', '44AE'] as const).map((sec) => (
              <div key={sec} className="flex gap-3">
                <dt className="w-16 shrink-0">
                  <Badge variant="info">{sec}</Badge>
                </dt>
                <dd className="text-[var(--dxp-text-secondary)]">{SECTION_BLURB[sec]}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-[var(--dxp-text-muted)]">
            Declaring below the deemed minimum triggers a tax audit under section 44AB(e).
            Presumptive is a per-year election with eligibility limits (44ADA receipts up to
            ₹75L), and opting out of 44AD carries a five-year lock-out — so nothing here is
            carried forward for you.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
