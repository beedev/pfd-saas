import React from 'react';
import { Card } from '../primitives/Card';

export interface LinkPreviewProps {
  url: string;
  title: string;
  description?: string;
  image?: string;
  siteName?: string;
  onClick?: () => void;
}

export function LinkPreview({ url, title, description, image, siteName, onClick }: LinkPreviewProps) {
  const domain = (() => { try { return new URL(url).hostname; } catch { return url; } })();

  return (
    <Card interactive={!!onClick} onClick={onClick} className="overflow-hidden">
      <div className="flex">
        {image && (
          <div className="w-32 flex-shrink-0">
            <img src={image} alt={title} className="w-full h-full object-cover" />
          </div>
        )}
        <div className="p-4 flex-1 min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--dxp-text-muted)]">
            {siteName || domain}
          </p>
          <h4 className="text-sm font-bold text-[var(--dxp-text)] mt-1 truncate">{title}</h4>
          {description && (
            <p className="text-xs text-[var(--dxp-text-secondary)] mt-1 line-clamp-2">{description}</p>
          )}
          <p className="text-[10px] text-[var(--dxp-brand)] mt-2 truncate">{url}</p>
        </div>
      </div>
    </Card>
  );
}
