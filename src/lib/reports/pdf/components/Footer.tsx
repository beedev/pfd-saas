/**
 * Sprint 6.2c — Shared PDF footer.
 *
 * Bottom bar fixed on every page with "pfd-saas v0.6.2" left and
 * page X of Y right. `render({pageNumber, totalPages})` is a
 * @react-pdf/renderer hook that runs after layout so totalPages is
 * available — must use the `render` prop, not children.
 */

import React from 'react';
import { StyleSheet, Text, View } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  footer: {
    position: 'absolute',
    bottom: 18,
    left: 24,
    right: 24,
    flexDirection: 'row',
    borderTop: '1pt solid #e5e7eb',
    paddingTop: 4,
  },
  product: { flex: 1, fontSize: 7, color: '#9ca3af' },
  pageNo: { fontSize: 7, color: '#9ca3af', textAlign: 'right' },
});

export function ReportFooter() {
  return (
    <View style={styles.footer} fixed>
      <Text style={styles.product}>pfd-saas v0.6.2</Text>
      <Text
        style={styles.pageNo}
        render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
      />
    </View>
  );
}
