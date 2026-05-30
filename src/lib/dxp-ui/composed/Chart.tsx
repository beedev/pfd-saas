import React from 'react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Card, CardHeader, CardContent } from '../primitives/Card';

export interface ChartProps {
  type: 'bar' | 'line';
  data: Record<string, unknown>[];
  xKey: string;
  yKeys: string[];
  title?: string;
  description?: string;
  height?: number;
  colors?: string[];
}

const defaultColors = [
  'var(--dxp-chart-1)',
  'var(--dxp-chart-2)',
  'var(--dxp-chart-3)',
  'var(--dxp-chart-4)',
  'var(--dxp-chart-5)',
];

export function Chart({ type, data, xKey, yKeys, title, description, height = 300, colors }: ChartProps) {
  const chartColors = colors || defaultColors;

  const chart = type === 'bar' ? (
    <BarChart data={data}>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--dxp-border-light)" />
      <XAxis dataKey={xKey} tick={{ fontSize: 12, fill: 'var(--dxp-text-muted)' }} />
      <YAxis tick={{ fontSize: 12, fill: 'var(--dxp-text-muted)' }} />
      <Tooltip contentStyle={{ borderRadius: 'var(--dxp-radius)', border: '1px solid var(--dxp-border)', fontSize: 12 }} />
      {yKeys.length > 1 && <Legend />}
      {yKeys.map((key, i) => (
        <Bar key={key} dataKey={key} fill={chartColors[i % chartColors.length]} radius={[4, 4, 0, 0]} />
      ))}
    </BarChart>
  ) : (
    <LineChart data={data}>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--dxp-border-light)" />
      <XAxis dataKey={xKey} tick={{ fontSize: 12, fill: 'var(--dxp-text-muted)' }} />
      <YAxis tick={{ fontSize: 12, fill: 'var(--dxp-text-muted)' }} />
      <Tooltip contentStyle={{ borderRadius: 'var(--dxp-radius)', border: '1px solid var(--dxp-border)', fontSize: 12 }} />
      {yKeys.length > 1 && <Legend />}
      {yKeys.map((key, i) => (
        <Line key={key} type="monotone" dataKey={key} stroke={chartColors[i % chartColors.length]} strokeWidth={2} dot={{ r: 3 }} />
      ))}
    </LineChart>
  );

  return (
    <Card>
      {(title || description) && (
        <CardHeader>
          {title && <h3 className="text-sm font-bold text-[var(--dxp-text)]">{title}</h3>}
          {description && <p className="text-xs text-[var(--dxp-text-muted)] mt-0.5">{description}</p>}
        </CardHeader>
      )}
      <CardContent>
        <ResponsiveContainer width="100%" height={height}>
          {chart}
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
