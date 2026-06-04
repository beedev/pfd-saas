/**
 * Sprint 6.2d — Capital Gains Excel workbook.
 *
 * Sheets:
 *   Summary   — totals (LTCG / STCG / exemption / taxable / tax)
 *   LTCG      — per-entry LTCG rows
 *   STCG      — per-entry STCG rows
 *   Metadata
 */

import * as XLSX from 'xlsx';
import type {
  CapitalGainsReportData,
  CapitalGainsEntry,
} from '../data/fetchCapitalGains';
import { makeSheet, metadataSheet, rs, writeWorkbook } from './_helpers';

function entryRows(entries: CapitalGainsEntry[]): (string | number)[][] {
  const header = [
    'Asset Type',
    'Asset Name',
    'Purchase Date',
    'Sale Date',
    'Cost (Indexed) (₹)',
    'Sale Price (₹)',
    'Gain (₹)',
    'Exemption (₹)',
    'Taxable (₹)',
    'Tax Rate (%)',
    'Tax (₹)',
    'Notes',
  ];
  return [
    header,
    ...entries.map((e) => [
      e.assetType,
      e.assetName,
      e.purchaseDate,
      e.saleDate,
      rs(e.purchasePaisa),
      rs(e.salePaisa),
      rs(e.gainPaisa),
      rs(e.exemptionPaisa),
      rs(e.taxablePaisa),
      e.taxRate,
      rs(e.taxPaisa),
      e.notes,
    ]),
  ];
}

export function buildCapitalGainsXlsx(
  data: CapitalGainsReportData,
  userId: string,
): Buffer {
  const wb = XLSX.utils.book_new();

  // Summary
  XLSX.utils.book_append_sheet(
    wb,
    makeSheet({
      name: 'Summary',
      rows: [
        ['Bucket', 'Amount (₹)'],
        ['LTCG (Total Gain)', rs(data.totals.ltcgGainPaisa)],
        ['STCG (Total Gain)', rs(data.totals.stcgGainPaisa)],
        ['Exemption Applied', rs(data.totals.totalExemptionPaisa)],
        ['Total Taxable', rs(data.totals.totalTaxablePaisa)],
        ['Total Tax', rs(data.totals.totalTaxPaisa)],
      ],
    }),
    'Summary',
  );

  XLSX.utils.book_append_sheet(wb, makeSheet({ name: 'LTCG', rows: entryRows(data.ltcg) }), 'LTCG');
  XLSX.utils.book_append_sheet(wb, makeSheet({ name: 'STCG', rows: entryRows(data.stcg) }), 'STCG');

  XLSX.utils.book_append_sheet(
    wb,
    metadataSheet({
      reportId: 'capital-gains',
      title: 'Capital Gains Statement',
      fy: data.fy,
      userId,
    }),
    'Metadata',
  );

  return writeWorkbook(wb);
}
