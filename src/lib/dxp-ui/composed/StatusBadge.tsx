import React from 'react';
import { Badge, type BadgeProps } from '../primitives/Badge';

const statusVariantMap: Record<string, BadgeProps['variant']> = {
  active: 'success',
  approved: 'success',
  completed: 'success',
  pending: 'warning',
  processing: 'info',
  review: 'info',
  rejected: 'danger',
  denied: 'danger',
  failed: 'danger',
  expired: 'default',
  draft: 'default',
};

export interface StatusBadgeProps {
  status: string;
  label?: string;
}

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const variant = statusVariantMap[status.toLowerCase()] || 'default';
  return <Badge variant={variant}>{label || status}</Badge>;
}
