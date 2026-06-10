/**
 * Sprint 6.2d — 80G donation log Excel workbook.
 *
 * Sheets:
 *   Summary    — totals
 *   Donations  — flat per-donation list
 *   Metadata
 */

import type { Form80gReportData } from '../data/fetchForm80g';
import { appendSheet, metadataSheet, newWorkbook, rs, writeWorkbook } from './_helpers';

export async function buildForm80gXlsx(
  data: Form80gReportData,
  userId: string,
): Promise<Buffer> {
  const wb = newWorkbook();

  appendSheet(wb, {
    name: 'Summary',
    rows: [
      ['Metric', 'Value (₹)'],
      ['Gross Donations', rs(data.totals.grossPaisa)],
      ['Deductible (80G)', rs(data.totals.deductiblePaisa)],
      ['Number of Donations', data.donations.length],
    ],
  });

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
  appendSheet(wb, { name: 'Donations', rows: detailRows });

  appendSheet(
    wb,
    metadataSheet({
      reportId: 'form80g',
      title: '80G Donation Log',
      fy: data.fy,
      userId,
    }),
  );

  return writeWorkbook(wb);
}
