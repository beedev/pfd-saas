import React from 'react';
import { Input } from '../primitives/Input';
import { Badge } from '../primitives/Badge';

export interface FilterOption {
  key: string;
  label: string;
  value: string;
}

export interface FilterBarProps {
  filters: FilterOption[];
  activeFilters: string[];
  onToggle: (key: string) => void;
  onClear: () => void;
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
}

export function FilterBar({
  filters, activeFilters, onToggle, onClear,
  searchPlaceholder = 'Search...', searchValue = '', onSearchChange,
}: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-[var(--dxp-density-gap)] rounded-[var(--dxp-radius)] border border-[var(--dxp-border)] bg-[var(--dxp-surface)] px-4 py-3">
      {onSearchChange && (
        <Input
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          className="w-48"
        />
      )}
      {onSearchChange && filters.length > 0 && <div className="h-5 w-px bg-[var(--dxp-border)]" />}
      {filters.map((f) => {
        const isActive = activeFilters.includes(f.key);
        return (
          <button key={f.key} onClick={() => onToggle(f.key)}>
            <Badge variant={isActive ? 'brand' : 'default'}>{f.label}</Badge>
          </button>
        );
      })}
      {activeFilters.length > 0 && (
        <button onClick={onClear} className="text-xs font-medium text-[var(--dxp-text-muted)] hover:text-[var(--dxp-text-secondary)]">
          Clear all
        </button>
      )}
    </div>
  );
}
