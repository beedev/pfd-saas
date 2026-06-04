/**
 * Sprint 6.2 — Downloadable reports registry.
 *
 * Single source of truth for "what reports exist and which formats
 * does each support". The dynamic API route at
 * `src/app/api/reports/[id]/[format]/route.ts` consults this map to
 * gate requests, and the `/reports` hub UI iterates it to render the
 * card grid. Per-screen download buttons reference one entry each.
 *
 * Adding a new report:
 *   1. Add the descriptor to REPORTS below.
 *   2. Create `data/fetch<Name>.ts` returning a canonical shape.
 *   3. Add format generators (`pdf/<Name>Pdf.tsx`, `excel/<Name>Xlsx.ts`,
 *      `csv/<Name>Csv.ts`) matching the formats array.
 *   4. Wire dispatch in the dynamic route.
 *
 * The 9th descriptor (`cashflow`) was added between Sprint 6.3 and
 * 6.2 — a 12-month income-vs-expense grid scoped to a FY.
 *
 * `filing-pack` is a rebrand: the existing
 * `/api/tax/filing-pack/generate` ZIP endpoint stays put; the hub
 * card simply links to it via the dynamic route's redirect branch.
 */

import type { ReportDescriptor } from '@/types/reports';

export const REPORTS: ReportDescriptor[] = [
  {
    id: 'networth',
    title: 'Net Worth Statement',
    description:
      'Snapshot of all assets and liabilities across 10 asset classes, with category subtotals.',
    category: 'wealth',
    formats: ['pdf', 'xlsx', 'csv'],
    needsFy: false,
  },
  {
    id: 'income-summary',
    title: 'Income Summary',
    description:
      'FY-scoped income across salary, business, capital gains, interest, dividends, and rental.',
    category: 'tax',
    formats: ['pdf', 'xlsx', 'csv'],
    needsFy: true,
  },
  {
    id: 'section80',
    title: 'Section 80 Deductions',
    description:
      'Chapter VI-A deductions claimed for the FY with caps, utilisation, and document coverage.',
    category: 'tax',
    formats: ['pdf', 'xlsx', 'csv'],
    needsFy: true,
  },
  {
    id: 'capital-gains',
    title: 'Capital Gains Statement',
    description: 'LTCG and STCG entries with cost-inflation-index, exemptions, and computed tax.',
    category: 'tax',
    formats: ['pdf', 'xlsx', 'csv'],
    needsFy: true,
  },
  {
    id: 'form80g',
    title: '80G Donation Log',
    description: 'PAN-tagged donations for the FY with category-wise eligibility split.',
    category: 'tax',
    formats: ['pdf', 'xlsx'],
    needsFy: true,
  },
  {
    id: 'form26as-recon',
    title: 'Form 26AS Reconciliation',
    description: 'TDS credits booked vs. TDS reported on Form 26AS — deltas highlighted.',
    category: 'tax',
    formats: ['pdf', 'csv'],
    needsFy: true,
  },
  {
    id: 'retirement',
    title: 'Retirement Projection',
    description: 'Year-by-year corpus, contributions, returns, withdrawals, and net position.',
    category: 'planning',
    formats: ['pdf', 'xlsx'],
    needsFy: false,
  },
  {
    id: 'cashflow',
    title: 'Annual Cashflow Statement',
    description:
      '12-month FY grid of income vs categorised expenses with monthly and annual totals.',
    category: 'planning',
    formats: ['pdf', 'xlsx', 'csv'],
    needsFy: true,
  },
  {
    id: 'filing-pack',
    title: 'ITR Filing Pack',
    description:
      'ZIP containing Section 80 CSV, supporting documents, and a README — ready to share with a CA.',
    category: 'tax',
    formats: ['zip'],
    needsFy: true,
  },
];

/** Lookup helper — undefined if no descriptor matches. Used by the
 *  dynamic API route to gate requests and by UI to validate the
 *  reportId before opening a download window. */
export function getReport(id: string): ReportDescriptor | undefined {
  return REPORTS.find((r) => r.id === id);
}

/** Convenience grouping used by the hub UI; the order of REPORTS
 *  inside each category bucket matches the array order above. */
export function groupReportsByCategory(): Record<
  'tax' | 'wealth' | 'planning',
  ReportDescriptor[]
> {
  const out: Record<'tax' | 'wealth' | 'planning', ReportDescriptor[]> = {
    tax: [],
    wealth: [],
    planning: [],
  };
  for (const r of REPORTS) out[r.category].push(r);
  return out;
}
