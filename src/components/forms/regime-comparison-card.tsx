'use client';

/**
 * Regime comparison card.
 *
 * Side-by-side OLD vs NEW tax computation for the selected FY, reading
 * /api/tax/regime-compare. Each column "shows the math" like a tax notice:
 *   gross slab income → HRA/24(b)/80EEA (OLD) → Chapter VI-A (expandable
 *   to the per-section breakdown) → taxable income → per-band slab ladder
 *   → rebate/surcharge/cess → capital-gains tax add-on → total.
 *
 * The page-level FY selector controls which year to compare; the card
 * refetches on FY change (and on the parent's refreshTick via remount key).
 */

import { useEffect, useState } from 'react';
import { Card, CardHeader, CardContent, Badge, Button } from '@dxp/ui';
import { Scale, ArrowRight, Loader2, Info, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';

interface SlabBand {
  lowerPaisa: number;
  upperPaisa: number | null;
  ratePct: number;
  taxPaisa: number;
}

interface ComputeResult {
  taxablePaisa: number;
  taxBeforeRebatePaisa: number;
  rebatePaisa: number;
  taxAfterRebatePaisa: number;
  surchargePaisa?: number;
  marginalReliefPaisa?: number;
  effectiveSurchargePaisa?: number;
  cessPaisa: number;
  totalTaxPaisa: number;
  effectiveRatePct: number;
  bands?: SlabBand[];
  // Capital-gains add-on (flat-rate, same in both regimes)
  capitalGainsTaxPaisa?: number;
  capitalGainsCessPaisa?: number;
  capitalGainsTotalPaisa?: number;
}

interface DeductionBreakdownRow {
  label: string;
  amountPaisa: number;
}

interface RegimeCompareResponse {
  fy: string;
  income: {
    salary: number;
    hraExemption?: number;
    other: number;
    business: number;
    rentalGross?: number;
    sec24b?: number;
    sec80eea?: number;
    gross: number;
    grossNew?: number;
    capitalGainsTaxable: number;
  };
  deductions: {
    oldRegime: number;
    newRegime: number;
    breakdown?: DeductionBreakdownRow[];
  };
  comparison: {
    old: ComputeResult;
    new: ComputeResult;
    recommendation: 'NEW' | 'OLD';
    savingsPaisa: number;
  };
}

function formatINR(paisa: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);
}

/** Compact rupee bound for band labels: ₹4L, ₹1.25Cr, ₹50,000. */
function formatBound(paisa: number | null): string {
  if (paisa === null) return '+';
  const rs = paisa / 100;
  if (rs >= 1_00_00_000) return `₹${(rs / 1_00_00_000).toLocaleString('en-IN', { maximumFractionDigits: 2 })}Cr`;
  if (rs >= 1_00_000) return `₹${(rs / 1_00_000).toLocaleString('en-IN', { maximumFractionDigits: 2 })}L`;
  return `₹${rs.toLocaleString('en-IN')}`;
}

