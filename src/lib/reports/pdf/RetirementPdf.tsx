/**
 * Sprint 6.2c — Retirement projection PDF.
 *
 * Assumptions block + year-by-year corpus trajectory.
 */

import React from 'react';
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { ReportHeader } from './components/Header';
import { ReportFooter } from './components/Footer';
import { ReportTable } from './components/ReportTable';
import { inr } from '../format-utils';
import type { RetirementProjectionReportData } from '../data/fetchRetirementProjection';

const styles = StyleSheet.create({
  page: { padding: 28, paddingBottom: 36, fontFamily: 'Helvetica' },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#374151',
    marginTop: 12,
    marginBottom: 4,
  },
  assumptionsGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  assumption: { width: '25%', padding: 4 },
  assumptionLabel: { fontSize: 7, color: '#6b7280' },
  assumptionValue: { fontSize: 9, fontWeight: 'bold', color: '#111827' },
  corpusTile: {
    flexDirection: 'row',
    padding: 8,
    border: '1pt solid #e5e7eb',
    borderRadius: 4,
    marginBottom: 10,
  },
  corpusLabel: { flex: 1, fontSize: 9, color: '#374151' },
  corpusValue: { fontSize: 11, fontWeight: 'bold', color: '#111827', textAlign: 'right' },
});

export const RetirementPdf = ({ data }: { data: RetirementProjectionReportData }) => (
  <Document>
    <Page size="A4" style={styles.page} orientation="landscape">
      <ReportHeader title="Retirement Projection" generatedAt={new Date()} />

      <Text style={styles.sectionTitle}>Assumptions</Text>
      <View style={styles.assumptionsGrid}>
        <View style={styles.assumption}>
          <Text style={styles.assumptionLabel}>Current Age</Text>
          <Text style={styles.assumptionValue}>{data.assumptions.currentAge}</Text>
        </View>
        <View style={styles.assumption}>
          <Text style={styles.assumptionLabel}>Target Age</Text>
          <Text style={styles.assumptionValue}>{data.assumptions.targetAge}</Text>
        </View>
        <View style={styles.assumption}>
          <Text style={styles.assumptionLabel}>Retirement Duration</Text>
          <Text style={styles.assumptionValue}>
            {data.assumptions.retirementDurationYears} years
          </Text>
        </View>
        <View style={styles.assumption}>
          <Text style={styles.assumptionLabel}>Monthly Expense</Text>
          <Text style={styles.assumptionValue}>
            ₹{data.assumptions.monthlyExpenseRupees.toLocaleString('en-IN')}
          </Text>
        </View>
        <View style={styles.assumption}>
          <Text style={styles.assumptionLabel}>Inflation</Text>
          <Text style={styles.assumptionValue}>{data.assumptions.inflationPct}%</Text>
        </View>
        <View style={styles.assumption}>
          <Text style={styles.assumptionLabel}>Pre-Retirement Return</Text>
          <Text style={styles.assumptionValue}>{data.assumptions.expectedReturnPct}%</Text>
        </View>
        <View style={styles.assumption}>
          <Text style={styles.assumptionLabel}>Post-Retirement Return</Text>
          <Text style={styles.assumptionValue}>
            {data.assumptions.postRetirementReturnPct}%
          </Text>
        </View>
      </View>

      <View style={styles.corpusTile}>
        <Text style={styles.corpusLabel}>Starting Corpus (Today)</Text>
        <Text style={styles.corpusValue}>{inr(data.startingCorpusPaisa)}</Text>
      </View>

      <Text style={styles.sectionTitle}>Year-by-Year Projection</Text>
      <ReportTable
        columns={[
          { header: 'Year', flex: 1, alignRight: true, render: (r) => String(r.year) },
          { header: 'Age', flex: 1, alignRight: true, render: (r) => String(r.age) },
          {
            header: 'Corpus Start',
            flex: 3,
            alignRight: true,
            render: (r) => inr(r.corpusStartPaisa),
          },
          {
            header: 'Contributions',
            flex: 2,
            alignRight: true,
            render: (r) => inr(r.contributionsPaisa),
          },
          {
            header: 'Returns',
            flex: 2,
            alignRight: true,
            render: (r) => inr(r.returnsPaisa),
          },
          {
            header: 'Withdrawals',
            flex: 2,
            alignRight: true,
            render: (r) => inr(r.withdrawalsPaisa),
          },
          {
            header: 'Corpus End',
            flex: 3,
            alignRight: true,
            render: (r) => inr(r.corpusEndPaisa),
          },
        ]}
        rows={data.projection}
      />

      <ReportFooter />
    </Page>
  </Document>
);
