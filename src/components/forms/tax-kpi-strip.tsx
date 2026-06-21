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

interface TaxPaidResp {
  tds: { salaryTdsPaisa: number; otherTdsPaisa: number } | null;
  totalPaisa: number;
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
  // Advance-tax installments + self-assessment payments (everything paid that
  // is NOT TDS). Kept as one number so the balance can't double-count.
  const [otherPaidPaisa, setOtherPaidPaisa] = useState<number>(0);

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
      // Canonical tax-paid (Form 16 → 26AS → books precedence, 26AS-guarded so
      // non-salary TDS isn't double-counted on top of a 26AS total). Same source
      // as the "Tax Paid So Far" card → the page is internally consistent.
      fetch(`/api/tax/tax-paid?fy=${fy}`).then(async (r) =>
        r.ok ? ((await r.json()) as TaxPaidResp) : null,
      ),
    ])
      .then(([regime, adv, taxPaid]) => {
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
        // Canonical TDS — no double-count.
        const canonicalTds =
          (taxPaid?.tds?.salaryTdsPaisa ?? 0) + (taxPaid?.tds?.otherTdsPaisa ?? 0);
        setTdsPaisa(canonicalTds);
        // Self-assessment / manual payments already inside the tax-paid total.
        const selfPaid = Math.max(0, (taxPaid?.totalPaisa ?? 0) - canonicalTds);
        // Structured advance-tax installments (a separate tracker).
        const advInstallments =
          adv?.installments?.reduce((s, i) => s + (i.paidAmountPaisa ?? 0), 0) ?? 0;
        setOtherPaidPaisa(selfPaid + advInstallments);
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

  const balance = totalTaxPaisa - tdsPaisa - otherPaidPaisa;
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
        label="Advance / self-assessment"
        value={formatINR(otherPaidPaisa)}
        subtitle="advance + self-assessment paid"
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
