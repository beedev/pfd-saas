/**
 * Sprint 6.2d — Income Summary Excel workbook.
 *
 * Sheets:
 *   Summary        — grand totals
 *   Salary         — per-employer breakdown
 *   Capital Gains  — LTCG / STCG / tax totals (line-item granularity
 *                    lives in the Capital Gains report)
 *   Other Income   — interest / dividends / rental / other
 *   Metadata
 */

import type { IncomeSummaryReportData } from '../data/fetchIncomeSummary';
import { appendSheet, metadataSheet, newWorkbook, rs, writeWorkbook } from './_helpers';

export async function buildIncomeSummaryXlsx(
  data: IncomeSummaryReportData,
  userId: string,
): Promise<Buffer> {
  const wb = newWorkbook();

  // Summary
  appendSheet(wb, {
    name: 'Summary',
    rows: [
      ['Section', 'Amount (₹)'],
      ['Salary Gross', rs(data.salary.grossPaisa)],
      ['Salary Taxable', rs(data.salary.taxablePaisa)],
      ['Salary TDS', rs(data.salary.tdsPaisa)],
      ['LTCG', rs(data.capitalGains.ltcgPaisa)],
      ['STCG', rs(data.capitalGains.stcgPaisa)],
      ['CG Tax', rs(data.capitalGains.totalTaxPaisa)],
      ['Interest', rs(data.otherIncome.interestPaisa)],
      ['Dividends', rs(data.otherIncome.dividendsPaisa)],
      ['Other', rs(data.otherIncome.otherPaisa)],
      ['Grand Total', rs(data.totals.grandTotalPaisa)],
    ],
  });

  // Salary
  const salaryRows: (string | number)[][] = [
    ['Employer', 'TAN', 'Gross (₹)'],
    ...data.salary.employers.map((e) => [
      e.employerName,
      e.employerTan,
      rs(e.grossPaisa),
    ]),
  ];
  appendSheet(wb, { name: 'Salary', rows: salaryRows });

  // Capital Gains
  appendSheet(wb, {
    name: 'Capital Gains',
    rows: [
      ['Type', 'Amount (₹)'],
      ['LTCG', rs(data.capitalGains.ltcgPaisa)],
      ['STCG', rs(data.capitalGains.stcgPaisa)],
      ['Total Tax', rs(data.capitalGains.totalTaxPaisa)],
      ['Entries', data.capitalGains.entries],
    ],
  });

  // Other Income
  appendSheet(wb, {
    name: 'Other Income',
    rows: [
      ['Source', 'Amount (₹)'],
      ['Interest', rs(data.otherIncome.interestPaisa)],
      ['Dividends', rs(data.otherIncome.dividendsPaisa)],
      ['Rental', rs(data.otherIncome.rentalPaisa)],
      ['Other', rs(data.otherIncome.otherPaisa)],
      ['Total', rs(data.otherIncome.totalPaisa)],
    ],
  });

  appendSheet(
    wb,
    metadataSheet({
      reportId: 'income-summary',
      title: 'Income Summary',
      fy: data.fy,
      userId,
    }),
  );

  return writeWorkbook(wb);
}
