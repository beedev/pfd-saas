/**
 * Sprint 6.2d — Net Worth Excel workbook.
 *
 * Sheets:
 *   Summary    — top-line totals (assets / liabilities / net)
 *   Categories — category subtotals
 *   Items      — flat per-item list (category × item × value)
 *   Metadata   — standard report metadata
 */

import type { NetWorthReportData } from '../data/fetchNetWorth';
import { appendSheet, metadataSheet, newWorkbook, rs, writeWorkbook } from './_helpers';

export async function buildNetWorthXlsx(
  data: NetWorthReportData,
  userId: string,
): Promise<Buffer> {
  const wb = newWorkbook();

  // Summary
  appendSheet(wb, {
    name: 'Summary',
    rows: [
      ['Metric', 'Value (₹)'],
      ['Total Assets', rs(data.totals.assetsPaisa)],
      ['Total Liabilities', rs(data.totals.liabilitiesPaisa)],
      ['Net Worth', rs(data.totals.netPaisa)],
      ['As Of', data.asOfDate.toISOString().slice(0, 10)],
    ],
  });

  // Categories
  const categoryRows: (string | number)[][] = [['Category', 'Value (₹)']];
  for (const c of data.categories) categoryRows.push([c.name, rs(c.valuePaisa)]);
  appendSheet(wb, { name: 'Categories', rows: categoryRows });

  // Items (flat: category × item × value)
  const itemRows: (string | number)[][] = [['Category', 'Item', 'Value (₹)']];
  for (const c of data.categories) {
    for (const i of c.items) itemRows.push([c.name, i.name, rs(i.valuePaisa)]);
  }
  appendSheet(wb, { name: 'Items', rows: itemRows });

  // Metadata
  appendSheet(
    wb,
    metadataSheet({ reportId: 'networth', title: 'Net Worth Statement', userId }),
  );

  return writeWorkbook(wb);
}
