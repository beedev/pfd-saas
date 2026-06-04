/**
 * Sprint 6.2c — Shared PDF header.
 *
 * Top bar present on every report: title, optional FY tag, and
 * "Generated <ISO timestamp>" right-aligned. Uses default Helvetica
 * (no network font fetch) so the renderer never blocks on a CDN
 * round-trip — important for the sub-second timing the /reports hub
 * download experience promises.
 */

import React from 'react';
import { StyleSheet, Text, View } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderBottom: '1pt solid #1f2937',
    paddingBottom: 6,
    marginBottom: 10,
  },
  titleBlock: { flex: 1 },
  title: { fontSize: 14, fontWeight: 'bold', color: '#111827' },
  subtitle: { fontSize: 8, color: '#6b7280', marginTop: 1 },
  ts: { fontSize: 7, color: '#6b7280', textAlign: 'right' },
});

export interface ReportHeaderProps {
  title: string;
  fyLabel?: string;
  generatedAt: Date;
}

export function ReportHeader({ title, fyLabel, generatedAt }: ReportHeaderProps) {
  return (
    <View style={styles.header} fixed>
      <View style={styles.titleBlock}>
        <Text style={styles.title}>{title}</Text>
        {fyLabel ? <Text style={styles.subtitle}>{fyLabel}</Text> : null}
      </View>
      <Text style={styles.ts}>Generated {generatedAt.toISOString()}</Text>
    </View>
  );
}
