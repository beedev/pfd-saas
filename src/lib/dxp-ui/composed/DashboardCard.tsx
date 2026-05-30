import React from 'react';
import { Card } from '../primitives/Card';

export interface DashboardCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: { value: number; label: string };
  icon?: React.ReactNode;
  onClick?: () => void;
}

export function DashboardCard({ title, value, subtitle, trend, icon, onClick }: DashboardCardProps) {
  return (
    <Card interactive={!!onClick} onClick={onClick} className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-[var(--dxp-text-secondary)]">{title}</p>
          <p className="mt-1 text-2xl font-bold text-[var(--dxp-text)]">{value}</p>
          {subtitle && <p className="mt-0.5 text-sm text-[var(--dxp-text-muted)]">{subtitle}</p>}
          {trend && (
            <p className={`mt-1 text-sm font-medium ${trend.value >= 0 ? 'text-[var(--dxp-success)]' : 'text-[var(--dxp-danger)]'}`}>
              {trend.value >= 0 ? '+' : ''}{trend.value}% {trend.label}
            </p>
          )}
        </div>
        {icon && <div className="text-[var(--dxp-text-muted)]">{icon}</div>}
      </div>
    </Card>
  );
}
