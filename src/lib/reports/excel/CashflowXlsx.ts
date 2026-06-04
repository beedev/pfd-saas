/**
 * Sprint 6.2d — Annual Cashflow Excel workbook.
 *
 * Sheets:
 *   Summary    — FY income / expense / net totals
 *   Income     — line items × 12 months × total (wide format)
 *   Expenses   — line items × 12 months × total (wide format)
 *   Metadata
 */

import * as XLSX from 'xlsx';
import type { CashflowReportData, CashflowRow } from '../data/fetchCashflow';
import { makeSheet, metadataSheet, rs, writeWorkbook } from './_helpers';

function gridSheet(
  monthLabels: string[],
  rows: CashflowRow[],
  totalLabel: string,
  monthlyTotals: number[],
  total: number,
): XLSX.WorkSheet {
  const header = ['Line Item', ...monthLabels, 'Total (₹)'];
  const dataRows: (string | number)[][] = rows.map((r) => [
    r.label,
    ...r.monthly.map((v) => rs(v)),
    rs(r.totalPaisa),
  ]);
  const totalRow: (string | number)[] = [
    totalLabel,
    ...monthlyTotals.map((v) => rs(v)),
    rs(total),
  ];
  return makeSheet({
    name: 'Cashflow',
    rows: [header, ...dataRows, totalRow],
  });
}

export function buildCashflowXlsx(data: CashflowReportData, userId: string): Buffer {
  const wb = XLSX.utils.book_new();
  const monthLabels = data.months.map((m) => m.label);

  XLSX.utils.book_append_sheet(
    wb,
    makeSheet({
      name: 'Summary',
      rows: [
        ['Metric', 'Value (₹)'],
        ['Income (FY Total)', rs(data.totals.incomeTotalPaisa)],
        ['Expenses (FY Total)', rs(data.totals.expenseTotalPaisa)],
        ['Net (Income − Expenses)', rs(data.totals.netTotalPaisa)],
      ],
    }),
    'Summary',
  );

  XLSX.utils.book_append_sheet(
    wb,
    gridSheet(
      monthLabels,
      data.income,
      'Income Total',
      data.totals.incomeMonthly,
      data.totals.incomeTotalPaisa,
    ),
    'Income',
  );

  XLSX.utils.book_append_sheet(
    wb,
    gridSheet(
      monthLabels,
      data.expenses,
      'Expense Total',
      data.totals.expenseMonthly,
      data.totals.expenseTotalPaisa,
    ),
    'Expenses',
  );

  XLSX.utils.book_append_sheet(
    wb,
    metadataSheet({
      reportId: 'cashflow',
      title: 'Annual Cashflow Statement',
      fy: data.fy,
      userId,
    }),
    'Metadata',
  );

  return writeWorkbook(wb);
}
