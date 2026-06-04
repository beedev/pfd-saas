/**
 * Sprint 6.2e — Net Worth CSV.
 *
 * Flat shape: category | item | value_rupees.
 *
 * Last row is a synthetic "TOTAL · Net Worth · <net>" so a quick
 * spreadsheet import is summable without recomputing.
 */

import { csvEscape, inr } from '../format-utils';
import type { NetWorthReportData } from '../data/fetchNetWorth';

export function buildNetWorthCsv(data: NetWorthReportData): string {
  const lines: string[] = ['Category,Item,Value (₹)'];
  for (const c of data.categories) {
    for (const i of c.items) {
      lines.push(
        [csvEscape(c.name), csvEscape(i.name), (i.valuePaisa / 100).toFixed(2)].join(','),
      );
    }
    // Category subtotal row even when items is empty so the consumer
    // can still see the aggregate from a forex/snapshot-only category.
    lines.push(
      [csvEscape(c.name), csvEscape('Subtotal'), (c.valuePaisa / 100).toFixed(2)].join(','),
    );
  }
  lines.push(
    [
      csvEscape('TOTAL'),
      csvEscape(`Net Worth (${inr(data.totals.netPaisa)})`),
      (data.totals.netPaisa / 100).toFixed(2),
    ].join(','),
  );
  return lines.join('\r\n');
}
