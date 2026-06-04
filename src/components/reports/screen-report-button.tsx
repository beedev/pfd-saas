'use client';

/**
 * Sprint 6.2g — per-screen download dropdown.
 *
 * Compact dropdown the consumer page drops into its header. Looks up
 * the report descriptor from the REPORTS registry and renders one
 * menu item per supported format. Clicking an item triggers a
 * straight `window.location.href = …` download — the dynamic API
 * route does the Content-Disposition dance.
 *
 * Usage:
 *   <ScreenReportButton reportId="networth" />
 *   <ScreenReportButton reportId="section80" fy="2025-26" />
 *
 * If the reportId isn't in the registry we render nothing (rather
 * than throwing). This lets a page wire the button optimistically
 * before the corresponding report is registered.
 */

import { Download, FileText, FileSpreadsheet, FileCode2 } from 'lucide-react';
import { Button } from '@dxp/ui';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { getReport } from '@/lib/reports';
import type { ReportFormat } from '@/types/reports';

interface Props {
  /** Matches a descriptor id from src/lib/reports/index.ts. */
  reportId: string;
  /** Financial year in "YYYY-YY" form — passed as a query string when present. */
  fy?: string;
  /** Override the trigger label. Defaults to "Download". */
  label?: string;
}

function formatMeta(format: ReportFormat): {
  label: string;
  icon: typeof FileText;
} {
  switch (format) {
    case 'pdf':
      return { label: 'PDF', icon: FileText };
    case 'xlsx':
      return { label: 'Excel', icon: FileSpreadsheet };
    case 'csv':
      return { label: 'CSV', icon: FileCode2 };
    case 'zip':
      return { label: 'ZIP', icon: FileCode2 };
  }
}

export function ScreenReportButton({ reportId, fy, label = 'Download' }: Props) {
  const descriptor = getReport(reportId);
  if (!descriptor) return null;

  function triggerDownload(format: ReportFormat) {
    const url = new URL(
      `/api/reports/${reportId}/${format}`,
      window.location.origin,
    );
    if (fy && descriptor && descriptor.needsFy) url.searchParams.set('fy', fy);
    window.location.href = url.toString();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary">
          <Download className="mr-2 h-4 w-4" />
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>{descriptor.title}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {descriptor.formats.map((f) => {
          const meta = formatMeta(f);
          const Icon = meta.icon;
          return (
            <DropdownMenuItem key={f} onSelect={() => triggerDownload(f)}>
              <Icon className="mr-2 h-4 w-4" />
              {meta.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
