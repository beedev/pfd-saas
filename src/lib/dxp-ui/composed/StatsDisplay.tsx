import React from 'react';
import { Card } from '../primitives/Card';

export interface Stat {
  label: string;
  value: number;
  format?: 'number' | 'currency' | 'percent' | 'compact';
  delta?: { value: number; label?: string };
  icon?: React.ReactNode;
}

export interface StatsDisplayProps {
  stats: Stat[];
  columns?: 2 | 3 | 4;
  /** ISO currency code used when a stat has format='currency'. Default: USD */
  currency?: string;
  /** BCP-47 locale tag used by Intl.NumberFormat. Default: en-US */
  locale?: string;
}

function formatValue(value: number, format: string | undefined, locale: string, currency: string): string {
  switch (format) {
    case 'currency':
      return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
    case 'percent':
      return `${value.toFixed(1)}%`;
    case 'compact':
      return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
    default:
      return new Intl.NumberFormat(locale).format(value);
  }
}

export function StatsDisplay({ stats, columns = 4, currency = 'USD', locale = 'en-US' }: StatsDisplayProps) {
  const gridCols = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' };

  return (
    <div className={`grid grid-cols-1 ${gridCols[columns]} gap-4`}>
      {stats.map((stat, i) => (
        <Card key={i} className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-[var(--dxp-text-muted)]">{stat.label}</p>
              <p className="mt-2 text-3xl font-bold text-[var(--dxp-text)]">{formatValue(stat.value, stat.format, locale, currency)}</p>
              {stat.delta && (
                <p className={`mt-1 text-sm font-semibold ${stat.delta.value >= 0 ? 'text-[var(--dxp-success)]' : 'text-[var(--dxp-danger)]'}`}>
                  {stat.delta.value >= 0 ? '\u2191' : '\u2193'} {Math.abs(stat.delta.value)}%
                  {stat.delta.label && <span className="font-normal text-[var(--dxp-text-muted)]"> {stat.delta.label}</span>}
                </p>
              )}
            </div>
            {stat.icon && <div className="text-[var(--dxp-text-muted)]">{stat.icon}</div>}
          </div>
        </Card>
      ))}
    </div>
  );
}
