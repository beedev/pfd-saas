import React from 'react';
import { cn } from '../utils/cn';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface BreadcrumbProps extends React.HTMLAttributes<HTMLElement> {
  items: BreadcrumbItem[];
  onNavigate?: (href: string) => void;
}

export function Breadcrumb({ items, onNavigate, className, ...props }: BreadcrumbProps) {
  return (
    <nav aria-label="Breadcrumb" className={cn('flex items-center text-sm', className)} {...props}>
      <ol className="flex items-center flex-wrap gap-1.5">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          const clickable = !isLast && item.href && onNavigate;
          return (
            <li key={`${item.label}-${i}`} className="flex items-center gap-1.5">
              {clickable ? (
                <button
                  type="button"
                  onClick={() => onNavigate!(item.href!)}
                  className="text-[var(--dxp-text-secondary)] hover:text-[var(--dxp-brand)] transition-colors font-medium"
                >
                  {item.label}
                </button>
              ) : (
                <span className={cn(isLast ? 'text-[var(--dxp-text)] font-semibold' : 'text-[var(--dxp-text-secondary)] font-medium')}>
                  {item.label}
                </span>
              )}
              {!isLast && (
                <svg className="w-3.5 h-3.5 text-[var(--dxp-text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
