/**
 * Sprint 6.2c — Net Worth statement PDF.
 *
 * Two sections:
 *   1. Top-line totals — assets, liabilities, net
 *   2. Per-category breakdown — category subtotal + bulleted items
 *
 * A4 portrait, single-page where possible (wraps with shared footer).
 */

import React from 'react';
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { ReportHeader } from './components/Header';
import { ReportFooter } from './components/Footer';
import { ReportTable } from './components/ReportTable';
import { inr, fmtDate } from '../format-utils';
import type { NetWorthReportData } from '../data/fetchNetWorth';

const styles = StyleSheet.create({
  page: { padding: 28, paddingBottom: 36, fontFamily: 'Helvetica' },
  totalsRow: { flexDirection: 'row', marginBottom: 14 },
  totalsTile: {
    flex: 1,
    padding: 8,
    marginHorizontal: 4,
    border: '1pt solid #e5e7eb',
    borderRadius: 4,
  },
  totalsLabel: { fontSize: 8, color: '#6b7280', marginBottom: 2 },
  totalsValue: { fontSize: 12, fontWeight: 'bold', color: '#111827' },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#374151',
    marginTop: 12,
    marginBottom: 4,
  },
});

export const NetWorthPdf = ({ data }: { data: NetWorthReportData }) => (
  <Document>
    <Page size="A4" style={styles.page}>
      <ReportHeader
        title="Net Worth Statement"
        fyLabel={`As of ${fmtDate(data.asOfDate)}`}
        generatedAt={new Date()}
      />

      {/* Top-line totals */}
      <View style={styles.totalsRow}>
        <View style={styles.totalsTile}>
          <Text style={styles.totalsLabel}>Total Assets</Text>
          <Text style={styles.totalsValue}>{inr(data.totals.assetsPaisa)}</Text>
        </View>
        <View style={styles.totalsTile}>
          <Text style={styles.totalsLabel}>Total Liabilities</Text>
          <Text style={styles.totalsValue}>{inr(data.totals.liabilitiesPaisa)}</Text>
        </View>
        <View style={styles.totalsTile}>
          <Text style={styles.totalsLabel}>Net Worth</Text>
          <Text style={styles.totalsValue}>{inr(data.totals.netPaisa)}</Text>
        </View>
      </View>

      {/* Per-category breakdown */}
      <Text style={styles.sectionTitle}>Breakdown by Category</Text>
      <ReportTable
        columns={[
          { header: 'Category', flex: 3, render: (r: { name: string }) => r.name },
          {
            header: 'Value',
            flex: 2,
            alignRight: true,
            render: (r: { valuePaisa: number }) => inr(r.valuePaisa),
          },
        ]}
        rows={data.categories.map((c) => ({ name: c.name, valuePaisa: c.valuePaisa }))}
        totalRow={['Net Worth', inr(data.totals.netPaisa)]}
      />

      {/* Per-item drill-down. Empty categories suppressed. */}
      {data.categories
        .filter((c) => c.items.length > 0)
        .map((c) => (
          <View key={c.name} wrap>
            <Text style={styles.sectionTitle}>
              {c.name} — {inr(c.valuePaisa)}
            </Text>
            <ReportTable
              columns={[
                { header: 'Item', flex: 3, render: (r: { name: string }) => r.name },
                {
                  header: 'Value',
                  flex: 2,
                  alignRight: true,
                  render: (r: { valuePaisa: number }) => inr(r.valuePaisa),
                },
              ]}
              rows={c.items}
            />
          </View>
        ))}

      <ReportFooter />
    </Page>
  </Document>
);
