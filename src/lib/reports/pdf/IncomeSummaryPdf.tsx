/**
 * Sprint 6.2c — Income summary PDF.
 *
 * Single-page (A4 portrait) summary showing per-source income with
 * sub-tables for salary employers and capital gains breakdown.
 */

import React from 'react';
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { ReportHeader } from './components/Header';
import { ReportFooter } from './components/Footer';
import { ReportTable } from './components/ReportTable';
import { inr, fyLabel } from '../format-utils';
import type { IncomeSummaryReportData } from '../data/fetchIncomeSummary';

const styles = StyleSheet.create({
  page: { padding: 28, paddingBottom: 36, fontFamily: 'Helvetica' },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#374151',
    marginTop: 12,
    marginBottom: 4,
  },
  grandTotal: {
    flexDirection: 'row',
    backgroundColor: '#dbeafe',
    border: '1pt solid #93c5fd',
    padding: 8,
    marginTop: 14,
    borderRadius: 4,
  },
  grandLabel: { flex: 1, fontSize: 11, fontWeight: 'bold', color: '#1e3a8a' },
  grandValue: { fontSize: 11, fontWeight: 'bold', color: '#1e3a8a', textAlign: 'right' },
});

export const IncomeSummaryPdf = ({ data }: { data: IncomeSummaryReportData }) => (
  <Document>
    <Page size="A4" style={styles.page}>
      <ReportHeader
        title="Income Summary"
        fyLabel={fyLabel(data.fy)}
        generatedAt={new Date()}
      />

      <Text style={styles.sectionTitle}>Salary</Text>
      <ReportTable
        columns={[
          { header: 'Line Item', flex: 3, render: (r: { label: string }) => r.label },
          {
            header: 'Amount',
            flex: 2,
            alignRight: true,
            render: (r: { value: number }) => inr(r.value),
          },
        ]}
        rows={[
          { label: 'Gross Salary', value: data.salary.grossPaisa },
          { label: 'Exemptions', value: data.salary.exemptionsPaisa },
          { label: 'Taxable Salary', value: data.salary.taxablePaisa },
          { label: 'TDS Deducted', value: data.salary.tdsPaisa },
        ]}
      />

      {data.salary.employers.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>Employers</Text>
          <ReportTable
            columns={[
              { header: 'Employer', flex: 3, render: (r) => r.employerName },
              { header: 'TAN', flex: 2, render: (r) => r.employerTan },
              {
                header: 'Gross',
                flex: 2,
                alignRight: true,
                render: (r) => inr(r.grossPaisa),
              },
            ]}
            rows={data.salary.employers}
          />
        </>
      ) : null}

      <Text style={styles.sectionTitle}>Capital Gains</Text>
      <ReportTable
        columns={[
          { header: 'Type', flex: 3, render: (r: { label: string }) => r.label },
          {
            header: 'Amount',
            flex: 2,
            alignRight: true,
            render: (r: { value: number }) => inr(r.value),
          },
        ]}
        rows={[
          { label: 'Long-Term Capital Gains', value: data.capitalGains.ltcgPaisa },
          { label: 'Short-Term Capital Gains', value: data.capitalGains.stcgPaisa },
          { label: 'Total CG Tax', value: data.capitalGains.totalTaxPaisa },
        ]}
      />

      <Text style={styles.sectionTitle}>Other Income</Text>
      <ReportTable
        columns={[
          { header: 'Source', flex: 3, render: (r: { label: string }) => r.label },
          {
            header: 'Amount',
            flex: 2,
            alignRight: true,
            render: (r: { value: number }) => inr(r.value),
          },
        ]}
        rows={[
          { label: 'Interest Income', value: data.otherIncome.interestPaisa },
          { label: 'Dividends', value: data.otherIncome.dividendsPaisa },
          { label: 'Rental Income', value: data.otherIncome.rentalPaisa },
          { label: 'Other', value: data.otherIncome.otherPaisa },
        ]}
        totalRow={['Other Income Total', inr(data.otherIncome.totalPaisa)]}
      />

      <View style={styles.grandTotal}>
        <Text style={styles.grandLabel}>Grand Total (Salary + CG + Other)</Text>
        <Text style={styles.grandValue}>{inr(data.totals.grandTotalPaisa)}</Text>
      </View>

      <ReportFooter />
    </Page>
  </Document>
);
