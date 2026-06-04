/**
 * Sprint 6.2c — Capital Gains statement PDF.
 *
 * Header summary tile row, then LTCG and STCG detail tables.
 */

import React from 'react';
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { ReportHeader } from './components/Header';
import { ReportFooter } from './components/Footer';
import { ReportTable } from './components/ReportTable';
import { inr, fyLabel, fmtDate } from '../format-utils';
import type { CapitalGainsReportData, CapitalGainsEntry } from '../data/fetchCapitalGains';

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

const detailCols = [
  { header: 'Asset', flex: 3, render: (r: CapitalGainsEntry) => r.assetName },
  {
    header: 'Sale Date',
    flex: 2,
    render: (r: CapitalGainsEntry) => fmtDate(r.saleDate),
  },
  {
    header: 'Cost (Indexed)',
    flex: 2,
    alignRight: true,
    render: (r: CapitalGainsEntry) => inr(r.purchasePaisa),
  },
  {
    header: 'Sale',
    flex: 2,
    alignRight: true,
    render: (r: CapitalGainsEntry) => inr(r.salePaisa),
  },
  {
    header: 'Gain',
    flex: 2,
    alignRight: true,
    render: (r: CapitalGainsEntry) => inr(r.gainPaisa),
  },
  {
    header: 'Taxable',
    flex: 2,
    alignRight: true,
    render: (r: CapitalGainsEntry) => inr(r.taxablePaisa),
  },
  {
    header: 'Tax',
    flex: 2,
    alignRight: true,
    render: (r: CapitalGainsEntry) => inr(r.taxPaisa),
  },
];

export const CapitalGainsPdf = ({ data }: { data: CapitalGainsReportData }) => (
  <Document>
    <Page size="A4" style={styles.page} orientation="landscape">
      <ReportHeader
        title="Capital Gains Statement"
        fyLabel={fyLabel(data.fy)}
        generatedAt={new Date()}
      />

      <View style={styles.totalsRow}>
        <View style={styles.tile}>
          <Text style={styles.tileLabel}>LTCG (Total Gain)</Text>
          <Text style={styles.tileValue}>{inr(data.totals.ltcgGainPaisa)}</Text>
        </View>
        <View style={styles.tile}>
          <Text style={styles.tileLabel}>STCG (Total Gain)</Text>
          <Text style={styles.tileValue}>{inr(data.totals.stcgGainPaisa)}</Text>
        </View>
        <View style={styles.tile}>
          <Text style={styles.tileLabel}>Exemption Applied</Text>
          <Text style={styles.tileValue}>{inr(data.totals.totalExemptionPaisa)}</Text>
        </View>
        <View style={styles.tile}>
          <Text style={styles.tileLabel}>Total Taxable</Text>
          <Text style={styles.tileValue}>{inr(data.totals.totalTaxablePaisa)}</Text>
        </View>
        <View style={styles.tile}>
          <Text style={styles.tileLabel}>Total Tax</Text>
          <Text style={styles.tileValue}>{inr(data.totals.totalTaxPaisa)}</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Long-Term Capital Gains (LTCG)</Text>
      <ReportTable columns={detailCols} rows={data.ltcg} />

      <Text style={styles.sectionTitle}>Short-Term Capital Gains (STCG)</Text>
      <ReportTable columns={detailCols} rows={data.stcg} />

      <ReportFooter />
    </Page>
  </Document>
);
