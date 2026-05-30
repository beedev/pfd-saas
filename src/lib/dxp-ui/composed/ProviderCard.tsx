import React from 'react';
import { Card } from '../primitives/Card';
import { Badge } from '../primitives/Badge';
import { Button } from '../primitives/Button';

export type ProviderNetworkStatus = 'in-network' | 'out-of-network' | 'unknown';
export type ProviderCardVariant = 'default' | 'pcp';

export interface ProviderCardAction {
  label: string;
  onClick: () => void;
}

export interface ProviderCardProps {
  name: string;
  specialty?: string;
  role?: string;
  address?: string;
  phone?: string;
  email?: string;
  networkStatus?: ProviderNetworkStatus;
  acceptingNewPatients?: boolean;
  rating?: number;
  reviewCount?: number;
  distance?: number | string;
  languages?: string[];
  facility?: string;
  isPrimary?: boolean;
  variant?: ProviderCardVariant;
  primaryAction?: ProviderCardAction;
  secondaryAction?: ProviderCardAction;
  onClick?: () => void;
}

const initialsOf = (name: string) =>
  name
    .split(' ')
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

export function ProviderCard({
  name,
  specialty,
  role,
  address,
  phone,
  email,
  networkStatus,
  acceptingNewPatients,
  rating,
  reviewCount,
  distance,
  languages,
  facility,
  isPrimary,
  variant = 'default',
  primaryAction,
  secondaryAction,
  onClick,
}: ProviderCardProps) {
  const isPcp = variant === 'pcp';

  return (
    <Card interactive={!!onClick} onClick={onClick} className="p-5 flex flex-col gap-4">
      {isPcp && (
        <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--dxp-brand)]">
          Primary Care Provider
        </span>
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-12 h-12 rounded-full bg-[var(--dxp-brand-light)] flex items-center justify-center text-[var(--dxp-brand)] font-bold text-base shrink-0">
            {initialsOf(name)}
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-[var(--dxp-text)] truncate">{name}</h3>
            {specialty && <p className="text-xs text-[var(--dxp-text-secondary)] truncate">{specialty}</p>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {networkStatus === 'in-network' && <Badge variant="success">In-Network</Badge>}
          {networkStatus === 'out-of-network' && <Badge variant="warning">Out-of-Network</Badge>}
          {isPrimary && !isPcp && <Badge variant="info">Primary</Badge>}
        </div>
      </div>

      {(role || facility) && (
        <div className="flex flex-col gap-1">
          {role && <span className="text-xs text-[var(--dxp-text-secondary)]">{role}</span>}
          {facility && <p className="text-xs text-[var(--dxp-text-secondary)]">{facility}</p>}
        </div>
      )}

      {(distance != null || rating != null) && (
        <div className="flex items-center gap-4 text-xs text-[var(--dxp-text-secondary)]">
          {distance != null && <span>{distance} mi</span>}
          {rating != null && (
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5 text-[var(--dxp-warning)]" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
              {rating}
              {reviewCount != null && <span className="text-[var(--dxp-text-muted)]">({reviewCount})</span>}
            </span>
          )}
        </div>
      )}

      {address && <p className="text-xs text-[var(--dxp-text-secondary)] leading-relaxed">{address}</p>}

      {languages && languages.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {languages.map((lang) => (
            <span
              key={lang}
              className="text-[10px] px-2 py-0.5 rounded bg-[var(--dxp-border-light)] text-[var(--dxp-text-secondary)] font-medium"
            >
              {lang}
            </span>
          ))}
        </div>
      )}

      <div className="mt-auto pt-3 border-t border-[var(--dxp-border-light)] space-y-1.5">
        {phone && (
          <div className="flex items-center gap-2 text-xs">
            <svg className="w-3.5 h-3.5 text-[var(--dxp-text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
            <span className="text-[var(--dxp-text)] font-semibold">{phone}</span>
          </div>
        )}
        {email && (
          <div className="flex items-center gap-2 text-xs">
            <svg className="w-3.5 h-3.5 text-[var(--dxp-text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <span className="text-[var(--dxp-brand)]">{email}</span>
          </div>
        )}
        {acceptingNewPatients != null && (
          <span className="text-xs text-[var(--dxp-text-muted)] block">
            {acceptingNewPatients ? 'Accepting new patients' : 'Not accepting new patients'}
          </span>
        )}
      </div>

      {(primaryAction || secondaryAction) && (
        <div className="flex items-center gap-2">
          {primaryAction && (
            <Button size="sm" onClick={primaryAction.onClick}>
              {primaryAction.label}
            </Button>
          )}
          {secondaryAction && (
            <Button variant="ghost" size="sm" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
