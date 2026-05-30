import React from 'react';
import { cn } from '../utils/cn';

export interface OptionItem {
  id: string;
  label: string;
  description?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}

export interface OptionListProps {
  options: OptionItem[];
  value?: string | string[];
  onChange: (value: string | string[]) => void;
  multiSelect?: boolean;
  columns?: 1 | 2 | 3;
}

export function OptionList({ options, value, onChange, multiSelect = false, columns = 1 }: OptionListProps) {
  const selected = Array.isArray(value) ? value : value ? [value] : [];

  const toggle = (id: string) => {
    if (multiSelect) {
      const updated = selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
      onChange(updated);
    } else {
      onChange(id);
    }
  };

  const gridClass = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3' };

  return (
    <div className={`grid ${gridClass[columns]} gap-2`}>
      {options.map((opt) => {
        const isSelected = selected.includes(opt.id);
        return (
          <button
            key={opt.id}
            onClick={() => !opt.disabled && toggle(opt.id)}
            disabled={opt.disabled}
            className={cn(
              'w-full text-left rounded-[var(--dxp-radius)] border-2 p-4 transition-all',
              isSelected
                ? 'border-[var(--dxp-brand)] bg-[var(--dxp-brand-light)]'
                : 'border-[var(--dxp-border)] hover:border-[var(--dxp-text-muted)]',
              opt.disabled && 'opacity-50 cursor-not-allowed',
            )}
          >
            <div className="flex items-center gap-3">
              <div className={cn(
                'flex-shrink-0 w-5 h-5 border-2 flex items-center justify-center',
                multiSelect ? 'rounded-[var(--dxp-radius)]' : 'rounded-full',
                isSelected ? 'border-[var(--dxp-brand)] bg-[var(--dxp-brand)]' : 'border-[var(--dxp-border)]',
              )}>
                {isSelected && (
                  <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
                    <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                )}
              </div>
              {opt.icon && <div className="flex-shrink-0 text-[var(--dxp-text-muted)]">{opt.icon}</div>}
              <div>
                <span className="text-sm font-medium text-[var(--dxp-text)]">{opt.label}</span>
                {opt.description && <p className="text-xs text-[var(--dxp-text-muted)] mt-0.5">{opt.description}</p>}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
