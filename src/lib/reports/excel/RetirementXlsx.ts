/**
 * Sprint 6.2d — Retirement Projection Excel workbook.
 *
 * Sheets:
 *   Assumptions  — input parameters as a key/value sheet
 *   Projection   — year-by-year corpus trajectory
 *   Metadata
 */

import type { RetirementProjectionReportData } from '../data/fetchRetirementProjection';
import { appendSheet, metadataSheet, newWorkbook, rs, writeWorkbook } from './_helpers';

export async function buildRetirementXlsx(
  data: RetirementProjectionReportData,
  userId: string,
): Promise<Buffer> {
  const wb = newWorkbook();

  appendSheet(wb, {
    name: 'Assumptions',
    rows: [
      ['Field', 'Value'],
      ['Current Age', data.assumptions.currentAge],
      ['Target Retirement Age', data.assumptions.targetAge],
      ['Retirement Duration (years)', data.assumptions.retirementDurationYears],
      ['Monthly Expense (₹)', data.assumptions.monthlyExpenseRupees],
      ['Inflation (%)', data.assumptions.inflationPct],
      ['Pre-Retirement Return (%)', data.assumptions.expectedReturnPct],
      ['Post-Retirement Return (%)', data.assumptions.postRetirementReturnPct],
      ['Starting Corpus (₹)', rs(data.startingCorpusPaisa)],
    ],
  });

  const projRows: (string | number)[][] = [
    [
      'Year',
      'Age',
      'Corpus Start (₹)',
      'Contributions (₹)',
      'Returns (₹)',
      'Withdrawals (₹)',
      'Corpus End (₹)',
    ],
    ...data.projection.map((p) => [
      p.year,
      p.age,
      rs(p.corpusStartPaisa),
      rs(p.contributionsPaisa),
      rs(p.returnsPaisa),
      rs(p.withdrawalsPaisa),
      rs(p.corpusEndPaisa),
    ]),
  ];
  appendSheet(wb, { name: 'Projection', rows: projRows });

  appendSheet(
    wb,
    metadataSheet({
      reportId: 'retirement',
      title: 'Retirement Projection',
      userId,
    }),
  );

  return writeWorkbook(wb);
}
