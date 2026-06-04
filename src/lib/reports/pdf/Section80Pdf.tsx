/**
 * Sprint 6.2c — Section 80 deductions PDF.
 *
 * Header summary, then per-section detail tables with entries.
 */

import React from 'react';
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { ReportHeader } from './components/Header';
import { ReportFooter } from './components/Footer';
import { ReportTable } from './components/ReportTable';
import { inr, fyLabel, fmtDate } from '../format-utils';
import type { Section80ReportData } from '../data/fetchSection80';

const styles = StyleSheet.create({
  page: { padding: 28, paddingBottom: 36, fontFamily: 'Helvetica' },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#374151',
    marginTop: 12,
    marginBottom: 4,
  },
  sectionDesc: { fontSize: 7, color: '#6b7280', marginBottom: 4 },
  capPill: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  capPillLabel: { fontSize: 8, color: '#6b7280' },
  capPillValue: { fontSize: 8, color: '#111827', marginLeft: 4 },
});

export const Section80Pdf = ({ data }: { data: Section80ReportData }) => (
  <Document>
    <Page size="A4" style={styles.page}>
      <ReportHeader
        title="Section 80 Deductions"
        fyLabel={fyLabel(data.fy)}
        generatedAt={new Date()}
      />

      <Text style={styles.sectionTitle}>Summary</Text>
      <ReportTable
        columns={[
          { header: 'Section', flex: 2, render: (r) => r.section },
          { header: 'Label', flex: 4, render: (r) => r.label },
          {
            header: 'Claimed',
            flex: 2,
            alignRight: true,
            render: (r) => inr(r.claimedPaisa),
          },
          {
            header: 'Cap',
            flex: 2,
            alignRight: true,
            render: (r) => (r.capPaisa != null ? inr(r.capPaisa) : 'No cap'),
          },
          {
            header: 'Used',
            flex: 1,
            alignRight: true,
            render: (r) => `${r.usedPct.toFixed(0)}%`,
          },
        ]}
        rows={data.rows}
        totalRow={[
          'Total',
          '',
          inr(data.totals.claimedPaisa),
          inr(data.totals.cappedPaisa),
          '',
        ]}
      />

      {data.rows.map((row) => (
        <View key={row.section} wrap>
          <Text style={styles.sectionTitle}>
            {row.section} — {row.label}
          </Text>
          <Text style={styles.sectionDesc}>{row.description}</Text>
          <ReportTable
            columns={[
              { header: 'Description', flex: 4, render: (e) => e.description },
              { header: 'Recipient', flex: 3, render: (e) => e.recipient },
              {
                header: 'Date',
                flex: 2,
                render: (e) => fmtDate(e.paymentDate),
              },
              {
                header: 'Amount',
                flex: 2,
                alignRight: true,
                render: (e) => inr(e.amountPaisa),
              },
            ]}
            rows={row.entries}
          />
        </View>
      ))}

      <ReportFooter />
    </Page>
  </Document>
);
