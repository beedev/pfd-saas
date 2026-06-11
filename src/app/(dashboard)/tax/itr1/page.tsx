'use client';

/**
 * ITR-1 (Sahaj) walkthrough — Sprint 4.1.
 *
 * Single-page summary that reads /api/tax/itr1/summary and renders the
 * three Sahaj-eligible income blocks (Salary / Single House Property /
 * Other Sources) plus Section 80 deductions and the slab-tax box.
 *
 * The page is intentionally read-only — Sahaj is for filers whose data
 * is already captured in the granular pages (/income, /investments/
 * real-estate, /tax). This view aggregates without duplicating CRUD.
 *
 * Visual rules:
 *   • `exceedsCap` (gross > ₹50L) → amber banner with CTA to /tax/itr2
 *   • Missing FY slab data → 422 → empty state with manual prompt
 *   • Honesty footer enumerates what Sahaj does NOT cover
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardContent, Badge, Button, StatsDisplay } from '@dxp/ui';
import { Loader2, AlertTriangle, ArrowRight, Banknote, Home, Wallet, Calculator, Receipt } from 'lucide-react';
import { toast } from 'sonner';
import { useFinancialYear } from '@/components/providers/financial-year-provider';
import { ItrResultBanner } from '@/components/forms/itr-result-banner';
import {
  ItrEligibilityBanner,
  type EligibilityFlags,
  type ExcludedIncomeBlock,
  type ItrFormCode,
} from '@/components/forms/itr-eligibility-banner';

interface HousePropertyRow {
  id: number;
  name: string;
  rentalPaisa: number;
  sec24bPaisa: number;
  isSelfOccupied: boolean;
}

interface Itr1Summary {
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
    houseProperty: null | {
      propertyName: string;
      annualRentPaisa: number;
      municipalTaxesPaisa: number;
      homeLoanInterestPaisa: number;
      netIncomePaisa: number;
    };
    otherSources: { rowCount: number; taxableInterestPaisa: number };
    deductions: { rowCount: number; oldRegimeTotalPaisa: number; appliedPaisa: number };
  };
  summary: {
    salaryIncomePaisa: number;
    housePropertyIncomePaisa: number;
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
  };
  eligibility: { isEligible: boolean; flags: EligibilityFlags };
  excludedIncomeBlocks: ExcludedIncomeBlock[];
  housePropertyRows: HousePropertyRow[];
  wizardSelectedForm: ItrFormCode | null;
}

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

export default function Itr1Page() {
  const { fy } = useFinancialYear();
  const [data, setData] = useState<Itr1Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setData(null);
    try {
      const r = await fetch(`/api/tax/itr1/summary?fy=${encodeURIComponent(fy)}`);
      const j = await r.json();
      if (!r.ok) {
        setError(j.error || 'Failed to load summary');
      } else {
        setData(j);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setIsLoading(false);
    }
  }, [fy]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
            ITR-1 (Sahaj)
          </h1>
          <p className="text-[var(--dxp-text-secondary)]">
            Salary + at most one house property + interest income. Total ≤ ₹50L.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data && <Badge variant="info">Regime: {data.regime}</Badge>}
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
          {/* Sprint 5.4 — eligibility banner (wizard mismatch + ineligibility) */}
          <ItrEligibilityBanner
            formCode="ITR-1"
            fy={fy}
            wizardSelectedForm={data.wizardSelectedForm}
            excludedIncomeBlocks={data.excludedIncomeBlocks}
            eligibilityFlags={data.eligibility.flags}
          />
          {/* Sprint 5.2 (E) — ITR result banner */}
          <ItrResultBanner
            fy={fy}
            form="ITR-1"
            regime={data.regime}
            totalTaxPaisa={data.summary.totalTaxPaisa}
            salaryTdsPaisa={data.blocks.salary.tdsPaisa}
          />
          {data.summary.exceedsCap && (
            <Card>
              <CardContent>
                <div className="flex items-start gap-3 py-2">
                  <AlertTriangle className="h-5 w-5 flex-shrink-0 text-amber-500" />
                  <div className="flex-1">
                    <p className="text-sm font-bold text-[var(--dxp-text)]">
                      Total income exceeds ₹50L — file ITR-2 instead
                    </p>
                    <p className="text-xs text-[var(--dxp-text-muted)]">
                      Sahaj is unavailable above ₹50L gross total income.
                    </p>
                  </div>
                  <Link href={`/tax/itr2?fy=${encodeURIComponent(fy)}`}>
                    <Button variant="primary" size="sm">
                      Go to ITR-2 <ArrowRight className="ml-1 h-3 w-3" />
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Headline — Sprint 5.4: relabel to disambiguate ITR-1's
              eligible-income from the user's actual cross-form total. */}
          <StatsDisplay
            currency="INR"
            locale="en-IN"
            columns={3}
            stats={[
              {
                label: 'ITR-1 eligible income',
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
          {data.excludedIncomeBlocks.length > 0 && (
            <p className="text-xs text-[var(--dxp-text-muted)]">
              Actual income across all forms: {formatINR(
                data.summary.grossTotalIncomePaisa +
                  data.excludedIncomeBlocks.reduce((s, b) => s + b.amountPaisa, 0),
              )}{' '}
              — the ITR-1 number above excludes{' '}
              {data.excludedIncomeBlocks.map((b) => b.label.toLowerCase()).join(' and ')}.
            </p>
          )}

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
                <Field label="Gross salary" value={formatINR(data.blocks.salary.grossPaisa)} />
                <Field
                  label="Section 10 exemptions"
                  value={formatINR(data.blocks.salary.exemptionsPaisa)}
                />
                <Field
                  label="Taxable salary"
                  value={formatINR(data.blocks.salary.taxableSalaryPaisa)}
                />
                <Field label="TDS deducted" value={formatINR(data.blocks.salary.tdsPaisa)} />
              </div>
            </CardContent>
          </Card>

          {/* House Property — Sprint 5.4: surface ALL properties when
              the user has more than one. ITR-1 only computes against the
              first row; the extra rows render purely for disclosure so
              the user understands why their other rentals dropped out. */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Home className="h-4 w-4 text-[var(--dxp-text-muted)]" />
                <h3 className="text-base font-bold text-[var(--dxp-text)]">
                  Income from House Property
                </h3>
              </div>
            </CardHeader>
            <CardContent>
              {data.housePropertyRows.length === 0 ? (
                <p className="text-sm text-[var(--dxp-text-muted)]">
                  No property recorded in /investments/real-estate.
                </p>
              ) : (
                <div className="space-y-3 text-sm">
                  {data.housePropertyRows.length > 1 && (
                    <div className="rounded-md border border-amber-300 bg-amber-50/40 px-3 py-2 text-xs text-[var(--dxp-text-secondary)]">
                      <strong className="text-[var(--dxp-text)]">
                        ITR-1 allows only one house property.
                      </strong>{' '}
                      Only the first property below feeds the tax computation. Your additional{' '}
                      {formatINR(
                        data.housePropertyRows
                          .slice(1)
                          .filter((r) => !r.isSelfOccupied && r.rentalPaisa > 0)
                          .reduce((s, r) => s + r.rentalPaisa, 0),
                      )}{' '}
                      of rental income won&apos;t fit — file ITR-2 to include all of these.
                    </div>
                  )}
                  {data.blocks.houseProperty && (
                    <div className="space-y-2">
                      <p className="font-bold text-[var(--dxp-text)]">
                        {data.blocks.houseProperty.propertyName}{' '}
                        <Badge variant="info">In ITR-1</Badge>
                      </p>
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                        <Field
                          label="Annual rent (GAV)"
                          value={formatINR(data.blocks.houseProperty.annualRentPaisa)}
                        />
                        <Field
                          label="Municipal taxes"
                          value={formatINR(data.blocks.houseProperty.municipalTaxesPaisa)}
                        />
                        <Field
                          label="Home-loan interest 24(b)"
                          value={formatINR(data.blocks.houseProperty.homeLoanInterestPaisa)}
                        />
                        <Field
                          label="Net HP income"
                          value={formatINR(data.blocks.houseProperty.netIncomePaisa)}
                        />
                      </div>
                    </div>
                  )}
                  {data.housePropertyRows.length > 1 && (
                    <div className="space-y-2 border-t border-[var(--dxp-border-light)] pt-3">
                      <p className="text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-muted)]">
                        Additional properties (excluded from ITR-1)
                      </p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-[var(--dxp-border-light)] text-xs text-[var(--dxp-text-muted)]">
                              <th className="px-2 py-2 text-left">Property</th>
                              <th className="px-2 py-2 text-left">Status</th>
                              <th className="px-2 py-2 text-right">Annual rent</th>
                              <th className="px-2 py-2 text-right">24(b) interest</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.housePropertyRows.slice(1).map((r) => (
                              <tr
                                key={r.id}
                                className="border-b border-[var(--dxp-border-light)] text-[var(--dxp-text)]"
                              >
                                <td className="px-2 py-2 font-bold">{r.name}</td>
                                <td className="px-2 py-2">
                                  {r.isSelfOccupied ? (
                                    <Badge variant="default">Self-occupied</Badge>
                                  ) : r.rentalPaisa > 0 ? (
                                    <Badge variant="warning">Let-out</Badge>
                                  ) : (
                                    <Badge variant="default">Vacant</Badge>
                                  )}
                                </td>
                                <td className="px-2 py-2 text-right">
                                  {formatINR(r.rentalPaisa)}
                                </td>
                                <td className="px-2 py-2 text-right">
                                  {formatINR(r.sec24bPaisa)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  <p className="text-xs text-[var(--dxp-text-muted)]">
                    NAV = GAV − municipal taxes; minus 30% std maintenance; minus loan interest.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Other Sources */}
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
              <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
                <Field
                  label="Rows in /income"
                  value={String(data.blocks.otherSources.rowCount)}
                />
                <Field
                  label="Taxable interest (bank/FD/PF/dividend)"
                  value={formatINR(data.blocks.otherSources.taxableInterestPaisa)}
                />
              </div>
              <p className="mt-2 text-xs text-[var(--dxp-text-muted)]">
                ITR-1 only accepts interest-flavoured other-sources income. Business / freelance /
                presumptive sources push you into ITR-3/4.
              </p>
            </CardContent>
          </Card>

          {/* Section 80 deductions */}
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
                <Field
                  label="Rows"
                  value={String(data.blocks.deductions.rowCount)}
                />
                <Field
                  label="OLD regime total"
                  value={formatINR(data.blocks.deductions.oldRegimeTotalPaisa)}
                />
                <Field
                  label={`Applied under ${data.regime}`}
                  value={formatINR(data.blocks.deductions.appliedPaisa)}
                />
              </div>
              <p className="mt-2 text-xs text-[var(--dxp-text-muted)]">
                NEW regime currently disallows most Chapter VI-A deductions; the engine applies ₹0
                conservatively. Per-row regime eligibility is on the Sprint 4 deferred list.
              </p>
            </CardContent>
          </Card>

          {/* Tax computation */}
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
                  label="Taxable income (post std + 80)"
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
            ITR-1 skips: capital gains, multiple houses, business income, foreign assets. If any
            apply, bump up to ITR-2 (capital gains / multi-house), ITR-3 (business), or ITR-4
            (presumptive).
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
