'use client';
export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Download, FileText, Plus, AlertCircle, CheckCircle2, Briefcase, Banknote, Receipt, Wallet, Calculator } from 'lucide-react';
import { toast } from 'sonner';
import { ItrResultBanner } from '@/components/forms/itr-result-banner';
import {
  ItrEligibilityBanner,
  type EligibilityFlags,
  type ExcludedIncomeBlock,
  type ItrFormCode,
} from '@/components/forms/itr-eligibility-banner';

interface Summary {
  fy: string;
  schedules: {
    salary: { rowCount: number; totalGrossSalary: number; totalTaxableSalary: number; totalSalaryTds: number };
    businessProfession: {
      consultingTurnover: number;
      invoiceCount: number;
      source: string;
      presumptiveProfit44ADA: number;
      presumptivePct: number;
      limit44ADAPaisa: number;
      exceedsLimit44ADA: boolean;
      expectedTds194J: number;
      monthlyTdsExpected: Array<{ month: string; receipts: number; tds: number; invoiceCount: number }>;
    };
    capitalGains: { rowCount: number; ltcgEquity: number; ltcgOther: number; stcg: number };
    otherSources: { rowCount: number; total: number };
    deductions: { rowCount: number; total: number };
    tds: { salaryTds: number; nonSalaryTds: number; tds2Count: number; tds3Count: number };
    advanceTax: { rowCount: number; total: number };
  };
  eligibility?: { isEligible: boolean; flags: EligibilityFlags };
  excludedIncomeBlocks?: ExcludedIncomeBlock[];
  wizardSelectedForm?: ItrFormCode | null;
}

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(paisa / 100);

