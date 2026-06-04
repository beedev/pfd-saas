/**
 * Sprint 6.2e — Income Summary CSV.
 *
 * Flat long-format: section | line | amount_rupees.
 */

import { csvEscape } from '../format-utils';
import type { IncomeSummaryReportData } from '../data/fetchIncomeSummary';

export function buildIncomeSummaryCsv(data: IncomeSummaryReportData): string {
  const lines: string[] = ['Section,Line,Amount (₹)'];
  const add = (section: string, line: string, paisa: number) =>
    lines.push(
      [csvEscape(section), csvEscape(line), (paisa / 100).toFixed(2)].join(','),
    );

  add('Salary', 'Gross', data.salary.grossPaisa);
  add('Salary', 'Exemptions', data.salary.exemptionsPaisa);
  add('Salary', 'Taxable', data.salary.taxablePaisa);
  add('Salary', 'TDS', data.salary.tdsPaisa);
  for (const e of data.salary.employers) {
    add('Salary', `${e.employerName} (${e.employerTan})`, e.grossPaisa);
  }
  add('Capital Gains', 'LTCG', data.capitalGains.ltcgPaisa);
  add('Capital Gains', 'STCG', data.capitalGains.stcgPaisa);
  add('Capital Gains', 'Tax', data.capitalGains.totalTaxPaisa);
  add('Other Income', 'Interest', data.otherIncome.interestPaisa);
  add('Other Income', 'Dividends', data.otherIncome.dividendsPaisa);
  add('Other Income', 'Rental', data.otherIncome.rentalPaisa);
  add('Other Income', 'Other', data.otherIncome.otherPaisa);
  add('Total', 'Grand Total', data.totals.grandTotalPaisa);
  return lines.join('\r\n');
}
