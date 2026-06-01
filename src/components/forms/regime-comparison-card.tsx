'use client';

/**
 * Regime comparison card — Sprint 4 Phase 1b.
 *
 * Side-by-side view of OLD vs NEW tax-regime computation for the
 * selected FY. Reads from /api/tax/regime-compare and renders:
 *   • OLD column   — slab tax + rebate + cess + total + effective rate
 *   • NEW column   — same shape
 *   • Recommendation banner — which one to file under + savings delta
 *
 * The page-level FY selector controls which year to compare. When FY
 * changes, the card refetches.
 *
 * NOT yet handled in this card (deferred to Sprint 4.2+):
 *   • Surcharge brackets (>50L income)
 *   • LTCG/STCG separately taxed (surfaced as a side note)
 *   • Per-deduction regime-eligibility (NEW regime currently shows
 *     ₹0 deductions; OLD shows everything — Phase 2 refines this)
 */

import { useEffect, useState } from 'react';
import { Card, CardHeader, CardContent, Badge, Button } from '@dxp/ui';
import { Scale, ArrowRight, Loader2, Info } from 'lucide-react';
import { toast } from 'sonner';

interface ComputeResult {
  taxablePaisa: number;
  taxBeforeRebatePaisa: number;
  rebatePaisa: number;
  taxAfterRebatePaisa: number;
  cessPaisa: number;
  totalTaxPaisa: number;
  effectiveRatePct: number;
}

interface RegimeCompareResponse {
  fy: string;
  income: {
    salary: number;
    other: number;
    business: number;
    rental: number;
    gross: number;
    capitalGainsTaxable: number;
  };
  deductions: { oldRegime: number; newRegime: number };
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
              {data.income.capitalGainsTaxable > 0 && (
                <> · Capital gains (taxed separately): <strong>{formatINR(data.income.capitalGainsTaxable)}</strong></>
              )}
            </p>
          </div>
          {/* Income breakdown chips */}
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
            {data.income.rental > 0 && (
              <Badge variant="default">Rental {formatINR(data.income.rental)}</Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Side-by-side regime columns */}
        <div className="grid gap-4 md:grid-cols-2">
          <RegimeColumn
            regime="NEW"
            isRecommended={recommended === 'NEW'}
            result={data.comparison.new}
            deductionsPaisa={data.deductions.newRegime}
            onSetDefault={() => setRegimeDefault('NEW')}
            savingPreference={savingPreference}
          />
          <RegimeColumn
            regime="OLD"
            isRecommended={recommended === 'OLD'}
            result={data.comparison.old}
            deductionsPaisa={data.deductions.oldRegime}
            onSetDefault={() => setRegimeDefault('OLD')}
            savingPreference={savingPreference}
          />
        </div>

        {/* Recommendation banner */}
        <div className="mt-4 rounded-md border border-emerald-300 bg-emerald-50/60 p-3">
          <div className="flex items-start gap-2">
            <ArrowRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-700" />
            <div>
              <p className="text-sm font-semibold text-emerald-900">
                Filing under <strong>{recommended}</strong> saves you{' '}
                <strong>{formatINR(data.comparison.savingsPaisa)}</strong> vs {other}.
              </p>
              <p className="mt-1 text-xs text-emerald-800">
                {recommended === 'NEW' ? (
                  <>
                    NEW regime is the govt default starting FY 2024-25 and uses simpler slabs
                    with no deduction tracking. The Section 80 entries below DON&apos;T apply
                    under NEW — they only matter if you switch to OLD.
                  </>
                ) : (
                  <>
                    OLD regime wins thanks to your {formatINR(data.deductions.oldRegime)} of
                    Section 80 deductions. Keep tracking those entries; without them OLD would
                    cost more.
                  </>
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Honesty footnote — what the engine doesn't yet do */}
        <p className="mt-3 text-[10px] text-[var(--dxp-text-muted)]">
          <Info className="mr-1 inline h-3 w-3" />
          Engine handles standard deduction, slabs, 87A rebate, 4% cess. Does NOT yet handle:
          surcharge (income &gt;₹50L), LTCG/STCG separately taxed, per-deduction regime
          eligibility. Calculation is an estimate — actual liability depends on ITR final.
        </p>
      </CardContent>
    </Card>
  );
}

function RegimeColumn({
  regime,
  isRecommended,
  result,
  deductionsPaisa,
  onSetDefault,
  savingPreference,
}: {
  regime: 'NEW' | 'OLD';
  isRecommended: boolean;
  result: ComputeResult;
  deductionsPaisa: number;
  onSetDefault: () => void;
  savingPreference: boolean;
}) {
  return (
    <div
      className={`rounded-md border p-3 ${
        isRecommended
          ? 'border-emerald-400 bg-emerald-50/30'
          : 'border-[var(--dxp-border)]'
      }`}
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h4 className="font-bold text-[var(--dxp-text)]">{regime} regime</h4>
          {isRecommended && <Badge variant="success">Recommended</Badge>}
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={onSetDefault}
          disabled={savingPreference}
        >
          Set as default
        </Button>
      </div>

      {/* Headline tax number */}
      <p className="text-2xl font-bold tabular-nums text-[var(--dxp-text)]">
        {formatINR(result.totalTaxPaisa)}
      </p>
      <p className="text-xs text-[var(--dxp-text-muted)]">
        Effective rate {result.effectiveRatePct.toFixed(2)}% on gross income
      </p>

      {/* Computation breakdown */}
      <dl className="mt-3 space-y-1 text-xs">
        <Row label="Deductions used" value={formatINR(deductionsPaisa)} muted={deductionsPaisa === 0} />
        <Row label="Taxable income" value={formatINR(result.taxablePaisa)} />
        <Row label="Slab tax" value={formatINR(result.taxBeforeRebatePaisa)} />
        {result.rebatePaisa > 0 && (
          <Row
            label="Section 87A rebate"
            value={`− ${formatINR(result.rebatePaisa)}`}
            valueClassName="text-emerald-700"
          />
        )}
        <Row
          label="Tax after rebate"
          value={formatINR(result.taxAfterRebatePaisa)}
        />
        <Row
          label="Health & Education Cess (4%)"
          value={`+ ${formatINR(result.cessPaisa)}`}
          muted={result.cessPaisa === 0}
        />
        <div className="my-1 border-t border-[var(--dxp-border)]" />
        <Row
          label="Total tax owed"
          value={formatINR(result.totalTaxPaisa)}
          bold
        />
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
    <div className={`flex items-baseline justify-between ${muted ? 'text-[var(--dxp-text-muted)]' : 'text-[var(--dxp-text-secondary)]'}`}>
      <dt>{label}</dt>
      <dd className={`font-mono tabular-nums ${bold ? 'font-bold text-[var(--dxp-text)]' : ''} ${valueClassName ?? ''}`}>
        {value}
      </dd>
    </div>
  );
}
