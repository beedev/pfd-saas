import React from 'react';
import { cn } from '../utils/cn';

export interface Tab {
  key: string;
  label: string;
  count?: number;
}

export interface TabsProps {
  tabs: Tab[];
  active: string;
  onChange: (key: string) => void;
  variant?: 'pill' | 'underline';
}

export function Tabs({ tabs, active, onChange, variant = 'pill' }: TabsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={cn(
            'px-5 py-2.5 text-sm font-medium transition-colors',
            variant === 'pill' && 'rounded-full',
            variant === 'underline' && 'border-b-2 rounded-none px-4 py-3',
            active === tab.key
              ? variant === 'pill'
                ? 'bg-[var(--dxp-brand)] text-white shadow-sm'
                : 'border-[var(--dxp-brand)] text-[var(--dxp-brand)]'
              : variant === 'pill'
                ? 'bg-[var(--dxp-border-light)] text-[var(--dxp-text)] hover:bg-[var(--dxp-border)]'
                : 'border-transparent text-[var(--dxp-text-secondary)] hover:text-[var(--dxp-text)]',
          )}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span className="ml-1.5 text-xs opacity-70">({tab.count})</span>
          )}
        </button>
      ))}
    </div>
  );
}
