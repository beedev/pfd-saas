/**
 * Sprint 6.2d — 80G donation log Excel workbook.
 *
 * Sheets:
 *   Summary    — totals
 *   Donations  — flat per-donation list
 *   Metadata
 */

import * as XLSX from 'xlsx';
import type { Form80gReportData } from '../data/fetchForm80g';
import { makeSheet, metadataSheet, rs, writeWorkbook } from './_helpers';

export function buildForm80gXlsx(data: Form80gReportData, userId: string): Buffer {
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    wb,
    makeSheet({
      name: 'Summary',
      rows: [
        ['Metric', 'Value (₹)'],
        ['Gross Donations', rs(data.totals.grossPaisa)],
        ['Deductible (80G)', rs(data.totals.deductiblePaisa)],
        ['Number of Donations', data.donations.length],
      ],
    }),
    'Summary',
  );

  const detailRows: (string | number)[][] = [
    [
      'Date',
      'Organization',
      'PAN',
      'Mode',
      'Category',
      'Amount (₹)',
      'Eligibility %',
      'Deductible (₹)',
      'Certificate 80G',
      'Notes',
    ],
    ...data.donations.map((d) => [
      d.date,
      d.organization,
      d.pan,
      d.mode,
      d.category,
      rs(d.amountPaisa),
      d.eligibilityPct,
      rs(d.deductiblePaisa),
      d.certificate80g,
      d.notes,
    ]),
  ];
  XLSX.utils.book_append_sheet(
    wb,
    makeSheet({ name: 'Donations', rows: detailRows }),
    'Donations',
  );

  XLSX.utils.book_append_sheet(
    wb,
    metadataSheet({
      reportId: 'form80g',
      title: '80G Donation Log',
      fy: data.fy,
      userId,
    }),
    'Metadata',
  );

  return writeWorkbook(wb);
}
