import React from 'react';
import { cn } from '../utils/cn';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, ...props }, ref) => {
    return (
      <input
        className={cn(
          'flex h-9 w-full rounded-[var(--dxp-radius)] border bg-[var(--dxp-surface)] px-3 py-1 text-[var(--dxp-density-text)] text-[var(--dxp-text)] shadow-sm transition-colors',
          'placeholder:text-[var(--dxp-text-muted)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dxp-brand)] focus-visible:ring-offset-1',
          'disabled:cursor-not-allowed disabled:opacity-50',
          error ? 'border-[var(--dxp-danger)]' : 'border-[var(--dxp-border)]',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';
