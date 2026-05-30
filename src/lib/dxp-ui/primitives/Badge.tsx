import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../utils/cn';

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-[var(--dxp-border-light)] text-[var(--dxp-text-secondary)] ring-[var(--dxp-border)]',
        success: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
        warning: 'bg-amber-50 text-amber-700 ring-amber-600/20',
        danger: 'bg-red-50 text-red-700 ring-red-600/20',
        info: 'bg-blue-50 text-blue-700 ring-blue-600/20',
        brand: 'bg-[var(--dxp-brand-light)] text-[var(--dxp-brand)] ring-[var(--dxp-brand)]/20',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, className }))} {...props} />;
}
