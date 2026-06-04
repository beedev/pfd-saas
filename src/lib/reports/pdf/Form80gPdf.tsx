/**
 * Sprint 6.2c — 80G donation log PDF.
 *
 * Single table with all donations, gross + deductible totals.
 */

import React from 'react';
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { ReportHeader } from './components/Header';
import { ReportFooter } from './components/Footer';
import { ReportTable } from './components/ReportTable';
import { inr, fyLabel, fmtDate } from '../format-utils';
import type { Form80gReportData } from '../data/fetchForm80g';

const styles = StyleSheet.create({
  page: { padding: 28, paddingBottom: 36, fontFamily: 'Helvetica' },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#374151',
    marginTop: 12,
    marginBottom: 4,
  },
  totalsRow: { flexDirection: 'row', marginBottom: 6 },
  tile: {
    flex: 1,
    padding: 6,
    marginHorizontal: 3,
    border: '1pt solid #e5e7eb',
    borderRadius: 3,
  },
  tileLabel: { fontSize: 7, color: '#6b7280' },
  tileValue: { fontSize: 10, fontWeight: 'bold', color: '#111827' },
});

export const Form80gPdf = ({ data }: { data: Form80gReportData }) => (
  <Document>
    <Page size="A4" style={styles.page} orientation="landscape">
      <ReportHeader
        title="80G Donation Log"
        fyLabel={fyLabel(data.fy)}
        generatedAt={new Date()}
      />

      <View style={styles.totalsRow}>
        <View style={styles.tile}>
          <Text style={styles.tileLabel}>Total Donations</Text>
          <Text style={styles.tileValue}>{inr(data.totals.grossPaisa)}</Text>
        </View>
        <View style={styles.tile}>
          <Text style={styles.tileLabel}>Deductible (Section 80G)</Text>
          <Text style={styles.tileValue}>{inr(data.totals.deductiblePaisa)}</Text>
        </View>
        <View style={styles.tile}>
          <Text style={styles.tileLabel}>Number of Donations</Text>
          <Text style={styles.tileValue}>{data.donations.length}</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Donations</Text>
      <ReportTable
        columns={[
          { header: 'Date', flex: 2, render: (r) => fmtDate(r.date) },
          { header: 'Organization', flex: 4, render: (r) => r.organization },
          { header: 'PAN', flex: 2, render: (r) => r.pan },
          { header: 'Mode', flex: 1, render: (r) => r.mode },
          { header: 'Category', flex: 2, render: (r) => r.category },
          {
            header: 'Amount',
            flex: 2,
            alignRight: true,
            render: (r) => inr(r.amountPaisa),
          },
          {
            header: 'Eligible %',
            flex: 1,
            alignRight: true,
            render: (r) => `${r.eligibilityPct}%`,
          },
          {
            header: 'Deductible',
            flex: 2,
            alignRight: true,
            render: (r) => inr(r.deductiblePaisa),
          },
        ]}
        rows={data.donations}
        totalRow={[
          '',
          'Total',
          '',
          '',
          '',
          inr(data.totals.grossPaisa),
          '',
          inr(data.totals.deductiblePaisa),
        ]}
      />

      <ReportFooter />
    </Page>
  </Document>
);
