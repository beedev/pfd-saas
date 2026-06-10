'use client';

/**
 * Sprint 6.4e — Settings card for data export / Replace-only import.
 *
 * Two halves:
 *   - Export my data:    GET /api/portability/export → browser
 *     downloads a JSON file via window.location.
 *   - Import my data:    POST /api/portability/import (preview) →
 *     show a diff modal listing willDelete + willInsert per table →
 *     user types REPLACE → POST /api/portability/import/confirm →
 *     toast success and reload.
 *
 * Replace mode is destructive — every user-scoped row owned by the
 * caller is removed, then the payload's rows are reinserted. The
 * REPLACE-typed gate is the last line of defense; pre-flight cancel
 * paths must short-circuit before any irreversible step.
 */

import { useRef, useState } from 'react';
import { Button, Card, CardHeader, CardContent, Input } from '@dxp/ui';
import { Download, Upload, Loader2, AlertTriangle, X } from 'lucide-react';
import { toast } from 'sonner';

interface DiffSummary {
  importId: string;
  willDelete: Record<string, number>;
  willInsert: Record<string, number>;
  totalWillDelete: number;
  totalWillInsert: number;
  /** Unknown fields stripped from rows during validation (per table). */
  strippedUnknownKeys?: Record<string, number>;
  totalStrippedKeys?: number;
  exportedAt: string;
  version: string;
}

export function DataPortabilityCard() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [diff, setDiff] = useState<DiffSummary | null>(null);
  const [confirmText, setConfirmText] = useState('');

  function handleExport() {
    // GET → browser handles the Content-Disposition attachment.
    window.location.href = '/api/portability/export';
  }

  function handlePickFile() {
    fileInputRef.current?.click();
  }

  async function handleFileChosen(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset so the same file can be re-selected later.
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch('/api/portability/import', { method: 'POST', body: fd });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        const detail = Array.isArray(body.errors) ? body.errors.join('\n') : body.error ?? 'Upload failed';
        toast.error(detail);
        return;
      }
      const body = (await r.json()) as DiffSummary;
      setDiff(body);
      setConfirmText('');
    } catch (err) {
      console.error(err);
      toast.error('Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function handleConfirm() {
    if (!diff) return;
    setConfirming(true);
    try {
      const r = await fetch('/api/portability/import/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importId: diff.importId }),
      });
      const body = await r.json();
      if (!r.ok) {
        toast.error(body.detail ?? body.error ?? 'Import failed');
        setConfirming(false);
        return;
      }
      toast.success(`Replaced ${body.totalInserted} rows from upload`);
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      console.error(err);
      toast.error('Import failed');
      setConfirming(false);
    }
  }

  function handleCancel() {
    if (confirming) return;
    setDiff(null);
    setConfirmText('');
  }

  const replaceOK = confirmText === 'REPLACE';

  // Sort tables by row count desc, show only ones that have either
  // willDelete or willInsert > 0 (otherwise it's just noise).
  const tableRows = diff
    ? Object.keys(diff.willDelete)
        .filter((t) => (diff.willDelete[t] ?? 0) > 0 || (diff.willInsert[t] ?? 0) > 0)
        .sort((a, b) => {
          const aTotal = (diff.willInsert[a] ?? 0) + (diff.willDelete[a] ?? 0);
          const bTotal = (diff.willInsert[b] ?? 0) + (diff.willDelete[b] ?? 0);
          return bTotal - aTotal;
        })
    : [];

  return (
    <>
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Data portability</h2>
          <p className="text-sm text-[var(--dxp-text-secondary)]">
            Export everything you entered as a single JSON file, or replace your
            data by uploading a previously-saved export. Replace mode wipes every
            row you own and reinserts from the file in a single transaction.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={handleExport}>
              <Download className="mr-2 h-4 w-4" />
              Download JSON
            </Button>
            <Button variant="danger" onClick={handlePickFile} disabled={uploading}>
              {uploading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              Replace from JSON…
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={handleFileChosen}
            />
          </div>
        </CardContent>
      </Card>

      {diff && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="portability-modal-title"
        >
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-[var(--dxp-surface-1)] shadow-xl">
            <div className="flex items-start justify-between border-b border-[var(--dxp-border)] p-5">
              <div>
                <h3
                  id="portability-modal-title"
                  className="flex items-center gap-2 text-lg font-semibold"
                >
                  <AlertTriangle className="h-5 w-5 text-[var(--dxp-color-danger)]" />
                  Replace all data
                </h3>
                <p className="mt-1 text-sm text-[var(--dxp-text-secondary)]">
                  Export taken {new Date(diff.exportedAt).toLocaleString()} ·{' '}
                  {diff.totalWillInsert} rows. Your current{' '}
                  {diff.totalWillDelete} rows will be wiped first.
                </p>
                {(diff.totalStrippedKeys ?? 0) > 0 && (
                  <p className="mt-1 text-sm text-[var(--dxp-text-secondary)]">
                    {diff.totalStrippedKeys} unrecognised field
                    {diff.totalStrippedKeys === 1 ? '' : 's'} in the file will
                    be ignored.
                  </p>
                )}
              </div>
              <button
                onClick={handleCancel}
                disabled={confirming}
                className="text-[var(--dxp-text-secondary)] hover:text-[var(--dxp-text-primary)]"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-5">
              {tableRows.length === 0 ? (
                <p className="text-sm text-[var(--dxp-text-secondary)]">
                  The upload is empty and you have no existing data — nothing to
                  do. Cancel to abort.
                </p>
              ) : (
                <div className="overflow-hidden rounded border border-[var(--dxp-border)]">
                  <table className="w-full text-sm">
                    <thead className="bg-[var(--dxp-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--dxp-text-secondary)]">
                      <tr>
                        <th className="px-3 py-2">Table</th>
                        <th className="px-3 py-2 text-right">Wipe</th>
                        <th className="px-3 py-2 text-right">Insert</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tableRows.map((t) => (
                        <tr
                          key={t}
                          className="border-t border-[var(--dxp-border)] odd:bg-[var(--dxp-surface-1)] even:bg-[var(--dxp-surface-2)]/30"
                        >
                          <td className="px-3 py-1.5 font-mono text-xs">{t}</td>
                          <td className="px-3 py-1.5 text-right text-[var(--dxp-color-danger)]">
                            {diff.willDelete[t] || 0}
                          </td>
                          <td className="px-3 py-1.5 text-right text-[var(--dxp-color-success)]">
                            +{diff.willInsert[t] || 0}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="mt-5">
                <label
                  htmlFor="portability-confirm-input"
                  className="block text-sm font-medium"
                >
                  Type REPLACE to confirm
                </label>
                <Input
                  id="portability-confirm-input"
                  className="mt-1"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="REPLACE"
                  autoComplete="off"
                  disabled={confirming}
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-[var(--dxp-border)] p-4">
              <Button variant="ghost" onClick={handleCancel} disabled={confirming}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={handleConfirm}
                disabled={!replaceOK || confirming}
              >
                {confirming ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <AlertTriangle className="mr-2 h-4 w-4" />
                )}
                Replace my data
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
