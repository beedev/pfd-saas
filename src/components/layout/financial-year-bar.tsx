'use client';

/**
 * Slim top bar carrying the ONE global financial-year selector. Mounted in
 * the dashboard layout above every page so the FY is chosen once and every
 * FY-scoped view (tax, budget, income, reports) reads it from context.
 */

import { Select } from '@dxp/ui';
import { CalendarRange } from 'lucide-react';
import { useFinancialYear } from '@/components/providers/financial-year-provider';

export function FinancialYearBar() {
  const { fy, setFy, options } = useFinancialYear();
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
