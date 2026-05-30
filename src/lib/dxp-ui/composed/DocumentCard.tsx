import React from 'react';
import { Badge } from '../primitives/Badge';
import { Card } from '../primitives/Card';

export interface DocumentCardProps {
  name: string;
  category: 'policy' | 'claim' | 'upload';
  reference?: string;
  date: string;
  size: string;
  fileType?: 'pdf' | 'image' | 'zip' | 'doc';
  onDownload?: () => void;
  onClick?: () => void;
}

const fileIcons: Record<string, React.ReactNode> = {
  pdf: (
    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  image: (
    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  zip: (
    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
    </svg>
  ),
  doc: (
    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  ),
};

const categoryVariant: Record<string, 'brand' | 'warning'> = {
  policy: 'brand',
  claim: 'warning',
  upload: 'brand',
};

export function DocumentCard({ name, category, reference, date, size, fileType = 'pdf', onDownload, onClick }: DocumentCardProps) {
  return (
    <Card interactive={!!onClick} onClick={onClick} className="p-6 group">
      <div className="flex justify-between items-start mb-6">
        <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${
          category === 'claim' ? 'bg-amber-50 text-amber-600' : 'bg-[var(--dxp-brand-light)] text-[var(--dxp-brand)]'
        }`}>
          {fileIcons[fileType] || fileIcons.doc}
        </div>
        {onDownload && (
          <button
            onClick={(e) => { e.stopPropagation(); onDownload(); }}
            className="p-2 text-[var(--dxp-text-muted)] hover:text-[var(--dxp-brand)] transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </button>
        )}
      </div>
      <div className="flex items-center gap-2 mb-2">
        <Badge variant={categoryVariant[category] || 'brand'}>{category}</Badge>
        {reference && <span className="text-sm font-medium text-[var(--dxp-brand)]">{reference}</span>}
      </div>
      <h3 className="text-base font-bold text-[var(--dxp-text)] mb-4 leading-snug">{name}</h3>
      <div className="flex justify-between items-center text-[var(--dxp-text-muted)] text-sm border-t border-[var(--dxp-border-light)] pt-4">
        <span>{date}</span>
        <span>{size}</span>
      </div>
    </Card>
  );
}
