/**
 * Sprint 6.2e — Capital Gains CSV.
 *
 * Flat per-entry: type | asset | sold_date | cost | sale | gain |
 * exemption | taxable | tax_rate | tax_amount | notes.
 */

import { csvEscape } from '../format-utils';
import type { CapitalGainsReportData } from '../data/fetchCapitalGains';

export function buildCapitalGainsCsv(data: CapitalGainsReportData): string {
  const lines: string[] = [
    'Type,Asset Name,Purchase Date,Sale Date,Cost Indexed (₹),Sale Price (₹),Gain (₹),Exemption (₹),Taxable (₹),Tax Rate (%),Tax (₹),Notes',
  ];
  for (const e of data.ltcg) {
    lines.push(
      [
        csvEscape('LTCG'),
        csvEscape(e.assetName),
        csvEscape(e.purchaseDate),
        csvEscape(e.saleDate),
        (e.purchasePaisa / 100).toFixed(2),
        (e.salePaisa / 100).toFixed(2),
        (e.gainPaisa / 100).toFixed(2),
        (e.exemptionPaisa / 100).toFixed(2),
        (e.taxablePaisa / 100).toFixed(2),
        e.taxRate.toFixed(2),
        (e.taxPaisa / 100).toFixed(2),
        csvEscape(e.notes),
      ].join(','),
    );
  }
  for (const e of data.stcg) {
    lines.push(
      [
        csvEscape('STCG'),
        csvEscape(e.assetName),
        csvEscape(e.purchaseDate),
        csvEscape(e.saleDate),
        (e.purchasePaisa / 100).toFixed(2),
        (e.salePaisa / 100).toFixed(2),
        (e.gainPaisa / 100).toFixed(2),
        (e.exemptionPaisa / 100).toFixed(2),
        (e.taxablePaisa / 100).toFixed(2),
        e.taxRate.toFixed(2),
        (e.taxPaisa / 100).toFixed(2),
        csvEscape(e.notes),
      ].join(','),
    );
  }
  return lines.join('\r\n');
}
