import React from 'react';
import { Button } from '../primitives/Button';

export interface DetailPanelProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function DetailPanel({ open, onClose, title, children, footer }: DetailPanelProps) {
  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-lg overflow-y-auto bg-[var(--dxp-surface)] shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--dxp-border)] px-6 py-4">
          <h2 className="text-lg font-semibold text-[var(--dxp-text)]">{title}</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </Button>
        </div>
        <div className="px-6 py-4">{children}</div>
        {footer && <div className="border-t border-[var(--dxp-border)] px-6 py-4">{footer}</div>}
      </div>
    </>
  );
}
