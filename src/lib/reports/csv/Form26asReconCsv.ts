/**
 * Sprint 6.2e — Form 26AS reconciliation CSV.
 *
 * Long-format diff: tan | deductor | section | source | income | tds | reconciled | notes.
 *
 * Source = BOOKS for tds_credits rows, 26AS for form_26as_uploads.
 * Per-TAN deltas appended at the bottom under source=DELTA.
 */

import { csvEscape } from '../format-utils';
import type { Form26asReconReportData } from '../data/fetchForm26asRecon';

export function buildForm26asReconCsv(data: Form26asReconReportData): string {
  const lines: string[] = [
    'TAN,Deductor,Section,Source,Income (₹),TDS (₹),Reconciled,Notes',
  ];
  for (const r of data.booksRows) {
    lines.push(
      [
        csvEscape(r.deductorTan),
        csvEscape(r.deductorName),
        csvEscape(r.section),
        csvEscape(r.source),
        (r.incomePaisa / 100).toFixed(2),
        (r.tdsPaisa / 100).toFixed(2),
        r.reconciled ? 'Y' : 'N',
        csvEscape(r.notes),
      ].join(','),
    );
  }
  for (const r of data.uploadRows) {
    lines.push(
      [
        csvEscape(r.deductorTan),
        csvEscape(r.deductorName),
        csvEscape(r.section),
        csvEscape(r.source),
        (r.incomePaisa / 100).toFixed(2),
        (r.tdsPaisa / 100).toFixed(2),
        '',
        csvEscape(r.notes),
      ].join(','),
    );
  }
  for (const d of data.deltas) {
    lines.push(
      [
        csvEscape(d.tan),
        csvEscape(d.deductorName),
        '',
        csvEscape('DELTA'),
        '',
        (d.deltaPaisa / 100).toFixed(2),
        '',
        csvEscape(
          `books=${(d.booksTdsPaisa / 100).toFixed(2)} 26as=${(d.gov26asTdsPaisa / 100).toFixed(2)}`,
        ),
      ].join(','),
    );
  }
  return lines.join('\r\n');
}
