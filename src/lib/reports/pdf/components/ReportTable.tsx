/**
 * Sprint 6.2c — Shared PDF table primitive.
 *
 * Lightweight grid component used by every report PDF. Each column
 * defines width (proportional flex), header text, and a render
 * function from the row object to display text. Alternating row
 * shading. Right-align flag for money columns.
 *
 * Pure layout — no formatting; callers pass already-formatted INR
 * strings via `format-utils.inr()`.
 */

import React from 'react';
import { StyleSheet, Text, View } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  table: { width: '100%' },
  headerRow: {
    flexDirection: 'row',
    backgroundColor: '#f3f4f6',
    borderBottom: '1pt solid #d1d5db',
    paddingVertical: 4,
    paddingHorizontal: 3,
  },
  headerCell: { fontSize: 8, fontWeight: 'bold', color: '#374151' },
  row: {
    flexDirection: 'row',
    paddingVertical: 3,
    paddingHorizontal: 3,
    borderBottom: '0.5pt solid #f3f4f6',
  },
  rowAlt: {
    backgroundColor: '#fafafa',
  },
  cell: { fontSize: 8, color: '#111827' },
  totalRow: {
    flexDirection: 'row',
    backgroundColor: '#fef3c7',
    borderTop: '1pt solid #d1d5db',
    paddingVertical: 4,
    paddingHorizontal: 3,
  },
  totalCell: { fontSize: 8, fontWeight: 'bold', color: '#111827' },
});

export interface ReportTableColumn<T> {
  header: string;
  /** Proportional width — sum across columns is the row width. */
  flex: number;
  /** Right-align cell content (use for money/numbers). */
  alignRight?: boolean;
  /** Render fn from the row object to a display string. */
  render: (row: T) => string;
}

export interface ReportTableProps<T> {
  columns: ReportTableColumn<T>[];
  rows: T[];
  /** Optional bottom "Total" row. Provide one string per column;
   *  use '' for empty cells. */
  totalRow?: string[];
}

export function ReportTable<T>({ columns, rows, totalRow }: ReportTableProps<T>) {
  return (
    <View style={styles.table}>
      <View style={styles.headerRow}>
        {columns.map((c, i) => (
          <Text
            key={i}
            style={[
              styles.headerCell,
              { flex: c.flex, textAlign: c.alignRight ? 'right' : 'left' },
            ]}
          >
            {c.header}
          </Text>
        ))}
      </View>
      {rows.map((row, ri) => (
        <View
          key={ri}
          style={[
            styles.row,
            ...(ri % 2 === 1 ? [styles.rowAlt] : []),
          ]}
        >
          {columns.map((c, ci) => (
            <Text
              key={ci}
              style={[
                styles.cell,
                { flex: c.flex, textAlign: c.alignRight ? 'right' : 'left' },
              ]}
            >
              {c.render(row)}
            </Text>
          ))}
        </View>
      ))}
      {totalRow ? (
        <View style={styles.totalRow}>
          {columns.map((c, ci) => (
            <Text
              key={ci}
              style={[
                styles.totalCell,
                { flex: c.flex, textAlign: c.alignRight ? 'right' : 'left' },
              ]}
            >
              {totalRow[ci] ?? ''}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}
