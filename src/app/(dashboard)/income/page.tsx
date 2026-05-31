'use client';

/**
 * /income — unified income summary.
 *
 * Read-only roll-up across the user's salary, other-sources income,
 * capital gains, and rental properties. Data lives in existing modules
 * (Tax → Salary / Other / LTCG, Investments → Real Estate). Each
 * stream row links back to its source page for editing.
 *
 * Fetches a single aggregated payload from /api/income/summary so the
 * client never assembles the totals — that's the API's job.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Banknote,
  Briefcase,
  Building2,
  ExternalLink,
  FileText,
  PiggyBank,
  TrendingUp,
} from 'lucide-react';
import { Card, CardContent, CardHeader, StatsDisplay, Badge } from '@dxp/ui';

interface IncomeSummary {
  currentFy: string;
  stream: {
    salary: { count: number; totalPaisa: number };
    freelance: { count: number; totalPaisa: number };
    otherTaxable: { count: number; totalPaisa: number };
    otherExempt: { count: number; totalPaisa: number };
    rental: { count: number; totalPaisa: number };
    capitalGains: { ltcgPaisa: number; stcgPaisa: number; totalPaisa: number };
  };
  totalsPaisa: { all: number; taxable: number; exempt: number };
  trend: Array<{ fy: string; salaryPaisa: number; freelancePaisa: number; otherPaisa: number; cgPaisa: number; totalPaisa: number }>;
}

function formatINR(paisa: number): string {
  if (!paisa) return '—';
  const rupees = Math.round(paisa / 100);
  return `₹${rupees.toLocaleString('en-IN')}`;
}

export default function IncomePage() {
  const [data, setData] = useState<IncomeSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/income/summary')
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then(setData)
      .catch(() => setError('Could not load income summary'));
  }, []);

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }
  if (!data) {
    return <p className="text-sm text-[var(--dxp-text-muted)]">Loading income summary…</p>;
  }

  const { currentFy: fy, stream, totalsPaisa, trend } = data;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-[var(--dxp-text)]">Income</h1>
        <p className="text-sm text-[var(--dxp-text-secondary)] mt-1">
          Roll-up across salary, other sources, rental, and capital gains for FY {fy}.
          Click any row to edit at the source.
        </p>
      </header>

      <StatsDisplay
        columns={4}
        currency="INR"
        locale="en-IN"
        stats={[
          { label: `Total income (${fy})`, value: Math.round(totalsPaisa.all / 100), format: 'currency' },
          { label: 'Taxable', value: Math.round(totalsPaisa.taxable / 100), format: 'currency' },
          { label: 'Tax-exempt', value: Math.round(totalsPaisa.exempt / 100), format: 'currency' },
          { label: 'Capital gains', value: Math.round(stream.capitalGains.totalPaisa / 100), format: 'currency' },
        ]}
      />

      {/* ─── By stream ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-[var(--dxp-text)]">By stream — FY {fy}</h2>
        </CardHeader>
        <CardContent>
          <div className="divide-y divide-[var(--dxp-border-light)]">
            <StreamRow
              icon={Briefcase}
              title="Salary"
              detail={`${stream.salary.count} employer record(s)`}
              amount={stream.salary.totalPaisa}
              href="/tax/itr3/salary"
            />
            <StreamRow
              icon={FileText}
              title="Freelance / Business (GST)"
              detail={`${stream.freelance.count} finalised invoice(s)`}
              amount={stream.freelance.totalPaisa}
              href="/gst/invoices"
              note="Taxable amount (pre-GST). GST collected is not income."
            />
            <StreamRow
              icon={Building2}
              title="Rental"
              detail={`${stream.rental.count} property/properties tenanted`}
              amount={stream.rental.totalPaisa}
              href="/investments/real-estate"
              note="Monthly rent × 12 — set per property"
            />
            <StreamRow
              icon={PiggyBank}
              title="Other sources (taxable)"
              detail={`${stream.otherTaxable.count} item(s)`}
              amount={stream.otherTaxable.totalPaisa}
              href="/tax/itr3/other-income"
            />
            <StreamRow
              icon={Banknote}
              title="Other sources (tax-exempt)"
              detail={`${stream.otherExempt.count} item(s) — Sec 10 / agricultural / etc.`}
              amount={stream.otherExempt.totalPaisa}
              href="/tax/itr3/other-income"
              exempt
            />
            <StreamRow
              icon={TrendingUp}
              title="Capital gains"
              detail={`LTCG ${formatINR(stream.capitalGains.ltcgPaisa)} · STCG ${formatINR(stream.capitalGains.stcgPaisa)}`}
              amount={stream.capitalGains.totalPaisa}
              href="/tax/ltcg-stcg"
              note="Managed in /tax/ltcg-stcg"
            />
          </div>
        </CardContent>
      </Card>

      {/* ─── Year-over-year ──────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-[var(--dxp-text)]">Year-over-year</h2>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-[var(--dxp-border-light)] text-xs uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                <tr>
                  <th className="px-3 py-2 text-left">FY</th>
                  <th className="px-3 py-2 text-right">Salary</th>
                  <th className="px-3 py-2 text-right">Freelance</th>
                  <th className="px-3 py-2 text-right">Other sources</th>
                  <th className="px-3 py-2 text-right">Capital gains</th>
                  <th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--dxp-border-light)]">
                {trend.map((row) => (
                  <tr key={row.fy} className={row.fy === fy ? 'bg-amber-50/50' : ''}>
                    <td className="px-3 py-2 font-medium text-[var(--dxp-text)]">
                      {row.fy}
                      {row.fy === fy && <span className="ml-2 text-xs text-amber-700">current</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{formatINR(row.salaryPaisa)}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatINR(row.freelancePaisa)}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatINR(row.otherPaisa)}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatINR(row.cgPaisa)}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">{formatINR(row.totalPaisa)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-[var(--dxp-text-muted)] mt-3">
            Rental income excluded from YoY — it&rsquo;s computed from current monthly_rent
            (no history yet). Capital gains use sale-date FY.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function StreamRow({
  icon: Icon,
  title,
  detail,
  amount,
  href,
  note,
  exempt,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  detail: string;
  amount: number;
  href: string;
  note?: string;
  exempt?: boolean;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-4 py-3 hover:bg-[var(--dxp-border-light)] transition-colors -mx-4 px-4 group"
    >
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <Icon className="h-5 w-5 mt-0.5 text-[var(--dxp-text-secondary)] flex-shrink-0" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--dxp-text)]">{title}</span>
            {exempt && <Badge variant="default">exempt</Badge>}
          </div>
          <p className="text-xs text-[var(--dxp-text-secondary)] mt-0.5">{detail}</p>
          {note && <p className="text-[11px] text-[var(--dxp-text-muted)] mt-0.5 italic">{note}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-sm font-mono font-semibold text-[var(--dxp-text)]">
          {formatINR(amount)}
        </span>
        <ExternalLink className="h-3.5 w-3.5 text-[var(--dxp-text-muted)] group-hover:text-[var(--dxp-text-secondary)]" />
      </div>
    </Link>
  );
}
