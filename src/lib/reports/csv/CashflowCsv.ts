/**
 * Sprint 6.2e — Annual Cashflow CSV.
 *
 * Long format (not wide) for spreadsheet-friendly pivot:
 *   kind,label,month,month_label,amount_rupees
 *
 * Where kind ∈ {'income','expense','net'} and month is 1-indexed Apr=1.
 * Long format avoids the 12-column wide layout that breaks if a user
 * imports into a tool expecting tidy long data.
 */

import { csvEscape } from '../format-utils';
import type { CashflowReportData } from '../data/fetchCashflow';

export function buildCashflowCsv(data: CashflowReportData): string {
  const lines: string[] = ['Kind,Label,Month #,Month Label,Amount (₹)'];

  for (const row of data.income) {
    for (let i = 0; i < 12; i++) {
      lines.push(
        [
          csvEscape('income'),
          csvEscape(row.label),
          String(i + 1),
          csvEscape(data.months[i].label),
          (row.monthly[i] / 100).toFixed(2),
        ].join(','),
      );
    }
    lines.push(
      [
        csvEscape('income'),
        csvEscape(row.label),
        'TOTAL',
        'FY Total',
        (row.totalPaisa / 100).toFixed(2),
      ].join(','),
    );
  }

  for (const row of data.expenses) {
    for (let i = 0; i < 12; i++) {
      lines.push(
        [
          csvEscape('expense'),
          csvEscape(row.label),
          String(i + 1),
          csvEscape(data.months[i].label),
          (row.monthly[i] / 100).toFixed(2),
        ].join(','),
      );
    }
    lines.push(
      [
        csvEscape('expense'),
        csvEscape(row.label),
        'TOTAL',
        'FY Total',
        (row.totalPaisa / 100).toFixed(2),
      ].join(','),
    );
  }

  for (let i = 0; i < 12; i++) {
    lines.push(
      [
        csvEscape('net'),
        csvEscape('Net (Income − Expenses)'),
        String(i + 1),
        csvEscape(data.months[i].label),
        (data.totals.netMonthly[i] / 100).toFixed(2),
      ].join(','),
    );
  }
  lines.push(
    [
      csvEscape('net'),
      csvEscape('Net (Income − Expenses)'),
      'TOTAL',
      'FY Total',
      (data.totals.netTotalPaisa / 100).toFixed(2),
    ].join(','),
  );

  return lines.join('\r\n');
}
