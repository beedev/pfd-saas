/**
 * Sprint 6.2e — Section 80 CSV.
 *
 * Flat: section | name | amount_rupees | cap_rupees | used_pct.
 * Plus per-entry rows nested under each section.
 */

import { csvEscape } from '../format-utils';
import type { Section80ReportData } from '../data/fetchSection80';

export function buildSection80Csv(data: Section80ReportData): string {
  const lines: string[] = [
    'Section,Type,Description,Recipient,Amount (₹),Cap (₹),Used %,Payment Date,PAN',
  ];

  for (const row of data.rows) {
    // Section summary row
    lines.push(
      [
        csvEscape(row.section),
        csvEscape('SUMMARY'),
        csvEscape(row.label),
        '',
        (row.claimedPaisa / 100).toFixed(2),
        row.capPaisa != null ? (row.capPaisa / 100).toFixed(2) : '',
        row.usedPct.toFixed(2),
        '',
        '',
      ].join(','),
    );
    // Per-entry rows
    for (const e of row.entries) {
      lines.push(
        [
          csvEscape(e.section),
          csvEscape('ENTRY'),
          csvEscape(e.description),
          csvEscape(e.recipient),
          (e.amountPaisa / 100).toFixed(2),
          '',
          '',
          csvEscape(e.paymentDate),
          csvEscape(e.pan),
        ].join(','),
      );
    }
  }
  lines.push(
    [
      csvEscape('TOTAL'),
      csvEscape('TOTAL'),
      '',
      '',
      (data.totals.claimedPaisa / 100).toFixed(2),
      (data.totals.cappedPaisa / 100).toFixed(2),
      '',
      '',
      '',
    ].join(','),
  );
  return lines.join('\r\n');
}
