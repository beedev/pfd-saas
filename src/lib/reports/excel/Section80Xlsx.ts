/**
 * Sprint 6.2d — Section 80 Excel workbook.
 *
 * Sheets:
 *   Summary    — per-section claimed / cap / used%
 *   Deductions — flat per-entry list
 *   Metadata
 */

import * as XLSX from 'xlsx';
import type { Section80ReportData } from '../data/fetchSection80';
import { makeSheet, metadataSheet, rs, writeWorkbook } from './_helpers';

export function buildSection80Xlsx(data: Section80ReportData, userId: string): Buffer {
  const wb = XLSX.utils.book_new();

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
  XLSX.utils.book_append_sheet(wb, makeSheet({ name: 'Summary', rows: summaryRows }), 'Summary');

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
  XLSX.utils.book_append_sheet(
    wb,
    makeSheet({ name: 'Deductions', rows: detailRows }),
    'Deductions',
  );

  XLSX.utils.book_append_sheet(
    wb,
    metadataSheet({
      reportId: 'section80',
      title: 'Section 80 Deductions',
      fy: data.fy,
      userId,
    }),
    'Metadata',
  );

  return writeWorkbook(wb);
}