export function RegimeComparisonCard({ fy }: { fy: string }) {
  const [data, setData] = useState<RegimeCompareResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingPreference, setSavingPreference] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/tax/regime-compare?fy=${fy}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((d: RegimeCompareResponse) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : 'Failed to load regime comparison');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fy]);

  const setRegimeDefault = async (regime: 'NEW' | 'OLD') => {
    setSavingPreference(true);
    try {
      const r = await fetch('/api/user-preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taxRegimeDefault: regime }),
      });
      if (!r.ok) throw new Error('Failed to save');
      toast.success(`Default regime set to ${regime}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSavingPreference(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent>
          <div className="flex items-center gap-2 py-4 text-[var(--dxp-text-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" /> Comparing regimes for FY {fy}…
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return null;
  }

  const recommended = data.comparison.recommendation;
  const other: 'NEW' | 'OLD' = recommended === 'NEW' ? 'OLD' : 'NEW';
  const cgTaxablePaisa = data.income.capitalGainsTaxable;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
              <Scale className="h-5 w-5 text-[var(--dxp-brand)]" />
              Tax regime comparison — FY {data.fy}
            </h3>
            <p className="text-xs text-[var(--dxp-text-secondary)]">
              Gross slab-able income: <strong>{formatINR(data.income.gross)}</strong>
              {cgTaxablePaisa > 0 && (
                <> · Capital gains (taxed separately): <strong>{formatINR(cgTaxablePaisa)}</strong></>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-1 text-[10px]">
            {data.income.salary > 0 && (
              <Badge variant="default">Salary {formatINR(data.income.salary)}</Badge>
            )}
            {data.income.business > 0 && (
              <Badge variant="default">Business/GST {formatINR(data.income.business)}</Badge>
            )}
            {data.income.other > 0 && (
              <Badge variant="default">Other {formatINR(data.income.other)}</Badge>
            )}
            {(data.income.rentalGross ?? 0) > 0 && (
              <Badge variant="default">Rental {formatINR(data.income.rentalGross ?? 0)}</Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4 rounded-md border border-emerald-300 bg-emerald-50/60 p-3">
          <div className="flex items-start gap-2">
            <ArrowRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-700" />
            <div>
              <p className="text-sm font-semibold text-emerald-900">
                Filing under <strong>{recommended}</strong> saves{' '}
                <strong>{formatINR(data.comparison.savingsPaisa)}</strong> vs {other}.
              </p>
              <p className="mt-0.5 text-xs text-emerald-800">
                {recommended === 'NEW'
                  ? 'NEW is the govt default — simpler slabs, no Section 80 tracking needed.'
                  : 'OLD wins because your Section 80 deductions out-cut the lower NEW slabs.'}
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <RegimeColumn
            regime="NEW"
            isRecommended={recommended === 'NEW'}
            result={data.comparison.new}
            grossSlabPaisa={data.income.grossNew ?? data.income.gross}
            deductionsPaisa={data.deductions.newRegime}
            deductionBreakdown={recommended === 'NEW' ? [] : []}
            hraExemptionPaisa={0}
            sec24bPaisa={0}
            sec80eeaPaisa={0}
            onSetDefault={() => setRegimeDefault('NEW')}
            savingPreference={savingPreference}
          />
          <RegimeColumn
            regime="OLD"
            isRecommended={recommended === 'OLD'}
            result={data.comparison.old}
            grossSlabPaisa={data.income.gross}
            deductionsPaisa={data.deductions.oldRegime}
            deductionBreakdown={data.deductions.breakdown ?? []}
            hraExemptionPaisa={data.income.hraExemption ?? 0}
            sec24bPaisa={data.income.sec24b ?? 0}
            sec80eeaPaisa={data.income.sec80eea ?? 0}
            onSetDefault={() => setRegimeDefault('OLD')}
            savingPreference={savingPreference}
          />
        </div>

        <p className="mt-3 text-[10px] text-[var(--dxp-text-muted)]">
          <Info className="mr-1 inline h-3 w-3" />
          Handles standard deduction, slabs, 87A rebate, 4% cess, surcharge (income &gt;₹50L),
          and capital-gains tax at flat rates. Calculation is an estimate — actual liability
          depends on your final ITR.
        </p>
      </CardContent>
    </Card>
  );
}

function RegimeColumn({
  regime,
  isRecommended,
  result,
  grossSlabPaisa,
  deductionsPaisa,
  deductionBreakdown,
  hraExemptionPaisa,
  sec24bPaisa,
  sec80eeaPaisa,
  onSetDefault,
  savingPreference,
}: {
  regime: 'NEW' | 'OLD';
  isRecommended: boolean;
  result: ComputeResult;
  grossSlabPaisa: number;
  deductionsPaisa: number;
  deductionBreakdown: DeductionBreakdownRow[];
  hraExemptionPaisa: number;
  sec24bPaisa: number;
  sec80eeaPaisa: number;
  onSetDefault: () => void;
  savingPreference: boolean;
}) {
  const [showDeductions, setShowDeductions] = useState(false);
  const cgTotalPaisa = result.capitalGainsTotalPaisa ?? 0;
  const cgTaxPaisa = result.capitalGainsTaxPaisa ?? 0;
  const cgCessPaisa = result.capitalGainsCessPaisa ?? 0;

  return (
    <div
      className={`rounded-md border p-3 ${
        isRecommended ? 'border-emerald-400 bg-emerald-50/30' : 'border-[var(--dxp-border)]'
      }`}
    >
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h4 className="font-bold text-[var(--dxp-text)]">{regime} regime</h4>
          {isRecommended && <Badge variant="success">Recommended</Badge>}
        </div>
        <Button variant="secondary" size="sm" onClick={onSetDefault} disabled={savingPreference}>
          Set as default
        </Button>
      </div>
      <p className="mb-2 text-[11px] text-[var(--dxp-text-muted)]">
        {regime === 'OLD'
          ? 'Allows full Chapter VI-A + HRA + Sec 24(b) + 80EEA.'
          : 'Higher std deduction (₹75k), simpler rebates; very few Sec-80 allowed.'}
      </p>

      <p className="text-2xl font-bold tabular-nums text-[var(--dxp-text)]">
        {formatINR(result.totalTaxPaisa)}
      </p>
      <p className="text-xs text-[var(--dxp-text-muted)]">
        Effective rate {result.effectiveRatePct.toFixed(2)}% on gross income
      </p>

      <dl className="mt-3 space-y-1 text-xs">
        <Row label="Gross slab income" value={formatINR(grossSlabPaisa)} />
        {regime === 'OLD' && (
          <>
            <Row
              label="HRA exemption (sec 10(13A))"
              value={hraExemptionPaisa > 0 ? `− ${formatINR(hraExemptionPaisa)}` : '₹0'}
              muted={hraExemptionPaisa === 0}
              valueClassName={hraExemptionPaisa > 0 ? 'text-emerald-700' : undefined}
            />
            {sec24bPaisa > 0 && (
              <Row
                label="Sec 24(b) home loan interest"
                value={`− ${formatINR(sec24bPaisa)}`}
                valueClassName="text-emerald-700"
              />
            )}
            {sec80eeaPaisa > 0 && (
              <Row
                label="Sec 80EEA additional interest"
                value={`− ${formatINR(sec80eeaPaisa)}`}
                valueClassName="text-emerald-700"
              />
            )}
          </>
        )}

        {/* Chapter VI-A — expandable to the per-section breakdown */}
        {deductionBreakdown.length > 0 ? (
          <div>
            <button
              type="button"
              onClick={() => setShowDeductions((s) => !s)}
              className="flex w-full items-baseline justify-between text-[var(--dxp-text-secondary)] hover:text-[var(--dxp-text)]"
            >
              <dt className="flex items-center gap-1">
                {showDeductions ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                Chapter VI-A deductions
              </dt>
              <dd className="font-mono tabular-nums">
                {deductionsPaisa > 0 ? `− ${formatINR(deductionsPaisa)}` : '₹0'}
              </dd>
            </button>
            {showDeductions && (
              <div className="ml-4 mt-1 space-y-0.5 border-l border-[var(--dxp-border-light)] pl-2">
                {deductionBreakdown.map((b, i) => (
                  <div
                    key={i}
                    className="flex items-baseline justify-between text-[10px] text-[var(--dxp-text-muted)]"
                  >
                    <span>{b.label}</span>
                    <span className="font-mono tabular-nums">{formatINR(b.amountPaisa)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <Row
            label="Chapter VI-A deductions"
            value={deductionsPaisa > 0 ? `− ${formatINR(deductionsPaisa)}` : '₹0'}
            muted={deductionsPaisa === 0}
            valueClassName={deductionsPaisa > 0 ? 'text-emerald-700' : undefined}
          />
        )}

        <Row label="Taxable income" value={formatINR(result.taxablePaisa)} bold />

        {/* Per-band slab ladder */}
        {(result.bands?.length ?? 0) > 0 && (
          <div className="my-1 rounded border border-[var(--dxp-border-light)] p-2">
            <div className="mb-1 flex items-baseline justify-between text-[9px] font-bold uppercase tracking-wider text-[var(--dxp-text-muted)]">
              <span>Band</span>
              <span className="flex gap-3">
                <span>Rate</span>
                <span>Tax</span>
              </span>
            </div>
            {result.bands!.map((b, i) => (
              <div
                key={i}
                className={`flex items-baseline justify-between text-[10px] ${
                  b.taxPaisa > 0
                    ? 'text-[var(--dxp-text-secondary)]'
                    : 'text-[var(--dxp-text-muted)]'
                }`}
              >
                <span className="font-mono">
                  {formatBound(b.lowerPaisa)} – {formatBound(b.upperPaisa)}
                </span>
                <span className="flex gap-3 font-mono tabular-nums">
                  <span>{b.ratePct}%</span>
                  <span className="w-16 text-right">
                    {b.taxPaisa > 0 ? formatINR(b.taxPaisa) : '—'}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}

        <Row label="Slab tax" value={formatINR(result.taxBeforeRebatePaisa)} />
        {result.rebatePaisa > 0 && (
          <Row
            label="Section 87A rebate"
            value={`− ${formatINR(result.rebatePaisa)}`}
            valueClassName="text-emerald-700"
          />
        )}
        <Row label="Tax after rebate" value={formatINR(result.taxAfterRebatePaisa)} />
        {(result.surchargePaisa ?? 0) > 0 && (
          <>
            <Row
              label="Surcharge (high-income bracket)"
              value={`+ ${formatINR(result.surchargePaisa ?? 0)}`}
            />
            {(result.marginalReliefPaisa ?? 0) > 0 && (
              <Row
                label="− Marginal relief"
                value={`− ${formatINR(result.marginalReliefPaisa ?? 0)}`}
                valueClassName="text-emerald-700"
              />
            )}
          </>
        )}
        <Row
          label="Health & Education Cess (4%)"
          value={`+ ${formatINR(result.cessPaisa)}`}
          muted={result.cessPaisa === 0}
        />

        {/* Capital-gains tax add-on — flat rate, same in both regimes */}
        {cgTotalPaisa > 0 && (
          <div className="my-1 rounded border border-[var(--dxp-border-light)] bg-[var(--dxp-surface-subtle,transparent)] p-2">
            <div className="flex items-baseline justify-between">
              <dt className="font-semibold text-[var(--dxp-text-secondary)]">Capital gains tax</dt>
              <dd className="font-mono font-bold tabular-nums text-[var(--dxp-text)]">
                + {formatINR(cgTotalPaisa)}
              </dd>
            </div>
            <p className="mt-0.5 text-[10px] text-[var(--dxp-text-muted)]">
              Separate flat rates per asset (LTCG / STCG) — same in both regimes.{' '}
              {formatINR(cgTaxPaisa)} tax + {formatINR(cgCessPaisa)} cess.{' '}
              <a href="/tax/ltcg-stcg" className="underline">
                Source: /tax/ltcg-stcg
              </a>
            </p>
          </div>
        )}

        <div className="my-1 border-t border-[var(--dxp-border)]" />
        <Row label="Total tax owed" value={formatINR(result.totalTaxPaisa)} bold />
      </dl>
    </div>
  );
}

function Row({
  label,
  value,
  bold,
  muted,
  valueClassName,
}: {
  label: string;
  value: string;
  bold?: boolean;
  muted?: boolean;
  valueClassName?: string;
}) {
  return (
    <div
      className={`flex items-baseline justify-between ${
        muted ? 'text-[var(--dxp-text-muted)]' : 'text-[var(--dxp-text-secondary)]'
      }`}
    >
      <dt>{label}</dt>
      <dd
        className={`font-mono tabular-nums ${bold ? 'font-bold text-[var(--dxp-text)]' : ''} ${
          valueClassName ?? ''
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
