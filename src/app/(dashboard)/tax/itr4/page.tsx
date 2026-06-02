'use client';

/**
 * ITR-4 (Sugam) walkthrough — Sprint 4.1.
 *
 * Salary + presumptive income (44AD / 44ADA / 44AE) + other sources,
 * total ≤ ₹50L. Renders four blocks:
 *   • Salary (read-only summary)
 *   • Presumptive income — table of rows with section / receipts /
 *     deemed-% / declared. Row colour indicates compliance:
 *       – green  ✓ declared > minimum
 *       – amber  = declared == minimum (just at the floor)
 *       – red    declared < minimum (server should have rejected; the
 *                 row only renders if it slipped through pre-validation)
 *   • Other sources
 *   • Section 80 + tax computation
 *
 * `exceedsCap` (total > ₹50L OR 44AD gross > ₹2cr) → amber banner
 * pointing the user to ITR-3.
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Card,
  CardHeader,
  CardContent,
  Badge,
  Button,
  Select,
  StatsDisplay,
} from '@dxp/ui';
import {
  Loader2,
  AlertTriangle,
  ArrowRight,
  Banknote,
  Wallet,
  Calculator,
  Receipt,
  Plus,
  Pencil,
  Trash2,
  Briefcase,
} from 'lucide-react';
import { toast } from 'sonner';
import { getCurrentFinancialYear } from '@/lib/finance/tax-constants';
import { ItrResultBanner } from '@/components/forms/itr-result-banner';

interface PresumptiveRow {
  id: number;
  section: '44AD' | '44ADA' | '44AE';
  businessName: string;
  natureOfBusiness: string | null;
  grossReceiptsPaisa: number;
  receiptMode: 'DIGITAL' | 'CASH' | 'MIXED';
  deemedProfitPct: number;
  declaredProfitPaisa: number;
  minimumProfitPaisa: number;
  belowMinimum: boolean;
  exceedsCap: boolean;
}

interface Itr4Response {
  fy: string;
  regime: 'OLD' | 'NEW';
  blocks: {
    salary: {
      employerCount: number;
      grossPaisa: number;
      exemptionsPaisa: number;
      taxableSalaryPaisa: number;
      tdsPaisa: number;
    };
    presumptive: {
      rows: PresumptiveRow[];
      totalDeclaredProfitPaisa: number;
    };
    otherSources: { rowCount: number; taxablePaisa: number };
    deductions: { rowCount: number; oldRegimeTotalPaisa: number; appliedPaisa: number };
  };
  summary: {
    salaryIncomePaisa: number;
    totalPresumptiveProfitPaisa: number;
    otherSourcesPaisa: number;
    grossTotalIncomePaisa: number;
    taxableIncomePaisa: number;
    slabTaxPaisa: number;
    rebatePaisa: number;
    taxAfterRebatePaisa: number;
    cessPaisa: number;
    totalTaxPaisa: number;
    effectiveRatePct: number;
    exceedsCap: boolean;
    salaryTdsPaisa: number;
  };
}

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

function generateFyOptions(): string[] {
  const current = getCurrentFinancialYear();
  const startYear = Number(current.split('-')[0]);
  const out: string[] = [];
  for (let i = -2; i <= 2; i++) {
    const s = startYear + i;
    const e = String((s + 1) % 100).padStart(2, '0');
    out.push(`${s}-${e}`);
  }
  return out;
}

function previousFy(): string {
  const current = getCurrentFinancialYear();
  const startYear = Number(current.split('-')[0]) - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

function complianceBadge(r: PresumptiveRow) {
  if (r.belowMinimum) return <Badge variant="danger">Below minimum</Badge>;
  if (r.declaredProfitPaisa === r.minimumProfitPaisa)
    return <Badge variant="warning">At minimum</Badge>;
  return <Badge variant="success">Above minimum</Badge>;
}

export default function Itr4Page() {
  const [fy, setFy] = useState(previousFy());
  const [data, setData] = useState<Itr4Response | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setData(null);
    try {
      const r = await fetch(`/api/tax/itr4/summary?fy=${encodeURIComponent(fy)}`);
      const j = await r.json();
      if (!r.ok) setError(j.error || 'Failed');
      else setData(j);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setIsLoading(false);
    }
  }, [fy]);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (id: number) => {
    if (!confirm('Delete this presumptive row?')) return;
    try {
      const r = await fetch(`/api/tax/itr4/presumptive/${id}`, { method: 'DELETE' });
      if (!r.ok) {
        const j = await r.json();
        throw new Error(j?.error || 'Failed');
      }
      toast.success('Deleted');
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  const fyOptions = generateFyOptions().map((y) => ({ value: y, label: `FY ${y}` }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
            ITR-4 (Sugam)
          </h1>
          <p className="text-[var(--dxp-text-secondary)]">
            Salary + presumptive income (44AD / 44ADA / 44AE) + other sources. Total ≤ ₹50L.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data && <Badge variant="info">Regime: {data.regime}</Badge>}
          <div className="w-40">
            <Select options={fyOptions} value={fy} onChange={(v) => setFy(v)} />
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--dxp-text-muted)]" />
        </div>
      ) : error ? (
        <Card>
          <CardContent>
            <div className="flex items-start gap-3 py-4">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              <div>
                <p className="text-sm font-bold text-[var(--dxp-text)]">
                  Cannot compute summary
                </p>
                <p className="text-xs text-[var(--dxp-text-muted)]">{error}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : !data ? null : (
        <>
          {/* Sprint 5.2 (E) — ITR result banner */}
          <ItrResultBanner
            fy={fy}
            form="ITR-4"
            regime={data.regime}
            totalTaxPaisa={data.summary.totalTaxPaisa}
            salaryTdsPaisa={data.summary.salaryTdsPaisa}
          />
          {data.summary.exceedsCap && (
            <Card>
              <CardContent>
                <div className="flex items-start gap-3 py-2">
                  <AlertTriangle className="h-5 w-5 flex-shrink-0 text-amber-500" />
                  <div className="flex-1">
                    <p className="text-sm font-bold text-[var(--dxp-text)]">
                      Total income {'>'} ₹50L OR 44AD receipts {'>'} ₹2cr — file ITR-3 instead
                    </p>
                    <p className="text-xs text-[var(--dxp-text-muted)]">
                      Sugam is unavailable beyond those thresholds.
                    </p>
                  </div>
                  <Link href={`/tax/itr3?fy=${encodeURIComponent(fy)}`}>
                    <Button variant="primary" size="sm">
                      Go to ITR-3 <ArrowRight className="ml-1 h-3 w-3" />
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          )}

          <StatsDisplay
            currency="INR"
            locale="en-IN"
            columns={3}
            stats={[
              {
                label: 'Total income',
                value: data.summary.grossTotalIncomePaisa / 100,
                format: 'currency',
              },
              {
                label: 'Total tax',
                value: data.summary.totalTaxPaisa / 100,
                format: 'currency',
              },
              {
                label: 'Effective rate %',
                value: Math.round(data.summary.effectiveRatePct * 100) / 100,
                format: 'number',
              },
            ]}
          />

          {/* Salary */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Banknote className="h-4 w-4 text-[var(--dxp-text-muted)]" />
                <h3 className="text-base font-bold text-[var(--dxp-text)]">
                  Income from Salary
                </h3>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                <Field label="Employers" value={String(data.blocks.salary.employerCount)} />
                <Field label="Gross" value={formatINR(data.blocks.salary.grossPaisa)} />
                <Field
                  label="Exemptions"
                  value={formatINR(data.blocks.salary.exemptionsPaisa)}
                />
                <Field
                  label="Taxable"
                  value={formatINR(data.blocks.salary.taxableSalaryPaisa)}
                />
                <Field label="TDS" value={formatINR(data.blocks.salary.tdsPaisa)} />
              </div>
            </CardContent>
          </Card>

          {/* Presumptive */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Briefcase className="h-4 w-4 text-[var(--dxp-text-muted)]" />
                  <h3 className="text-base font-bold text-[var(--dxp-text)]">
                    Presumptive income
                  </h3>
                </div>
                <Link href={`/tax/itr4/presumptive/new?fy=${encodeURIComponent(fy)}`}>
                  <Button variant="primary" size="sm">
                    <Plus className="mr-1 h-3 w-3" /> Add row
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              {data.blocks.presumptive.rows.length === 0 ? (
                <p className="text-sm text-[var(--dxp-text-muted)]">
                  No presumptive-income rows yet. Add a 44AD/44ADA/44AE row to populate the
                  Sugam summary.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--dxp-border-light)] text-xs text-[var(--dxp-text-muted)]">
                        <th className="px-2 py-2 text-left">Section</th>
                        <th className="px-2 py-2 text-left">Business</th>
                        <th className="px-2 py-2 text-right">Gross receipts</th>
                        <th className="px-2 py-2 text-right">Deemed %</th>
                        <th className="px-2 py-2 text-right">Declared profit</th>
                        <th className="px-2 py-2 text-center">Status</th>
                        <th className="px-2 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.blocks.presumptive.rows.map((r) => (
                        <tr
                          key={r.id}
                          className="border-b border-[var(--dxp-border-light)] text-[var(--dxp-text)]"
                        >
                          <td className="px-2 py-2 font-mono">
                            {r.section}
                            {r.receiptMode !== 'DIGITAL' && (
                              <span className="ml-1 text-xs text-[var(--dxp-text-muted)]">
                                ({r.receiptMode})
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-2">
                            <p className="font-bold">{r.businessName}</p>
                            {r.natureOfBusiness && (
                              <p className="text-xs text-[var(--dxp-text-muted)]">
                                {r.natureOfBusiness}
                              </p>
                            )}
                          </td>
                          <td className="px-2 py-2 text-right">
                            {formatINR(r.grossReceiptsPaisa)}
                          </td>
                          <td className="px-2 py-2 text-right">
                            {r.deemedProfitPct ? `${r.deemedProfitPct}%` : '—'}
                          </td>
                          <td className="px-2 py-2 text-right">
                            <p className="font-bold">{formatINR(r.declaredProfitPaisa)}</p>
                            <p className="text-xs text-[var(--dxp-text-muted)]">
                              min {formatINR(r.minimumProfitPaisa)}
                            </p>
                          </td>
                          <td className="px-2 py-2 text-center">{complianceBadge(r)}</td>
                          <td className="px-2 py-2 text-right">
                            <div className="flex justify-end gap-1">
                              <Link
                                href={`/tax/itr4/presumptive/${r.id}?fy=${encodeURIComponent(fy)}`}
                              >
                                <Button variant="ghost" size="sm">
                                  <Pencil className="h-3 w-3" />
                                </Button>
                              </Link>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => remove(r.id)}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-[var(--dxp-surface)] font-bold">
                        <td className="px-2 py-2" colSpan={4}>
                          Total declared profit
                        </td>
                        <td className="px-2 py-2 text-right">
                          {formatINR(data.blocks.presumptive.totalDeclaredProfitPaisa)}
                        </td>
                        <td colSpan={2}></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Other sources */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-[var(--dxp-text-muted)]" />
                <h3 className="text-base font-bold text-[var(--dxp-text)]">
                  Income from Other Sources
                </h3>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Field label="Rows" value={String(data.blocks.otherSources.rowCount)} />
                <Field
                  label="Taxable"
                  value={formatINR(data.blocks.otherSources.taxablePaisa)}
                />
              </div>
            </CardContent>
          </Card>

          {/* Section 80 + Tax */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Receipt className="h-4 w-4 text-[var(--dxp-text-muted)]" />
                <h3 className="text-base font-bold text-[var(--dxp-text)]">
                  Section 80 deductions
                </h3>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
                <Field label="Rows" value={String(data.blocks.deductions.rowCount)} />
                <Field
                  label="OLD regime total"
                  value={formatINR(data.blocks.deductions.oldRegimeTotalPaisa)}
                />
                <Field
                  label={`Applied under ${data.regime}`}
                  value={formatINR(data.blocks.deductions.appliedPaisa)}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Calculator className="h-4 w-4 text-[var(--dxp-text-muted)]" />
                <h3 className="text-base font-bold text-[var(--dxp-text)]">Tax computation</h3>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
                <Field
                  label="Gross total income"
                  value={formatINR(data.summary.grossTotalIncomePaisa)}
                />
                <Field
                  label="Taxable income"
                  value={formatINR(data.summary.taxableIncomePaisa)}
                />
                <Field label="Slab tax" value={formatINR(data.summary.slabTaxPaisa)} />
                <Field label="87A rebate" value={formatINR(data.summary.rebatePaisa)} />
                <Field
                  label="Tax after rebate"
                  value={formatINR(data.summary.taxAfterRebatePaisa)}
                />
                <Field label="Cess (4%)" value={formatINR(data.summary.cessPaisa)} />
                <Field
                  label="Total tax"
                  value={formatINR(data.summary.totalTaxPaisa)}
                  highlight
                />
              </div>
            </CardContent>
          </Card>

          <p className="text-xs text-[var(--dxp-text-muted)]">
            44AE per-vehicle math accepts manual declared profit; no in-app vehicle ledger yet.
            44AD digital receipts qualify for 6% deemed profit; cash/mixed = 8%. 44ADA
            professionals = 50% deemed.
          </p>
        </>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-[var(--dxp-text-muted)]">{label}</p>
      <p
        className={
          highlight
            ? 'text-base font-bold text-[var(--dxp-text)]'
            : 'text-sm font-bold text-[var(--dxp-text)]'
        }
      >
        {value}
      </p>
    </div>
  );
}
