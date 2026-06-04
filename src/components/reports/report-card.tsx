'use client';

/**
 * Sprint 6.2h — Reports hub card.
 *
 * One card per descriptor on the /reports hub. Shows:
 *   • Title + 1-line description
 *   • Format chips (PDF / Excel / CSV / ZIP)
 *   • Inline FY selector when descriptor.needsFy
 *
 * Clicking a format chip triggers a download (same mechanism as
 * ScreenReportButton — just GET to the dynamic route + browser
 * downloads attachment).
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, Badge } from '@dxp/ui';
import { FileText, FileSpreadsheet, FileCode2, Download } from 'lucide-react';
import type { ReportDescriptor, ReportFormat } from '@/types/reports';
import { getCurrentFinancialYear } from '@/lib/finance/tax-constants';

interface Props {
  descriptor: ReportDescriptor;
}

function formatMeta(format: ReportFormat): {
  label: string;
  icon: typeof FileText;
  className: string;
} {
  switch (format) {
    case 'pdf':
      return {
        label: 'PDF',
        icon: FileText,
        className:
          'border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100',
      };
    case 'xlsx':
      return {
        label: 'Excel',
        icon: FileSpreadsheet,
        className:
          'border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
      };
    case 'csv':
      return {
        label: 'CSV',
        icon: FileCode2,
        className:
          'border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100',
      };
    case 'zip':
      return {
        label: 'ZIP',
        icon: Download,
        className:
          'border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100',
      };
  }
}

/** Build a list of recent FYs (current + previous 4) — matches the
 *  pattern used on /tax + /income FY selectors. */
function recentFys(): string[] {
  const cur = getCurrentFinancialYear();
  const [aStr] = cur.split('-');
  const startYear = Number(aStr);
  const out: string[] = [];
  for (let i = 0; i < 5; i++) {
    const s = startYear - i;
    out.push(`${s}-${String((s + 1) % 100).padStart(2, '0')}`);
  }
  return out;
}

export function ReportCard({ descriptor }: Props) {
  const [fy, setFy] = useState<string>(getCurrentFinancialYear());

  function trigger(format: ReportFormat) {
    const url = new URL(
      `/api/reports/${descriptor.id}/${format}`,
      window.location.origin,
    );
    if (descriptor.needsFy) url.searchParams.set('fy', fy);
    window.location.href = url.toString();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <h3 className="text-base font-semibold text-[var(--dxp-text)]">
              {descriptor.title}
            </h3>
            <p className="text-xs text-[var(--dxp-text-secondary)] mt-1">
              {descriptor.description}
            </p>
          </div>
          <Badge variant="default">{descriptor.category}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {descriptor.needsFy ? (
          <div className="mb-3">
            <label className="block text-xs font-medium text-[var(--dxp-text-secondary)] mb-1">
              Financial Year
            </label>
            <select
              value={fy}
              onChange={(e) => setFy(e.target.value)}
              className="w-full rounded-md border border-[var(--dxp-border)] bg-[var(--dxp-bg)] px-2 py-1 text-sm text-[var(--dxp-text)]"
            >
              {recentFys().map((y) => (
                <option key={y} value={y}>
                  FY {y}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {descriptor.formats.map((f) => {
            const meta = formatMeta(f);
            const Icon = meta.icon;
            return (
              <button
                key={f}
                type="button"
                onClick={() => trigger(f)}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${meta.className}`}
              >
                <Icon className="h-3.5 w-3.5" />
                Download {meta.label}
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
