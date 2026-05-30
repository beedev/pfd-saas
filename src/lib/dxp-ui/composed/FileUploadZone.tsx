import React from 'react';
import { Button } from '../primitives/Button';

export interface UploadedFile {
  id: string;
  name: string;
  size: string;
  type: 'image' | 'document' | 'archive';
  previewUrl?: string;
}

export interface FileUploadZoneProps {
  files: UploadedFile[];
  onRemove: (id: string) => void;
  onDrop?: (files: FileList) => void;
  accept?: string;
  maxSize?: string;
}

export function FileUploadZone({ files, onRemove, onDrop, accept = 'JPG, PNG, PDF', maxSize = '10MB' }: FileUploadZoneProps) {
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    onDrop?.(e.dataTransfer.files);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
      {/* Drop zone */}
      <div className="lg:col-span-7">
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          className="border-2 border-dashed border-[var(--dxp-border)] rounded-xl p-12 bg-[var(--dxp-border-light)]/50 flex flex-col items-center justify-center text-center group hover:border-[var(--dxp-brand)] transition-colors cursor-pointer"
        >
          <div className="w-16 h-16 rounded-full bg-[var(--dxp-brand-light)] mb-4 flex items-center justify-center text-[var(--dxp-brand)] transition-transform group-hover:scale-110">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </div>
          <h4 className="text-lg font-bold text-[var(--dxp-text)] mb-1">Drag and drop files here</h4>
          <p className="text-sm text-[var(--dxp-text-secondary)] mb-4">Or click to browse from your computer</p>
          <span className="text-xs text-[var(--dxp-text-muted)]">Supported: {accept} (Max {maxSize} per file)</span>
        </div>
      </div>

      {/* Uploaded files */}
      <div className="lg:col-span-5 bg-[var(--dxp-border-light)] rounded-xl p-6">
        <h4 className="text-xs font-bold uppercase tracking-widest text-[var(--dxp-text-secondary)] mb-6">
          Uploaded Files ({files.length})
        </h4>
        <div className="space-y-3">
          {files.map((file) => (
            <div key={file.id} className="bg-[var(--dxp-surface)] p-4 rounded-lg flex items-center justify-between shadow-sm">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded bg-[var(--dxp-brand-light)] flex items-center justify-center overflow-hidden">
                  {file.previewUrl ? (
                    <img src={file.previewUrl} alt={file.name} className="w-full h-full object-cover" />
                  ) : (
                    <svg className="w-6 h-6 text-[var(--dxp-brand)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  )}
                </div>
                <div>
                  <p className="text-sm font-bold text-[var(--dxp-text)]">{file.name}</p>
                  <p className="text-xs text-[var(--dxp-text-muted)]">{file.size}</p>
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => onRemove(file.id)}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </Button>
            </div>
          ))}
          {files.length === 0 && (
            <p className="text-sm text-[var(--dxp-text-muted)] text-center py-8">No files uploaded yet</p>
          )}
        </div>
      </div>
    </div>
  );
}
