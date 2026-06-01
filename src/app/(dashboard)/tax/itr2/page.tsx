'use client';

/**
 * ITR-2 walkthrough — Sprint 4.1.
 *
 * Salary + multi-house + capital gains + other sources. Read-only
 * summary that reads /api/tax/itr2/summary and renders five blocks:
 *   • Salary
 *   • Multi-house Schedule HP (one row per property, full math)
 *   • Other Sources
 *   • Schedule CG (STCG / LTCG broken into equity vs other, with
 *     per-rate-class tax surfaced)
 *   • Section 80 + Tax computation
 *
 * Capital-gains tax appears as a separate component (it's taxed at
 * fixed rates, not slab) — the headline total is slab + CG + cess.
 */

import { useEffect, useState, useCallback } from 'react';
import { Card, CardHeader, CardContent, Badge, Select, StatsDisplay } from '@dxp/ui';
import { Loader2, AlertTriangle, Banknote, Home, Wallet, Calculator, Receipt, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { getCurrentFinancialYear } from '@/lib/finance/tax-constants';

interface HouseRow {
  label: string;
  gavPaisa: number;
  municipalTaxesPaisa: number;
  navPaisa: number;
  stdMaintenancePaisa: number;
  interestPaisa: number;
  netIncomePaisa: number;
}

interface CapitalGainsBreakdown {
  stcgEquityTaxPaisa: number;
  ltcgEquityTaxPaisa: number;
  ltcgOtherTaxPaisa: number;
  totalCapitalGainsTaxPaisa: number;
  stcgOtherAddsToSlabPaisa: number;
  buckets: {
    stcgEquityGainsPaisa: number;
    stcgOtherGainsPaisa: number;
    ltcgEquityGainsPaisa: number;
    ltcgOtherGainsPaisa: number;
  };
  cessPaisa: number;
}

interface Itr2Response {
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
    houseProperties: HouseRow[];
    otherSources: { rowCount: number; taxablePaisa: number };
    capitalGainsRows: Array<{
      id: number;
      assetType: string;
      assetName: string;
      saleDate: string;
      taxableGainPaisa: number;
      holdingPeriod: string;
    }>;
    deductions: { rowCount: number; oldRegimeTotalPaisa: number; appliedPaisa: number };
  };
  summary: {
    salaryIncomePaisa: number;
    housePropertyIncomePaisa: number;
    otherSourcesPaisa: number;
    capitalGains: CapitalGainsBreakdown;
    slabGrossIncomePaisa: number;
    taxableIncomePaisa: number;
    slabTaxPaisa: number;
    rebatePaisa: number;
    taxAfterRebatePaisa: number;
    slabCessPaisa: number;
    slabComponentPaisa: number;
    capitalGainsComponentPaisa: number;
    totalTaxPaisa: number;
    effectiveRatePct: number;
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

export default function Itr2Page() {
  const [fy, setFy] = useState(previousFy());
  const [data, setData] = useState<Itr2Response | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setData(null);
    try {
      const r = await fetch(`/api/tax/itr2/summary?fy=${encodeURIComponent(fy)}`);
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

  const fyOptions = generateFyOptions().map((y) => ({ value: y, label: `FY ${y}` }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">ITR-2</h1>
          <p className="text-[var(--dxp-text-secondary)]">
            Salary + multiple houses + capital gains + other sources. No business income.
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
          <StatsDisplay
            currency="INR"
            locale="en-IN"
            columns={4}
            stats={[
              {
                label: 'Slab income',
                value: data.summary.slabGrossIncomePaisa / 100,
                format: 'currency',
              },
              {
                label: 'Slab tax (incl. cess)',
                value: data.summary.slabComponentPaisa / 100,
                format: 'currency',
              },
              {
                label: 'Capital-gains tax (incl. cess)',
                value: data.summary.capitalGainsComponentPaisa / 100,
                format: 'currency',
              },
              {
                label: 'Total tax',
                value: data.summary.totalTaxPaisa / 100,
                format: 'currency',
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

          {/* Schedule HP — multi house */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Home className="h-4 w-4 text-[var(--dxp-text-muted)]" />
                <h3 className="text-base font-bold text-[var(--dxp-text)]">
                  Schedule HP — House Property
                </h3>
              </div>
            </CardHeader>
            <CardContent>
              {data.blocks.houseProperties.length === 0 ? (
                <p className="text-sm text-[var(--dxp-text-muted)]">No properties recorded.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--dxp-border-light)] text-xs text-[var(--dxp-text-muted)]">
                        <th className="px-2 py-2 text-left">Property</th>
                        <th className="px-2 py-2 text-right">GAV</th>
                        <th className="px-2 py-2 text-right">Municipal</th>
                        <th className="px-2 py-2 text-right">NAV</th>
                        <th className="px-2 py-2 text-right">30% std</th>
                        <th className="px-2 py-2 text-right">Interest 24(b)</th>
                        <th className="px-2 py-2 text-right">Net HP income</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.blocks.houseProperties.map((h, i) => (
                        <tr
                          key={i}
                          className="border-b border-[var(--dxp-border-light)] text-[var(--dxp-text)]"
                        >
                          <td className="px-2 py-2 font-bold">{h.label}</td>
                          <td className="px-2 py-2 text-right">{formatINR(h.gavPaisa)}</td>
                          <td className="px-2 py-2 text-right">
                            {formatINR(h.municipalTaxesPaisa)}
                          </td>
                          <td className="px-2 py-2 text-right">{formatINR(h.navPaisa)}</td>
                          <td className="px-2 py-2 text-right">
                            {formatINR(h.stdMaintenancePaisa)}
                          </td>
                          <td className="px-2 py-2 text-right">{formatINR(h.interestPaisa)}</td>
                          <td className="px-2 py-2 text-right font-bold">
                            {formatINR(h.netIncomePaisa)}
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-[var(--dxp-surface)] font-bold">
                        <td className="px-2 py-2" colSpan={6}>
                          Total HP income
                        </td>
                        <td className="px-2 py-2 text-right">
                          {formatINR(data.summary.housePropertyIncomePaisa)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Schedule CG */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-[var(--dxp-text-muted)]" />
                <h3 className="text-base font-bold text-[var(--dxp-text)]">
                  Schedule CG — Capital Gains
                </h3>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                <Field
                  label="STCG equity (sec 111A) gains"
                  value={formatINR(data.summary.capitalGains.buckets.stcgEquityGainsPaisa)}
                />
                <Field
                  label="@ 15% tax"
                  value={formatINR(data.summary.capitalGains.stcgEquityTaxPaisa)}
                />
                <Field
                  label="STCG other (adds to slab)"
                  value={formatINR(data.summary.capitalGains.buckets.stcgOtherGainsPaisa)}
                />
                <Field
                  label="↑ folded into slab income"
                  value={formatINR(data.summary.capitalGains.stcgOtherAddsToSlabPaisa)}
                />
                <Field
                  label="LTCG equity (sec 112A) gains"
                  value={formatINR(data.summary.capitalGains.buckets.ltcgEquityGainsPaisa)}
                />
                <Field
                  label="@ 10% over ₹1L"
                  value={formatINR(data.summary.capitalGains.ltcgEquityTaxPaisa)}
                />
                <Field
                  label="LTCG other gains"
                  value={formatINR(data.summary.capitalGains.buckets.ltcgOtherGainsPaisa)}
                />
                <Field
                  label="LTCG general (sec 112)"
                  value={formatINR(data.summary.capitalGains.ltcgOtherTaxPaisa)}
                />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 border-t border-[var(--dxp-border-light)] pt-3 text-sm md:grid-cols-3">
                <Field
                  label="Capital-gains tax"
                  value={formatINR(data.summary.capitalGains.totalCapitalGainsTaxPaisa)}
                />
                <Field
                  label="Cess (4%)"
                  value={formatINR(data.summary.capitalGains.cessPaisa)}
                />
                <Field
                  label="Total CG component"
                  value={formatINR(data.summary.capitalGainsComponentPaisa)}
                  highlight
                />
              </div>
              <p className="mt-2 text-xs text-[var(--dxp-text-muted)]">
                {data.blocks.capitalGainsRows.length} row(s) from /tax/ltcg-stcg feed this block.
              </p>
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
                  label="Slab gross"
                  value={formatINR(data.summary.slabGrossIncomePaisa)}
                />
                <Field
                  label="Taxable income"
                  value={formatINR(data.summary.taxableIncomePaisa)}
                />
                <Field label="Slab tax" value={formatINR(data.summary.slabTaxPaisa)} />
                <Field label="87A rebate" value={formatINR(data.summary.rebatePaisa)} />
                <Field
                  label="Slab cess (4%)"
                  value={formatINR(data.summary.slabCessPaisa)}
                />
                <Field
                  label="Slab component"
                  value={formatINR(data.summary.slabComponentPaisa)}
                />
                <Field
                  label="CG component"
                  value={formatINR(data.summary.capitalGainsComponentPaisa)}
                />
                <Field
                  label="Total tax"
                  value={formatINR(data.summary.totalTaxPaisa)}
                  highlight
                />
              </div>
            </CardContent>
          </Card>

          <p className="text-xs text-[var(--dxp-text-muted)]">
            Capital-gains brackets switch on the <strong>23-Jul-2024 cutoff</strong> (Finance
            Act 2024). Sales before that date use the pre-reform regime
            (STCG 111A 15%, LTCG 112A 10% over ₹1L, LTCG general 20% indexed via CII table).
            Sales on/after use the post-reform regime (STCG 111A 20%, LTCG 112A 12.5% over
            ₹1.25L, LTCG general 12.5% flat with no indexation). Pre-Jul-2024 election toggle on
            individual rows is deferred — currently auto-applied based on saleDate. Schedule FA
            (foreign assets) not yet captured. 87A rebate is not applied to capital-gains tax.
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