function currentFy(): string {
  const d = new Date();
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

const FY_OPTIONS = (() => {
  const cur = currentFy();
  const startYear = parseInt(cur.split('-')[0], 10);
  return [0, -1, -2].map((delta) => {
    const y = startYear + delta;
    return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
  });
})();

export default function Itr3HubPage() {
  const [fy, setFy] = useState<string>(currentFy());
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  // Sprint 5.2 — total tax + regime for the ITR result banner. ITR-3
  // summary doesn't compute a regime-aware total, so we lean on
  // regime-compare's recommendation.
  const [totalTaxPaisa, setTotalTaxPaisa] = useState<number>(0);
  const [regime, setRegime] = useState<'OLD' | 'NEW'>('NEW');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, rc] = await Promise.all([
        fetch(`/api/tax/itr3/summary?fy=${fy}`).then((x) => x.json()),
        fetch(`/api/tax/regime-compare?fy=${fy}`)
          .then((x) => (x.ok ? x.json() : null))
          .catch(() => null),
      ]);
      setSummary(r);
      if (rc?.comparison) {
        const rec = rc.comparison.recommendation as 'OLD' | 'NEW';
        setRegime(rec);
        setTotalTaxPaisa(
          rec === 'NEW'
            ? rc.comparison.new.totalTaxPaisa
            : rc.comparison.old.totalTaxPaisa,
        );
      }
    } catch (e) {
      console.error(e);
      toast.error('Failed to load summary');
    } finally {
      setLoading(false);
    }
  }, [fy]);

  useEffect(() => {
    load();
  }, [load]);

  const downloadCsv = (slug: string, filename: string) => {
    const url = `/api/tax/itr3/exports/${slug}?fy=${fy}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const s = summary?.schedules;

  return (
    <div className="max-w-6xl space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FileText className="h-6 w-6 text-blue-600" /> ITR-3 Filing
          </h1>
          <p className="text-sm text-gray-500">Capture all schedules, then export CSVs into the official ITR-3 utility.</p>
        </div>
        <select
          value={fy}
          onChange={(e) => setFy(e.target.value)}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium"
        >
          {FY_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>FY {opt}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="flex h-32 items-center justify-center text-gray-400">Loading…</div>
      ) : (
        <>
          {/* Sprint 5.4 — eligibility banner (ITR-3 is the catch-all,
              so this almost always collapses to a green eligible row). */}
          <ItrEligibilityBanner
            formCode="ITR-3"
            fy={fy}
            wizardSelectedForm={summary?.wizardSelectedForm ?? null}
            excludedIncomeBlocks={summary?.excludedIncomeBlocks ?? []}
            eligibilityFlags={summary?.eligibility?.flags ?? {}}
          />
          {/* Sprint 5.2 (E) — ITR result banner */}
          <ItrResultBanner
            fy={fy}
            form="ITR-3"
            regime={regime}
            totalTaxPaisa={totalTaxPaisa}
            salaryTdsPaisa={s?.salary.totalSalaryTds ?? 0}
          />
          {/* Schedule cards */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <ScheduleCard
              icon={Briefcase}
              title="Schedule S — Salary"
              status={s!.salary.rowCount > 0 ? 'done' : 'pending'}
              summary={
                s!.salary.rowCount > 0 ? (
                  <>
                    {s!.salary.rowCount} employer(s) · Gross {formatINR(s!.salary.totalGrossSalary)} · Taxable {formatINR(s!.salary.totalTaxableSalary)} · TDS {formatINR(s!.salary.totalSalaryTds)}
                  </>
                ) : (
                  <>No Form 16 entries yet</>
                )
              }
              actions={[
                { href: `/tax/itr3/salary?fy=${fy}`, label: 'Manage' },
                { href: `/tax/itr3/salary/new?fy=${fy}`, label: '+ Add', variant: 'primary' },
              ]}
            />

            <ScheduleCard
              icon={Banknote}
              title="Schedule BP — 44ADA (Presumptive Profession)"
              status={s!.businessProfession.invoiceCount > 0 ? 'auto' : 'manual'}
              summary={
                <>
                  <div className="space-y-1">
                    <div>
                      Gross receipts ({s!.businessProfession.invoiceCount} GST invoices, ex-GST):{' '}
                      <strong>{formatINR(s!.businessProfession.consultingTurnover)}</strong>
                    </div>
                    <div>
                      Presumptive profit @ {s!.businessProfession.presumptivePct}% (44ADA):{' '}
                      <strong className="text-emerald-700">
                        {formatINR(s!.businessProfession.presumptiveProfit44ADA)}
                      </strong>
                    </div>
                    <div className="text-[11px] text-gray-500">
                      Expected TDS @ 10% u/s 194J: {formatINR(s!.businessProfession.expectedTds194J)}
                      {' · '}Compare against TDS captured in TDS card.
                    </div>
                    {s!.businessProfession.exceedsLimit44ADA && (
                      <div className="rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                        ⚠ Gross receipts exceed ₹75L — above 44ADA ceiling. Must switch to regular
                        Schedule BP with books + audit.
                      </div>
                    )}
                    <div className="text-[11px] text-gray-500">
                      Enter the gross receipts and presumptive profit directly in Excel ITR-3
                      Schedule BP, sub-section 44ADA.
                    </div>
                  </div>
                </>
              }
              actions={[{ href: `/gst/invoices`, label: 'Open invoices' }]}
            />

            <ScheduleCard
              icon={Calculator}
              title="Schedule CG — Capital Gains"
              status={s!.capitalGains.rowCount > 0 ? 'done' : 'pending'}
              summary={
                <>
                  {s!.capitalGains.rowCount} entries · LTCG-Equity {formatINR(s!.capitalGains.ltcgEquity)} · LTCG-Other {formatINR(s!.capitalGains.ltcgOther)} · STCG {formatINR(s!.capitalGains.stcg)}
                </>
              }
              actions={[{ href: `/tax/ltcg-stcg`, label: 'Open LTCG/STCG' }]}
            />

            <ScheduleCard
              icon={Wallet}
              title="Schedule OS — Other Sources"
              status={s!.otherSources.rowCount > 0 ? 'done' : 'pending'}
              summary={
                <>
                  {s!.otherSources.rowCount} entries · Total {formatINR(s!.otherSources.total)}
                </>
              }
              actions={[
                { href: `/tax/itr3/other-income?fy=${fy}`, label: 'Manage' },
                { href: `/tax/itr3/other-income/new?fy=${fy}`, label: '+ Add', variant: 'primary' },
              ]}
            />

            <ScheduleCard
              icon={Receipt}
              title="Schedule VI-A — Section 80 Deductions"
              status={s!.deductions.rowCount > 0 ? 'done' : 'pending'}
              summary={
                <>
                  {s!.deductions.rowCount} entries · Total {formatINR(s!.deductions.total)}
                </>
              }
              actions={[{ href: `/tax`, label: 'Open Section 80' }]}
            />

            <ScheduleCard
              icon={Receipt}
              title="TDS — Non-salary"
              status={
                s!.tds.tds2Count + s!.tds.tds3Count > 0
                  ? 'done'
                  : s!.businessProfession.expectedTds194J > 0
                  ? 'auto'
                  : 'pending'
              }
              summary={
                <div className="space-y-1">
                  <div>
                    Expected (auto from invoices @ 10%):{' '}
                    <strong className="text-amber-700">
                      {formatINR(s!.businessProfession.expectedTds194J)}
                    </strong>
                  </div>
                  <div>
                    Captured (Form 16A entries):{' '}
                    <strong>{formatINR(s!.tds.nonSalaryTds)}</strong>
                    {' · '}TDS2: {s!.tds.tds2Count} · TDS3: {s!.tds.tds3Count}
                  </div>
                  {s!.businessProfession.expectedTds194J > s!.tds.nonSalaryTds && (
                    <div className="text-[11px] text-amber-700">
                      Gap of {formatINR(s!.businessProfession.expectedTds194J - s!.tds.nonSalaryTds)} —
                      collect Form 16A from each client to capture exact TAN + amounts.
                    </div>
                  )}
                </div>
              }
              actions={[
                { href: `/tax/itr3/tds?fy=${fy}`, label: 'Manage' },
                { href: `/tax/itr3/tds/new?fy=${fy}`, label: '+ Add', variant: 'primary' },
              ]}
            />

            <ScheduleCard
              icon={Receipt}
              title="Schedule IT — Advance Tax / Self-Assessment"
              status={s!.advanceTax.rowCount > 0 ? 'done' : 'pending'}
              summary={
                <>
                  {s!.advanceTax.rowCount} challans · Total paid {formatINR(s!.advanceTax.total)}
                </>
              }
              actions={[{ href: `/tax/tax-paid`, label: 'Open Tax Paid' }]}
            />
          </div>

          {/* Monthly TDS breakdown (auto-derived from invoices @ 10%) */}
          {s!.businessProfession.monthlyTdsExpected.length > 0 && (
            <div className="rounded-lg border bg-white p-4">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-gray-700">
                TDS Withheld on Consulting (10% of each invoice, by month)
              </h2>
              <p className="mb-2 text-xs text-gray-500">
                Auto-derived from GST invoices for FY {fy}. This is the TDS your clients should
                have deducted u/s 194J. Cross-check against Form 16A from each client.
              </p>
              <div className="overflow-hidden rounded border">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs">
                    <tr>
                      <th className="px-3 py-2 text-left">Month</th>
                      <th className="px-3 py-2 text-right">Invoices</th>
                      <th className="px-3 py-2 text-right">Gross receipts</th>
                      <th className="px-3 py-2 text-right">TDS @ 10%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s!.businessProfession.monthlyTdsExpected.map((row) => (
                      <tr key={row.month} className="border-t">
                        <td className="px-3 py-2 font-mono text-xs">
                          {new Date(row.month + '-01').toLocaleDateString('en-IN', {
                            month: 'short',
                            year: 'numeric',
                          })}
                        </td>
                        <td className="px-3 py-2 text-right">{row.invoiceCount}</td>
                        <td className="px-3 py-2 text-right font-mono">{formatINR(row.receipts)}</td>
                        <td className="px-3 py-2 text-right font-mono text-amber-700">
                          {formatINR(row.tds)}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t bg-gray-50 font-bold">
                      <td className="px-3 py-2">Total</td>
                      <td className="px-3 py-2 text-right">
                        {s!.businessProfession.monthlyTdsExpected.reduce((sum, r) => sum + r.invoiceCount, 0)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {formatINR(s!.businessProfession.consultingTurnover)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-amber-700">
                        {formatINR(s!.businessProfession.expectedTds194J)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] text-gray-500">
                Captured TDS so far: <strong>{formatINR(s!.tds.nonSalaryTds)}</strong> ·
                Gap: <strong>{formatINR(s!.businessProfession.expectedTds194J - s!.tds.nonSalaryTds)}</strong>
                {s!.businessProfession.expectedTds194J > s!.tds.nonSalaryTds && (
                  <span className="ml-2 text-amber-700">
                    — pending Form 16A from one or more clients
                  </span>
                )}
              </p>
            </div>
          )}

          {/* Export panel */}
          <div className="rounded-lg border bg-white p-4">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-gray-700">
              ITR-3 CSV Exports for FY {fy}
            </h2>
            <p className="mb-3 text-xs text-gray-500">
              Download these CSVs and import them into the official ITR-3 Excel utility (file → Import). Other schedules (S, BP, OS, VI-A) are filled directly in the Excel from the cheat-sheet above.
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <ExportButton onClick={() => downloadCsv('112a', `CSV_112A_and_115AD_${fy}.csv`)}>
                CSV_112A_and_115AD.csv (LTCG)
              </ExportButton>
              <ExportButton onClick={() => downloadCsv('schedule-it', `CSV_IT_${fy}.csv`)}>
                CSV_IT.csv (Advance Tax / SA)
              </ExportButton>
              <ExportButton onClick={() => downloadCsv('tds1', `CSV_TDS1_${fy}.csv`)}>
                CSV_TDS1.csv (Salary TDS)
              </ExportButton>
              <ExportButton onClick={() => downloadCsv('tds2', `CSV_TDS2_${fy}.csv`)}>
                CSV_TDS2.csv (TAN-based TDS)
              </ExportButton>
              <ExportButton onClick={() => downloadCsv('tds3', `CSV_TDS3_${fy}.csv`)}>
                CSV_TDS3.csv (PAN-based TDS)
              </ExportButton>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ScheduleCard({
  icon: Icon,
  title,
  status,
  summary,
  actions,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  status: 'done' | 'pending' | 'auto' | 'manual';
  summary: React.ReactNode;
  actions: Array<{ href: string; label: string; variant?: 'primary' | 'secondary' }>;
}) {
  const statusBadge = {
    done: { color: 'text-emerald-700 bg-emerald-50 border-emerald-200', icon: CheckCircle2, label: 'Captured' },
    pending: { color: 'text-amber-700 bg-amber-50 border-amber-200', icon: AlertCircle, label: 'Pending' },
    auto: { color: 'text-blue-700 bg-blue-50 border-blue-200', icon: CheckCircle2, label: 'Auto' },
    manual: { color: 'text-gray-700 bg-gray-50 border-gray-200', icon: AlertCircle, label: 'Manual' },
  }[status];
  const StatusIcon = statusBadge.icon;
  return (
    <div className="rounded-lg border bg-white p-3">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-2">
          <Icon className="mt-1 h-4 w-4 shrink-0 text-gray-500" />
          <div>
            <h3 className="text-sm font-bold text-gray-900">{title}</h3>
            {/* `summary` is React.ReactNode and call sites pass <div>
                trees (e.g. Schedule BP's gross-receipts block). Must be
                a <div> not a <p> — phrase content can't contain block
                children; the browser auto-closes the <p> and React
                throws a hydration mismatch. */}
            <div className="mt-1 text-xs text-gray-600">{summary}</div>
          </div>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusBadge.color}`}>
          <StatusIcon className="h-3 w-3" />
          {statusBadge.label}
        </span>
      </div>
      <div className="mt-2 flex justify-end gap-1">
        {actions.map((a) => (
          <Link key={a.href} href={a.href}>
            <button
              className={`rounded px-2 py-1 text-xs ${
                a.variant === 'primary'
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'border border-gray-300 hover:bg-gray-50'
              }`}
            >
              {a.label}
            </button>
          </Link>
        ))}
      </div>
    </div>
  );
}

function ExportButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center justify-between gap-2 rounded border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-700 hover:bg-blue-100"
    >
      <span>{children}</span>
      <Download className="h-4 w-4" />
    </button>
  );
}
