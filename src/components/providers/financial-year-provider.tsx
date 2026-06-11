'use client';

/**
 * Global financial-year context.
 *
 * ONE selected FY shared across the whole app — tax, budget, income,
 * reports, everything — instead of each page keeping its own state. The
 * choice is persisted to the `pfd-fy` cookie so it survives navigation +
 * reload and is readable server-side (the dashboard layout seeds the
 * provider's initial value from it).
 *
 * Usage in any client page:
 *   const { fy, setFy } = useFinancialYear();
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { getCurrentFinancialYear } from '@/lib/finance/tax-constants';

export interface FinancialYearOption {
  value: string;
  label: string;
}

interface FinancialYearContextValue {
  fy: string;
  setFy: (fy: string) => void;
  options: FinancialYearOption[];
}

const FinancialYearContext = createContext<FinancialYearContextValue | null>(null);

const FY_COOKIE = 'pfd-fy';

/** A forward-looking range of selectable FYs (4 prior … 2 ahead of current)
 *  so newly-added budget years are always reachable from the global picker. */
function defaultFyOptions(): FinancialYearOption[] {
  const current = getCurrentFinancialYear();
  const startYear = Number(current.slice(0, 4));
  const out: FinancialYearOption[] = [];
  for (let y = startYear - 4; y <= startYear + 2; y++) {
    const fy = `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
    out.push({ value: fy, label: `FY ${fy}` });
  }
  return out.reverse(); // newest first
}

export function FinancialYearProvider({
  initialFy,
  children,
}: {
  initialFy?: string;
  children: React.ReactNode;
}) {
  const [fy, setFyState] = useState<string>(initialFy || getCurrentFinancialYear());

  const setFy = useCallback((next: string) => {
    setFyState(next);
    // Persist for SSR + reload. 1-year cookie, root path, lax.
    document.cookie = `${FY_COOKIE}=${encodeURIComponent(next)}; path=/; max-age=31536000; samesite=lax`;
  }, []);

  const options = useMemo(() => {
    const opts = defaultFyOptions();
    // Make sure the active FY is always present even if outside the range.
    if (!opts.some((o) => o.value === fy)) {
      opts.unshift({ value: fy, label: `FY ${fy}` });
    }
    return opts;
  }, [fy]);

  const value = useMemo(() => ({ fy, setFy, options }), [fy, setFy, options]);

  return <FinancialYearContext.Provider value={value}>{children}</FinancialYearContext.Provider>;
}

/** Read/select the global FY. Throws if used outside the provider so the
 *  mistake surfaces immediately rather than silently desyncing. */
export function useFinancialYear(): FinancialYearContextValue {
  const ctx = useContext(FinancialYearContext);
  if (!ctx) {
    throw new Error('useFinancialYear must be used within <FinancialYearProvider>');
  }
  return ctx;
}
