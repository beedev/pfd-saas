/**
 * Sprint 6.2c — Form 26AS reconciliation PDF.
 *
 * Header summary trio (books TDS / 26AS TDS / delta), then the two
 * source tables stacked: books (from tds_credits) and uploads (from
 * form_26as_uploads). A per-TAN delta table at the bottom highlights
 * any TAN whose books TDS doesn't match what was reported.
 */

import React from 'react';
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { ReportHeader } from './components/Header';
import { ReportFooter } from './components/Footer';
import { ReportTable } from './components/ReportTable';
import { inr, inrSigned, fyLabel } from '../format-utils';
import type { Form26asReconReportData } from '../data/fetchForm26asRecon';

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

export const Form26asReconPdf = ({ data }: { data: Form26asReconReportData }) => (
  <Document>
    <Page size="A4" style={styles.page} orientation="landscape">
      <ReportHeader
        title="Form 26AS Reconciliation"
        fyLabel={fyLabel(data.fy)}
        generatedAt={new Date()}
      />

      <View style={styles.totalsRow}>
        <View style={styles.tile}>
          <Text style={styles.tileLabel}>Books (Our TDS)</Text>
          <Text style={styles.tileValue}>{inr(data.totals.booksTdsPaisa)}</Text>
        </View>
        <View style={styles.tile}>
          <Text style={styles.tileLabel}>Form 26AS (Govt TDS)</Text>
          <Text style={styles.tileValue}>{inr(data.totals.gov26asTdsPaisa)}</Text>
        </View>
        <View style={styles.tile}>
          <Text style={styles.tileLabel}>Delta (Books − Govt)</Text>
          <Text style={styles.tileValue}>{inrSigned(data.totals.deltaPaisa)}</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Books TDS (from tds_credits)</Text>
      <ReportTable
        columns={[
          { header: 'Deductor', flex: 4, render: (r) => r.deductorName },
          { header: 'TAN', flex: 3, render: (r) => r.deductorTan },
          { header: 'Section', flex: 2, render: (r) => r.section },
          {
            header: 'Income',
            flex: 3,
            alignRight: true,
            render: (r) => inr(r.incomePaisa),
          },
          {
            header: 'TDS',
            flex: 3,
            alignRight: true,
            render: (r) => inr(r.tdsPaisa),
          },
          { header: 'Reconciled', flex: 2, render: (r) => (r.reconciled ? 'Yes' : 'No') },
        ]}
        rows={data.booksRows}
        totalRow={['', '', 'Total', '', inr(data.totals.booksTdsPaisa), '']}
      />

      <Text style={styles.sectionTitle}>Form 26AS Uploads</Text>
      <ReportTable
        columns={[
          { header: 'Upload', flex: 4, render: (r) => r.deductorName },
          {
            header: 'Income (Total)',
            flex: 3,
            alignRight: true,
            render: (r) => inr(r.incomePaisa),
          },
          {
            header: 'TDS (Total)',
            flex: 3,
            alignRight: true,
            render: (r) => inr(r.tdsPaisa),
          },
        ]}
        rows={data.uploadRows}
      />

      <Text style={styles.sectionTitle}>Per-TAN Delta</Text>
      <ReportTable
        columns={[
          { header: 'TAN', flex: 3, render: (r) => r.tan },
          { header: 'Deductor', flex: 4, render: (r) => r.deductorName },
          {
            header: 'Books TDS',
            flex: 3,
            alignRight: true,
            render: (r) => inr(r.booksTdsPaisa),
          },
          {
            header: '26AS TDS',
            flex: 3,
            alignRight: true,
            render: (r) => inr(r.gov26asTdsPaisa),
          },
          {
            header: 'Delta',
            flex: 3,
            alignRight: true,
            render: (r) => inrSigned(r.deltaPaisa),
          },
        ]}
        rows={data.deltas}
      />

      <ReportFooter />
    </Page>
  </Document>
);
