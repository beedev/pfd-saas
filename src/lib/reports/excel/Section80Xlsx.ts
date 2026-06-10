/**
 * Sprint 6.2d — Section 80 Excel workbook.
 *
 * Sheets:
 *   Summary    — per-section claimed / cap / used%
 *   Deductions — flat per-entry list
 *   Metadata
 */

import type { Section80ReportData } from '../data/fetchSection80';
import { appendSheet, metadataSheet, newWorkbook, rs, writeWorkbook } from './_helpers';

export async function buildSection80Xlsx(
  data: Section80ReportData,
  userId: string,
): Promise<Buffer> {
  const wb = newWorkbook();

  // Summary
  const summaryRows: (string | number | null)[][] = [
    ['Section', 'Label', 'Claimed (₹)', 'Cap (₹)', 'Used %'],
    ...data.rows.map((r) => [
      r.section,
      r.label,
      rs(r.claimedPaisa),
      r.capPaisa != null ? rs(r.capPaisa) : null,
      Number(r.usedPct.toFixed(2)),
    ]),
    [
      'Total',
      '',
      rs(data.totals.claimedPaisa),
      rs(data.totals.cappedPaisa),
      '',
    ],
  ];
  appendSheet(wb, { name: 'Summary', rows: summaryRows });

  // Deductions (flat)
  const detailRows: (string | number)[][] = [
    [
      'Section',
      'Description',
      'Recipient',
      'Amount (₹)',
      'Payment Date',
      'Payment Method',
      'PAN',
      'Notes',
    ],
  ];
  for (const r of data.rows) {
    for (const e of r.entries) {
      detailRows.push([
        e.section,
        e.description,
        e.recipient,
        rs(e.amountPaisa),
        e.paymentDate,
        e.paymentMethod,
        e.pan,
        e.notes,
      ]);
    }
  }
  appendSheet(wb, { name: 'Deductions', rows: detailRows });

  appendSheet(
    wb,
    metadataSheet({
      reportId: 'section80',
      title: 'Section 80 Deductions',
      fy: data.fy,
      userId,
    }),
  );

  return writeWorkbook(wb);
}
