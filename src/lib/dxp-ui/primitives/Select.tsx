import React from 'react';
import { cn } from '../utils/cn';

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface SelectProps {
  options: SelectOption[];
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  error?: boolean;
  label?: string;
}

export function Select({ options, value, onChange, placeholder = 'Select...', disabled, error, label }: SelectProps) {
  return (
    <div>
      {label && <label className="block text-sm font-medium text-[var(--dxp-text)] mb-1.5">{label}</label>}
      <select
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        disabled={disabled}
        className={cn(
          'flex h-9 w-full rounded-[var(--dxp-radius)] border bg-[var(--dxp-surface)] px-3 py-1 text-[var(--dxp-density-text)] text-[var(--dxp-text)] shadow-sm transition-colors appearance-none',
          'focus:outline-none focus:ring-2 focus:ring-[var(--dxp-brand)] focus:ring-offset-1',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'bg-[url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\' fill=\'none\' stroke=\'%239ca3af\' stroke-width=\'2\'%3E%3Cpath d=\'M3 4.5L6 7.5L9 4.5\'/%3E%3C/svg%3E")] bg-no-repeat bg-[right_0.75rem_center]',
          error ? 'border-[var(--dxp-danger)]' : 'border-[var(--dxp-border)]',
        )}
      >
        {placeholder && <option value="" disabled>{placeholder}</option>}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}
