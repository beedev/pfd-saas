'use client';

/**
 * Sprint 6.2h — /reports hub.
 *
 * Single-page card grid covering all 9 reports declared in the
 * REPORTS registry. Cards are grouped by category (tax / wealth /
 * planning). Each card carries its own FY selector when the report
 * needs one — picks default to the current FY, options span the
 * recent 5 FYs.
 *
 * No server-side data is needed for the hub itself — the report
 * generation is deferred until the user clicks a format chip. That
 * makes the hub page render instantly even for users with large
 * data.
 */

import { groupReportsByCategory } from '@/lib/reports';
import { ReportCard } from '@/components/reports/report-card';

const CATEGORY_TITLE: Record<'tax' | 'wealth' | 'planning', string> = {
  tax: 'Tax',
  wealth: 'Wealth',
  planning: 'Planning',
};

const CATEGORY_DESCRIPTION: Record<'tax' | 'wealth' | 'planning', string> = {
  tax: 'Section 80 deductions, capital gains, 80G donations, Form 26AS reconciliation, and the ITR filing pack.',
  wealth: 'Snapshots of your net worth across every asset class and liability you track.',
  planning: 'Forward-looking projections: retirement corpus trajectory and 12-month annual cashflow.',
};

export default function ReportsHubPage() {
  const grouped = groupReportsByCategory();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
          Reports
        </h1>
        <p className="text-[var(--dxp-text-secondary)] mt-1">
          Downloadable statements for tax filing, financial planning, and
          sharing with a CA. Every report supports at least one of PDF,
          Excel, or CSV.
        </p>
      </div>

      {(['tax', 'wealth', 'planning'] as const).map((cat) => {
        const reports = grouped[cat];
        if (reports.length === 0) return null;
        return (
          <section key={cat}>
            <div className="mb-3">
              <h2 className="text-lg font-semibold text-[var(--dxp-text)]">
                {CATEGORY_TITLE[cat]}
              </h2>
              <p className="text-xs text-[var(--dxp-text-secondary)]">
                {CATEGORY_DESCRIPTION[cat]}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {reports.map((r) => (
                <ReportCard key={r.id} descriptor={r} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
