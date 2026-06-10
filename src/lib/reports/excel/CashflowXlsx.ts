/**
 * Sprint 6.2d — Annual Cashflow Excel workbook.
 *
 * Sheets:
 *   Summary    — FY income / expense / net totals
 *   Income     — line items × 12 months × total (wide format)
 *   Expenses   — line items × 12 months × total (wide format)
 *   Metadata
 */

import type { CashflowReportData, CashflowRow } from '../data/fetchCashflow';
import {
  appendSheet,
  metadataSheet,
  newWorkbook,
  rs,
  writeWorkbook,
  type SheetSpec,
} from './_helpers';

function gridSheet(
  name: string,
  monthLabels: string[],
  rows: CashflowRow[],
  totalLabel: string,
  monthlyTotals: number[],
  total: number,
): SheetSpec {
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
  return { name, rows: [header, ...dataRows, totalRow] };
}

export async function buildCashflowXlsx(
  data: CashflowReportData,
  userId: string,
): Promise<Buffer> {
  const wb = newWorkbook();
  const monthLabels = data.months.map((m) => m.label);

  appendSheet(wb, {
    name: 'Summary',
    rows: [
      ['Metric', 'Value (₹)'],
      ['Income (FY Total)', rs(data.totals.incomeTotalPaisa)],
      ['Expenses (FY Total)', rs(data.totals.expenseTotalPaisa)],
      ['Net (Income − Expenses)', rs(data.totals.netTotalPaisa)],
    ],
  });

  appendSheet(
    wb,
    gridSheet(
      'Income',
      monthLabels,
      data.income,
      'Income Total',
      data.totals.incomeMonthly,
      data.totals.incomeTotalPaisa,
    ),
  );

  appendSheet(
    wb,
    gridSheet(
      'Expenses',
      monthLabels,
      data.expenses,
      'Expense Total',
      data.totals.expenseMonthly,
      data.totals.expenseTotalPaisa,
    ),
  );

  appendSheet(
    wb,
    metadataSheet({
      reportId: 'cashflow',
      title: 'Annual Cashflow Statement',
      fy: data.fy,
      userId,
    }),
  );

  return writeWorkbook(wb);
}
