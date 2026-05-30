import React from 'react';
import { Card } from '../primitives/Card';
import { Button } from '../primitives/Button';

export type CoverageType = 'health' | 'dental' | 'pharmacy' | 'vision';

export interface CoverageHighlight {
  label: string;
  value: string;
}

export interface CoverageCardProps {
  type: CoverageType;
  memberId: string;
  effectiveStart: string;
  effectiveEnd?: string;
  /** Type-specific facts shown in the card body. Replaces the deductible/OOP block. */
  highlights?: CoverageHighlight[];
  /** Legacy: deductible amount. Used to build a default highlight if highlights is not provided. */
  deductible?: { value: number; currency?: string };
  /** Legacy: out-of-pocket max amount. Used to build a default highlight if highlights is not provided. */
  outOfPocketMax?: { value: number; currency?: string };
  status?: 'active' | 'inactive' | 'pending';
  onViewDetails?: () => void;
}

const typeMeta: Record<CoverageType, { label: string; icon: React.ReactNode }> = {
  health: {
    label: 'Health',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.318 6.318a4.5 4.5 0 016.364 0L12 7.636l1.318-1.318a4.5 4.5 0 116.364 6.364L12 20.364l-7.682-7.682a4.5 4.5 0 010-6.364z" />
      </svg>
    ),
  },
  dental: {
    label: 'Dental',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4c-3 0-5 1.5-5 4 0 2 .5 3 1 5s.5 5 2 7c.5.5 1 .5 1.5 0 .5-1 .5-3 .5-4 0-1 .5-1 .5-1s.5 0 .5 1c0 1 0 3 .5 4 .5.5 1 .5 1.5 0 1.5-2 1.5-5 2-7s1-3 1-5c0-2.5-2-4-5-4z" />
      </svg>
    ),
  },
  pharmacy: {
    label: 'Prescription',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 9h-6L8 4z" />
      </svg>
    ),
  },
  vision: {
    label: 'Vision',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
      </svg>
    ),
  },
};

const formatMoney = (v?: { value: number; currency?: string }) => {
  if (!v) return null;
  return `$${v.value.toLocaleString()}`;
};

const formatRange = (start: string, end?: string) => (end ? `${start} – ${end}` : start);

const fallbackHighlights = (
  highlights: CoverageHighlight[] | undefined,
  deductible: CoverageCardProps['deductible'],
  outOfPocketMax: CoverageCardProps['outOfPocketMax'],
): CoverageHighlight[] => {
  if (highlights && highlights.length > 0) return highlights;
  const out: CoverageHighlight[] = [];
  if (deductible) out.push({ label: 'Deductible', value: formatMoney(deductible)! });
  if (outOfPocketMax) out.push({ label: 'Max', value: formatMoney(outOfPocketMax)! });
  return out;
};

export function CoverageCard({
  type,
  memberId,
  effectiveStart,
  effectiveEnd,
  highlights,
  deductible,
  outOfPocketMax,
  status = 'active',
  onViewDetails,
}: CoverageCardProps) {
  const meta = typeMeta[type];
  const rows = fallbackHighlights(highlights, deductible, outOfPocketMax);
  const statusLabel = status === 'active' ? 'ACTIVE' : status === 'pending' ? 'PENDING' : 'INACTIVE';
  const statusColor =
    status === 'active'
      ? 'text-emerald-700 bg-emerald-50'
      : status === 'pending'
        ? 'text-amber-700 bg-amber-50'
        : 'text-[var(--dxp-text-muted)] bg-[var(--dxp-border-light)]';

  return (
    <Card className="p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[var(--dxp-brand)]">{meta.icon}</span>
          <h3 className="text-base font-bold text-[var(--dxp-text)]">{meta.label}</h3>
        </div>
        <span className={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded ${statusColor}`}>
          {statusLabel}
        </span>
      </div>

      <div className="space-y-2 text-sm">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--dxp-text-muted)]">ID</span>
          <p className="font-mono text-[var(--dxp-text)]">{memberId}</p>
        </div>
        <div>
          <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--dxp-text-muted)]">Effective</span>
          <p className="text-[var(--dxp-text)]">{formatRange(effectiveStart, effectiveEnd)}</p>
        </div>
      </div>

      {rows.length > 0 && (
        <div className="border-t border-[var(--dxp-border-light)] pt-3 space-y-1.5 text-sm">
          {rows.map((row) => (
            <div key={row.label} className="flex justify-between">
              <span className="text-[var(--dxp-text-secondary)]">{row.label}</span>
              <span className="font-bold text-[var(--dxp-text)]">{row.value}</span>
            </div>
          ))}
        </div>
      )}

      {onViewDetails && (
        <div className="mt-auto pt-2">
          <Button variant="ghost" size="sm" onClick={onViewDetails}>
            View details
          </Button>
        </div>
      )}
    </Card>
  );
}
