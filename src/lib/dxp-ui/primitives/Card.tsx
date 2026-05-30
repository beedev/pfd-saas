import React from 'react';
import { cn } from '../utils/cn';

export type CardVariant = 'default' | 'promo';
export type CardAccent = 'brand' | 'success' | 'warning' | 'info' | 'purple' | 'green';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  variant?: CardVariant;
  accent?: CardAccent;
}

const accentClasses: Record<CardAccent, string> = {
  brand: 'bg-[var(--dxp-brand)] text-white border-transparent',
  success: 'bg-emerald-600 text-white border-transparent',
  warning: 'bg-amber-500 text-white border-transparent',
  info: 'bg-blue-600 text-white border-transparent',
  purple: 'bg-purple-700 text-white border-transparent',
  green: 'bg-emerald-700 text-white border-transparent',
};

export function Card({ className, interactive, variant = 'default', accent = 'brand', ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-[var(--dxp-radius)] border shadow-sm',
        variant === 'default' && 'border-[var(--dxp-border)] bg-[var(--dxp-surface)]',
        variant === 'promo' && accentClasses[accent],
        interactive && 'cursor-pointer transition-shadow hover:shadow-md',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('border-b border-[var(--dxp-border-light)] px-5 py-4', className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 py-4', className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('border-t border-[var(--dxp-border-light)] px-5 py-4', className)} {...props} />;
}
