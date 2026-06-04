/**
 * Sprint 6.2c — Annual Cashflow PDF.
 *
 * Landscape orientation — 12 month columns + line-item column +
 * total column. Income section, Expense section, and Net row at
 * the bottom of each section.
 *
 * Cell-level INR is rendered in the compact rupee form (no symbol
 * for grid cells; only the line-item label has a sign hint) to keep
 * the 12-column grid readable. The summary row at top + the
 * per-section totals carry the formal ₹-prefixed values.
 */

import React from 'react';
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { ReportHeader } from './components/Header';
import { ReportFooter } from './components/Footer';
import { inr, inrSigned, fyLabel } from '../format-utils';
import type { CashflowReportData, CashflowRow } from '../data/fetchCashflow';

const styles = StyleSheet.create({
  page: { padding: 18, paddingBottom: 36, fontFamily: 'Helvetica' },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#374151',
    marginTop: 10,
    marginBottom: 4,
  },
  totalsRow: { flexDirection: 'row', marginBottom: 6 },
  tile: {
    flex: 1,
    padding: 5,
    marginHorizontal: 3,
    border: '1pt solid #e5e7eb',
    borderRadius: 3,
  },
  tileLabel: { fontSize: 7, color: '#6b7280' },
  tileValue: { fontSize: 9, fontWeight: 'bold', color: '#111827' },
  grid: { width: '100%' },
  headerRow: {
    flexDirection: 'row',
    backgroundColor: '#f3f4f6',
    borderBottom: '1pt solid #d1d5db',
    paddingVertical: 3,
    paddingHorizontal: 2,
  },
  headerCell: { fontSize: 7, fontWeight: 'bold', color: '#374151' },
  row: {
    flexDirection: 'row',
    paddingVertical: 2,
    paddingHorizontal: 2,
    borderBottom: '0.5pt solid #f3f4f6',
  },
  rowAlt: { backgroundColor: '#fafafa' },
  cell: { fontSize: 7, color: '#111827' },
  totalRow: {
    flexDirection: 'row',
    backgroundColor: '#fef3c7',
    borderTop: '1pt solid #d1d5db',
    paddingVertical: 3,
    paddingHorizontal: 2,
  },
  netRow: {
    flexDirection: 'row',
    backgroundColor: '#dbeafe',
    borderTop: '1pt solid #93c5fd',
    paddingVertical: 3,
    paddingHorizontal: 2,
  },
  totalCell: { fontSize: 7, fontWeight: 'bold', color: '#111827' },
});

const LABEL_FLEX = 3;
const MONTH_FLEX = 1;
const TOTAL_FLEX = 1.4;

/** Compact rupee for grid cells — no symbol, no decimals, lakh
 *  notation when the value is large. Keeps the 12-column grid from
 *  overflowing. */
function gridCell(paisa: number): string {
  if (paisa === 0) return '–';
  const rupees = paisa / 100;
  if (Math.abs(rupees) >= 100000) {
    return `${(rupees / 100000).toFixed(1)}L`;
  }
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(rupees);
}

function CashflowGrid({
  title,
  rows,
  monthlyTotals,
  totalLabel,
  totalPaisa,
  months,
}: {
  title: string;
  rows: CashflowRow[];
  monthlyTotals: number[];
  totalLabel: string;
  totalPaisa: number;
  months: { label: string }[];
}) {
  return (
    <>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.grid}>
        <View style={styles.headerRow}>
          <Text style={[styles.headerCell, { flex: LABEL_FLEX }]}>Line Item</Text>
          {months.map((m, i) => (
            <Text
              key={i}
              style={[styles.headerCell, { flex: MONTH_FLEX, textAlign: 'right' }]}
            >
              {m.label.split(' ')[0]}
            </Text>
          ))}
          <Text style={[styles.headerCell, { flex: TOTAL_FLEX, textAlign: 'right' }]}>
            Total
          </Text>
        </View>
        {rows.length === 0 ? (
          <View style={styles.row}>
            <Text style={[styles.cell, { flex: LABEL_FLEX, color: '#9ca3af' }]}>
              No data available.
            </Text>
          </View>
        ) : (
          rows.map((r, ri) => (
            <View key={ri} style={[styles.row, ...(ri % 2 === 1 ? [styles.rowAlt] : [])]}>
              <Text style={[styles.cell, { flex: LABEL_FLEX }]}>{r.label}</Text>
              {r.monthly.map((v, mi) => (
                <Text
                  key={mi}
                  style={[styles.cell, { flex: MONTH_FLEX, textAlign: 'right' }]}
                >
                  {gridCell(v)}
                </Text>
              ))}
              <Text
                style={[
                  styles.cell,
                  { flex: TOTAL_FLEX, textAlign: 'right', fontWeight: 'bold' },
                ]}
              >
                {gridCell(r.totalPaisa)}
              </Text>
            </View>
          ))
        )}
        <View style={styles.totalRow}>
          <Text style={[styles.totalCell, { flex: LABEL_FLEX }]}>{totalLabel}</Text>
          {monthlyTotals.map((v, mi) => (
            <Text
              key={mi}
              style={[styles.totalCell, { flex: MONTH_FLEX, textAlign: 'right' }]}
            >
              {gridCell(v)}
            </Text>
          ))}
          <Text style={[styles.totalCell, { flex: TOTAL_FLEX, textAlign: 'right' }]}>
            {gridCell(totalPaisa)}
          </Text>
        </View>
      </View>
    </>
  );
}

export const CashflowPdf = ({ data }: { data: CashflowReportData }) => (
  <Document>
    <Page size="A4" style={styles.page} orientation="landscape">
      <ReportHeader
        title="Annual Cashflow Statement"
        fyLabel={fyLabel(data.fy)}
        generatedAt={new Date()}
      />

      <View style={styles.totalsRow}>
        <View style={styles.tile}>
          <Text style={styles.tileLabel}>Income (FY Total)</Text>
          <Text style={styles.tileValue}>{inr(data.totals.incomeTotalPaisa)}</Text>
        </View>
        <View style={styles.tile}>
          <Text style={styles.tileLabel}>Expenses (FY Total)</Text>
          <Text style={styles.tileValue}>{inr(data.totals.expenseTotalPaisa)}</Text>
        </View>
        <View style={styles.tile}>
          <Text style={styles.tileLabel}>Net (Income − Expenses)</Text>
          <Text style={styles.tileValue}>{inrSigned(data.totals.netTotalPaisa)}</Text>
        </View>
      </View>

      <CashflowGrid
        title="Income"
        rows={data.income}
        monthlyTotals={data.totals.incomeMonthly}
        totalLabel="Income Total"
        totalPaisa={data.totals.incomeTotalPaisa}
        months={data.months}
      />

      <CashflowGrid
        title="Expenses"
        rows={data.expenses}
        monthlyTotals={data.totals.expenseMonthly}
        totalLabel="Expense Total"
        totalPaisa={data.totals.expenseTotalPaisa}
        months={data.months}
      />

      <View style={styles.netRow}>
        <Text style={[styles.totalCell, { flex: LABEL_FLEX }]}>Net (Income − Expenses)</Text>
        {data.totals.netMonthly.map((v, mi) => (
          <Text
            key={mi}
            style={[styles.totalCell, { flex: MONTH_FLEX, textAlign: 'right' }]}
          >
            {gridCell(v)}
          </Text>
        ))}
        <Text style={[styles.totalCell, { flex: TOTAL_FLEX, textAlign: 'right' }]}>
          {gridCell(data.totals.netTotalPaisa)}
        </Text>
      </View>

      <ReportFooter />
    </Page>
  </Document>
);
