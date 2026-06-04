/**
 * Sprint 6.2d — Net Worth Excel workbook.
 *
 * Sheets:
 *   Summary    — top-line totals (assets / liabilities / net)
 *   Categories — category subtotals
 *   Items      — flat per-item list (category × item × value)
 *   Metadata   — standard report metadata
 */

import * as XLSX from 'xlsx';
import type { NetWorthReportData } from '../data/fetchNetWorth';
import { makeSheet, metadataSheet, rs, writeWorkbook } from './_helpers';

export function buildNetWorthXlsx(data: NetWorthReportData, userId: string): Buffer {
  const wb = XLSX.utils.book_new();

  // Summary
  const summary = makeSheet({
    name: 'Summary',
    rows: [
      ['Metric', 'Value (₹)'],
      ['Total Assets', rs(data.totals.assetsPaisa)],
      ['Total Liabilities', rs(data.totals.liabilitiesPaisa)],
      ['Net Worth', rs(data.totals.netPaisa)],
      ['As Of', data.asOfDate.toISOString().slice(0, 10)],
    ],
  });
  XLSX.utils.book_append_sheet(wb, summary, 'Summary');

  // Categories
  const categoryRows: (string | number)[][] = [['Category', 'Value (₹)']];
  for (const c of data.categories) categoryRows.push([c.name, rs(c.valuePaisa)]);
  XLSX.utils.book_append_sheet(
    wb,
    makeSheet({ name: 'Categories', rows: categoryRows }),
    'Categories',
  );

  // Items (flat: category × item × value)
  const itemRows: (string | number)[][] = [['Category', 'Item', 'Value (₹)']];
  for (const c of data.categories) {
    for (const i of c.items) itemRows.push([c.name, i.name, rs(i.valuePaisa)]);
  }
  XLSX.utils.book_append_sheet(wb, makeSheet({ name: 'Items', rows: itemRows }), 'Items');

  // Metadata
  XLSX.utils.book_append_sheet(
    wb,
    metadataSheet({ reportId: 'networth', title: 'Net Worth Statement', userId }),
    'Metadata',
  );

  return writeWorkbook(wb);
}
