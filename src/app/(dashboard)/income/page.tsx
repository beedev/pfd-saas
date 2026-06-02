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

import { useEffect, useState, useCallback } from 'react';
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
import { Card, CardContent, CardHeader, StatsDisplay, Badge, Select } from '@dxp/ui';
import { getCurrentFinancialYear } from '@/lib/finance/tax-constants';

/** ±2 years around current FY — same window as the /tax page so the
 *  two pages stay navigable in lockstep. */
function generateFyOptions(): Array<{ value: string; label: string }> {
  const current = getCurrentFinancialYear();
  const startYear = Number(current.split('-')[0]);
  const out: Array<{ value: string; label: string }> = [];
  for (let i = -2; i <= 2; i++) {
    const s = startYear + i;
    const e = String((s + 1) % 100).padStart(2, '0');
    out.push({ value: `${s}-${e}`, label: `FY ${s}-${e}` });
  }
  return out;
}

interface IncomeSummary {
  currentFy: string;
  stream: {
    salary: { count: number; totalPaisa: number };
    freelance: { count: number; totalPaisa: number };
    otherTaxable: { count: number; totalPaisa: number };
    otherExempt: { count: number; totalPaisa: number };
    rental: { count: number; totalPaisa: number; source?: 'history' | 'current_rate' };
    capitalGains: { ltcgPaisa: number; stcgPaisa: number; totalPaisa: number };
  };
  totalsPaisa: { all: number; taxable: number; exempt: number };
  trend: Array<{
    fy: string;
    salaryPaisa: number;
    freelancePaisa: number;
    otherPaisa: number;
    /** null = no rental_history row for this FY — render as "—". */
    rentalPaisa: number | null;
    cgPaisa: number;
    totalPaisa: number;
  }>;
}

function formatINR(paisa: number): string {
  if (!paisa) return '—';
  const rupees = Math.round(paisa / 100);
  return `₹${rupees.toLocaleString('en-IN')}`;
}

/** Trend-cell formatter — distinguishes "no history row (null)" from
 *  "history says ₹0" by rendering only the explicit null as the em-dash. */
function formatINRNullable(paisa: number | null): string {
  if (paisa === null) return '—';
  if (paisa === 0) return '₹0';
  return `₹${Math.round(paisa / 100).toLocaleString('en-IN')}`;
}

export default function IncomePage() {
  const [data, setData] = useState<IncomeSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  // FY state lives on the page so the selector is local — no URL sync
  // since the page is a roll-up not a deep-link target. The selector
  // defaults to the server's current FY on first load, then the user
  // drives it from there.
  const [fy, setFy] = useState<string>(getCurrentFinancialYear());
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/income/summary?fy=${encodeURIComponent(fy)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setData(j);
    } catch {
      setError('Could not load income summary');
    } finally {
      setIsLoading(false);
    }
  }, [fy]);

  useEffect(() => {
    load();
  }, [load]);

  const fyOptions = generateFyOptions();

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }
  if (isLoading || !data) {
    return <p className="text-sm text-[var(--dxp-text-muted)]">Loading income summary…</p>;
  }

  const { stream, totalsPaisa, trend } = data;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--dxp-text)]">Income</h1>
          <p className="text-sm text-[var(--dxp-text-secondary)] mt-1">
            Roll-up across salary, other sources, rental, and capital gains for FY {fy}.
            Click any row to edit at the source.
          </p>
        </div>
        <div className="w-40">
          {/* FY selector — mirrors the /tax page pattern so users can
              walk historical FYs without two different mental models. */}
          <Select options={fyOptions} value={fy} onChange={(v) => setFy(v)} />
        </div>
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
              note={
                stream.rental.source === 'history'
                  ? 'From rental_history for this FY'
                  : 'monthly_rent × 12 fallback — add a rental_history row to track this FY explicitly'
              }
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
                  <th className="px-3 py-2 text-right">Rental</th>
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
                    <td className="px-3 py-2 text-right font-mono">{formatINRNullable(row.rentalPaisa)}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatINR(row.cgPaisa)}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">{formatINR(row.totalPaisa)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-[var(--dxp-text-muted)] mt-3">
            Rental shown from your rental_history entries. The current FY falls back to
            current monthly_rent × 12 if no history row exists yet — add a row per FY on
            each property&rsquo;s detail page to track changes over time. Capital gains use
            sale-date FY.
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
