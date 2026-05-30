import React from 'react';
import { cn } from '../utils/cn';

export interface QuickAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}

export interface QuickActionsProps {
  actions: QuickAction[];
  className?: string;
}

export function QuickActions({ actions, className }: QuickActionsProps) {
  return (
    <div className={cn('flex flex-wrap gap-6', className)}>
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          onClick={action.onClick}
          className="flex flex-col items-center gap-2 group focus:outline-none"
        >
          <span className="w-12 h-12 rounded-full bg-[var(--dxp-brand-light)] text-[var(--dxp-brand)] flex items-center justify-center transition-transform group-hover:scale-105 group-focus:ring-2 group-focus:ring-[var(--dxp-brand)] group-focus:ring-offset-2">
            {action.icon}
          </span>
          <span className="text-xs font-semibold text-[var(--dxp-text-secondary)] group-hover:text-[var(--dxp-brand)]">
            {action.label}
          </span>
        </button>
      ))}
    </div>
  );
}
