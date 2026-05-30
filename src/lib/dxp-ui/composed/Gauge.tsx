import React from 'react';
import { cn } from '../utils/cn';

export type GaugeFormat = 'currency' | 'percent' | 'number';
export type GaugeSize = 'sm' | 'md' | 'lg';

export interface GaugeThresholds {
  warning?: number;
  danger?: number;
}

export interface GaugeProps {
  value: number;
  max: number;
  label?: string;
  caption?: string;
  format?: GaugeFormat;
  thresholds?: GaugeThresholds;
  size?: GaugeSize;
  className?: string;
}

const sizeMap: Record<GaugeSize, { svg: number; stroke: number; valueClass: string; labelClass: string }> = {
  sm: { svg: 120, stroke: 10, valueClass: 'text-base font-bold', labelClass: 'text-[10px]' },
  md: { svg: 160, stroke: 14, valueClass: 'text-xl font-bold', labelClass: 'text-xs' },
  lg: { svg: 220, stroke: 18, valueClass: 'text-3xl font-extrabold', labelClass: 'text-sm' },
};

const formatValue = (v: number, max: number, fmt: GaugeFormat) => {
  switch (fmt) {
    case 'currency':
      return `$${v.toLocaleString()}`;
    case 'percent':
      return `${Math.round((v / max) * 100)}%`;
    default:
      return v.toLocaleString();
  }
};

const colorForRatio = (ratio: number, thresholds?: GaugeThresholds) => {
  const dangerAt = thresholds?.danger ?? 0.9;
  const warningAt = thresholds?.warning ?? 0.7;
  if (ratio >= dangerAt) return 'var(--dxp-danger, #dc2626)';
  if (ratio >= warningAt) return 'var(--dxp-warning, #d97706)';
  return 'var(--dxp-brand)';
};

export function Gauge({
  value,
  max,
  label,
  caption,
  format = 'currency',
  thresholds,
  size = 'md',
  className,
}: GaugeProps) {
  const safeMax = max > 0 ? max : 1;
  const ratio = Math.max(0, Math.min(1, value / safeMax));
  const { svg, stroke, valueClass, labelClass } = sizeMap[size];

  // Half-circle gauge — radius leaves stroke room.
  const radius = (svg - stroke) / 2;
  const cx = svg / 2;
  const cy = svg / 2;
  const circumference = Math.PI * radius; // half circle
  const dashOffset = circumference * (1 - ratio);
  const fillColor = colorForRatio(ratio, thresholds);
  const formatted = formatValue(value, safeMax, format);
  const total = formatValue(safeMax, safeMax, format === 'percent' ? 'number' : format);

  return (
    <div className={cn('flex flex-col items-center', className)}>
      <svg width={svg} height={svg / 2 + stroke} viewBox={`0 0 ${svg} ${svg / 2 + stroke}`}>
        {/* Track */}
        <path
          d={`M ${stroke / 2} ${cy} A ${radius} ${radius} 0 0 1 ${svg - stroke / 2} ${cy}`}
          fill="none"
          stroke="var(--dxp-border-light)"
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        {/* Fill */}
        <path
          d={`M ${stroke / 2} ${cy} A ${radius} ${radius} 0 0 1 ${svg - stroke / 2} ${cy}`}
          fill="none"
          stroke={fillColor}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          style={{ transition: 'stroke-dashoffset 400ms ease' }}
        />
      </svg>
      <div className="-mt-6 text-center">
        <div className={cn(valueClass, 'text-[var(--dxp-text)]')}>{formatted}</div>
        {format !== 'percent' && (
          <div className={cn(labelClass, 'text-[var(--dxp-text-muted)] font-medium')}>of {total}</div>
        )}
      </div>
      {(label || caption) && (
        <div className="mt-2 text-center">
          {label && <p className="text-sm font-bold text-[var(--dxp-text)]">{label}</p>}
          {caption && <p className="text-xs text-[var(--dxp-text-secondary)]">{caption}</p>}
        </div>
      )}
    </div>
  );
}
