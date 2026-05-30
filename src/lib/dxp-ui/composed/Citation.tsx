import React from 'react';

export interface CitationProps {
  number?: number;
  source: string;
  title: string;
  url?: string;
  excerpt?: string;
  date?: string;
}

export function Citation({ number, source, title, url, excerpt, date }: CitationProps) {
  const cls = "flex gap-3 rounded-[var(--dxp-radius)] border border-[var(--dxp-border)] bg-[var(--dxp-surface)] p-3 transition-colors hover:bg-[var(--dxp-border-light)] group";

  const inner = (
    <>
      {number !== undefined && (
        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[var(--dxp-brand-light)] text-[var(--dxp-brand)] flex items-center justify-center text-[10px] font-bold">
          {number}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--dxp-text-muted)]">{source}</p>
        <p className="text-sm font-medium text-[var(--dxp-text)] group-hover:text-[var(--dxp-brand)] mt-0.5 truncate">{title}</p>
        {excerpt && <p className="text-xs text-[var(--dxp-text-secondary)] mt-1 line-clamp-2">{excerpt}</p>}
        {date && <p className="text-[10px] text-[var(--dxp-text-muted)] mt-1">{date}</p>}
      </div>
      {url && (
        <svg className="w-4 h-4 text-[var(--dxp-text-muted)] flex-shrink-0 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
        </svg>
      )}
    </>
  );

  if (url) {
    return <a href={url} target="_blank" rel="noreferrer" className={cls}>{inner}</a>;
  }
  return <div className={cls}>{inner}</div>;
}
