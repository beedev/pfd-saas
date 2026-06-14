'use client';

/**
 * Slim top bar carrying the ONE global financial-year selector. Mounted in the
 * dashboard layout, but it only MATTERS on pages that read the FY from context
 * — today that's Tax/* and Income. Everywhere else (net worth, investments,
 * GST — which has its own FY filter) it's noise, so the bar hides itself. Add a
 * route prefix here when a new page starts reading the global FY.
 */

import { Select } from '@dxp/ui';
import { CalendarRange } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useFinancialYear } from '@/components/providers/financial-year-provider';

const FY_SCOPED_PREFIXES = ['/tax', '/income'];

export function FinancialYearBar() {
  const pathname = usePathname();
  const { fy, setFy, options } = useFinancialYear();
  if (!FY_SCOPED_PREFIXES.some((p) => pathname.startsWith(p))) return null;
  return (
    <div className="mb-4 flex items-center justify-end gap-2">
      <CalendarRange className="h-4 w-4 text-[var(--dxp-text-muted)]" />
      <span className="text-xs font-medium text-[var(--dxp-text-secondary)]">Financial year</span>
      <div className="w-36">
        <Select options={options} value={fy} onChange={setFy} />
      </div>
    </div>
  );
}
