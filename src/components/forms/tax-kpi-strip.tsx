'use client';

/**
 * Tax KPI strip — Sprint 5.2 commit 1.
 *
 * Four high-impact numbers at the top of /tax:
 *   1. Total tax liability (recommended regime)
 *   2. TDS already deducted (tds_credits + salary_income.tdsPaisa)
 *   3. Advance tax paid (sum of advance_tax_installments.paidAmountPaisa)
 *   4. Balance to pay (totalLiability − TDS − advancePaid) — renders as
 *      "Refund expected" with success styling if negative.
 *
 * Auto-refreshes when FY changes.
 */

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@dxp/ui';
import { Loader2, IndianRupee, Receipt, Coins, Wallet } from 'lucide-react';

interface RegimeCompareResp {
  comparison: {
    old: { totalTaxPaisa: number };
    new: { totalTaxPaisa: number };
    recommendation: 'OLD' | 'NEW';
  };
}

interface AdvanceTaxResp {
  installments: Array<{ paidAmountPaisa: number }>;
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

export function TaxKpiStrip({ fy }: Props) {
  const [loading, setLoading] = useState(true);
  const [totalTaxPaisa, setTotalTaxPaisa] = useState<number>(0);
  const [recommendation, setRecommendation] = useState<'OLD' | 'NEW' | null>(null);
  const [tdsPaisa, setTdsPaisa] = useState<number>(0);
  const [advancePaisa, setAdvancePaisa] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    Promise.all([
      fetch(`/api/tax/regime-compare?fy=${fy}`).then(async (r) =>
        r.ok ? ((await r.json()) as RegimeCompareResp) : null,
      ),
      fetch(`/api/tax/advance-tax?fy=${fy}`).then(async (r) =>
        r.ok ? ((await r.json()) as AdvanceTaxResp) : null,
      ),
      // TDS sources: tds_credits + salary_income.tdsPaisa. The ITR-1
      // summary endpoint already aggregates salary TDS so we read it
      // there to avoid a second round-trip; tds_credits comes from the
      // ITR-3 TDS list.
      fetch(`/api/tax/itr1/summary?fy=${fy}`).then(async (r) =>
        r.ok ? await r.json() : null,
      ),
      fetch(`/api/tax/itr3/tds?fy=${fy}`).then(async (r) =>
        r.ok ? await r.json() : null,
      ),
    ])
      .then(([regime, adv, itr1, tds]) => {
        if (cancelled) return;
        if (regime) {
          const rec = regime.comparison.recommendation;
          setRecommendation(rec);
          setTotalTaxPaisa(
            rec === 'NEW'
              ? regime.comparison.new.totalTaxPaisa
              : regime.comparison.old.totalTaxPaisa,
          );
        }
        const advTotal =
          adv?.installments?.reduce(
            (s, i) => s + (i.paidAmountPaisa ?? 0),
            0,
          ) ?? 0;
        setAdvancePaisa(advTotal);

        const salaryTds: number = itr1?.blocks?.salary?.tdsPaisa ?? 0;
        const nonSalaryTds: number =
          tds?.entries?.reduce(
            (s: number, r: { tdsPaisa: number }) => s + (r.tdsPaisa ?? 0),
            0,
          ) ?? 0;
        setTdsPaisa(salaryTds + nonSalaryTds);
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
            <Loader2 className="h-4 w-4 animate-spin" /> Loading tax KPIs…
          </div>
        </CardContent>
      </Card>
    );
  }

  const balance = totalTaxPaisa - tdsPaisa - advancePaisa;
  const isRefund = balance < 0;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <KpiTile
        icon={<IndianRupee className="h-4 w-4" />}
        label="Total tax liability"
        value={formatINR(totalTaxPaisa)}
        subtitle={recommendation ? `${recommendation} regime` : 'estimated'}
      />
      <KpiTile
        icon={<Receipt className="h-4 w-4" />}
        label="TDS already deducted"
        value={formatINR(tdsPaisa)}
        subtitle="credited so far"
      />
      <KpiTile
        icon={<Coins className="h-4 w-4" />}
        label="Advance tax paid"
        value={formatINR(advancePaisa)}
        subtitle="across 4 installments"
      />
      <KpiTile
        icon={<Wallet className="h-4 w-4" />}
        label={isRefund ? 'Refund expected' : 'Balance to pay'}
        value={formatINR(Math.abs(balance))}
        subtitle={isRefund ? 'overpaid' : 'before filing'}
        tone={isRefund ? 'success' : balance > 0 ? 'warn' : 'neutral'}
      />
    </div>
  );
}

function KpiTile({
  icon,
  label,
  value,
  subtitle,
  tone = 'neutral',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtitle: string;
  tone?: 'neutral' | 'success' | 'warn';
}) {
  const toneClass =
    tone === 'success'
      ? 'border-emerald-300 bg-emerald-50/60'
      : tone === 'warn'
      ? 'border-amber-300 bg-amber-50/40'
      : 'border-[var(--dxp-border)]';
  const valueClass =
    tone === 'success'
      ? 'text-emerald-900'
      : tone === 'warn'
      ? 'text-amber-900'
      : 'text-[var(--dxp-text)]';
  return (
    <div className={`rounded-md border p-3 ${toneClass}`}>
      <div className="mb-1 flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
        {icon}
        <span>{label}</span>
      </div>
      <p className={`text-xl font-bold tabular-nums ${valueClass}`}>{value}</p>
      <p className="text-[10px] text-[var(--dxp-text-muted)]">{subtitle}</p>
    </div>
  );
}
