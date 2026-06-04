/**
 * Sprint 6.2d — Retirement Projection Excel workbook.
 *
 * Sheets:
 *   Assumptions  — input parameters as a key/value sheet
 *   Projection   — year-by-year corpus trajectory
 *   Metadata
 */

import * as XLSX from 'xlsx';
import type { RetirementProjectionReportData } from '../data/fetchRetirementProjection';
import { makeSheet, metadataSheet, rs, writeWorkbook } from './_helpers';

export function buildRetirementXlsx(
  data: RetirementProjectionReportData,
  userId: string,
): Buffer {
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    wb,
    makeSheet({
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
    }),
    'Assumptions',
  );

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
  XLSX.utils.book_append_sheet(
    wb,
    makeSheet({ name: 'Projection', rows: projRows }),
    'Projection',
  );

  XLSX.utils.book_append_sheet(
    wb,
    metadataSheet({
      reportId: 'retirement',
      title: 'Retirement Projection',
      userId,
    }),
    'Metadata',
  );

  return writeWorkbook(wb);
}
