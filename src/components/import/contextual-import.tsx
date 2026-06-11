'use client';

/**
 * Contextual import — a button that lives next to a domain's "Add" control
 * and runs the upload → parse → preview → commit flow inline, instead of
 * sending the user off to a separate import page.
 *
 * The component owns the lifecycle (file pick, parse call, busy/error state,
 * modal); each caller supplies the domain specifics:
 *   • accept           — file types
 *   • parseEndpoint    — POSTs the file, returns { parsed }
 *   • renderPreview    — how to show the parsed result
 *   • canImport        — is the parsed result importable?
 *   • commit           — persist it (domain's own POST)
 *   • onImported       — refresh the caller's list
 */

import { useRef, useState, type ReactNode } from 'react';
import { Button } from '@dxp/ui';
import { Upload, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';

interface Props<TParsed> {
  /** Button label, e.g. "Import". */
  buttonLabel?: string;
  buttonVariant?: 'primary' | 'secondary';
  /** Modal heading. */
  title: string;
  /** A one-line hint under the title (e.g. "KFINTECH/CAMS PDF or Zerodha xlsx"). */
  subtitle?: string;
  /** Accept attribute, e.g. ".pdf,.xlsx". */
  accept: string;
  /** Parse endpoint (multipart `file`, optional `hint`). Defaults to the
   *  generic statement parser. */
  parseEndpoint?: string;
  /** Optional DocType hint forwarded to the parser. */
  hint?: string;
  /** Render the parsed payload (the `parsed` field of the parse response). */
  renderPreview: (parsed: TParsed) => ReactNode;
  /** Whether the parsed payload can be imported (e.g. has rows). */
  canImport: (parsed: TParsed) => boolean;
  /** Persist the parsed payload. Throw to surface an error. */
  commit: (parsed: TParsed) => Promise<void>;
  /** Called after a successful import so the caller can refresh. */
  onImported?: () => void;
}

const DEFAULT_PARSE = '/api/investments/import/parse';

export function ContextualImport<TParsed>({
  buttonLabel = 'Import',
  buttonVariant = 'secondary',
  title,
  subtitle,
  accept,
  parseEndpoint = DEFAULT_PARSE,
  hint,
  renderPreview,
  canImport,
  commit,
  onImported,
}: Props<TParsed>) {
  const [open, setOpen] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [parsed, setParsed] = useState<TParsed | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setParsed(null);
    setFileName(null);
    setParsing(false);
    setImporting(false);
  };

  const onFile = async (file: File) => {
    setFileName(file.name);
    setParsing(true);
    setParsed(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (hint) fd.append('hint', hint);
      const r = await fetch(parseEndpoint, { method: 'POST', body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || 'Could not read the file');
      setParsed((d.parsed ?? d) as TParsed);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Parse failed');
    } finally {
      setParsing(false);
    }
  };

  const doImport = async () => {
    if (!parsed) return;
    setImporting(true);
    try {
      await commit(parsed);
      toast.success('Imported');
      setOpen(false);
      reset();
      onImported?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <Button variant={buttonVariant} onClick={() => setOpen(true)}>
        <Upload className="mr-2 h-4 w-4" /> {buttonLabel}
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-16">
          <div className="w-full max-w-2xl rounded-lg border border-[var(--dxp-border)] bg-[var(--dxp-surface,#fff)] shadow-xl">
            <div className="flex items-start justify-between border-b border-[var(--dxp-border-light)] p-4">
              <div>
                <h3 className="text-base font-bold text-[var(--dxp-text)]">{title}</h3>
                {subtitle && <p className="text-xs text-[var(--dxp-text-muted)]">{subtitle}</p>}
              </div>
              <button
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
                className="text-[var(--dxp-text-muted)] hover:text-[var(--dxp-text)]"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 p-4">
              {/* Drop / pick */}
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="flex w-full flex-col items-center gap-2 rounded-md border-2 border-dashed border-[var(--dxp-border)] p-6 text-sm text-[var(--dxp-text-secondary)] hover:border-[var(--dxp-brand)]"
              >
                <Upload className="h-6 w-6 text-[var(--dxp-text-muted)]" />
                {fileName ? <span className="font-medium">{fileName}</span> : <span>Choose a file ({accept})</span>}
                <span className="text-xs text-[var(--dxp-text-muted)]">Click to browse</span>
              </button>
              <input
                ref={inputRef}
                type="file"
                accept={accept}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFile(f);
                  e.target.value = '';
                }}
              />

              {parsing && (
                <div className="flex items-center gap-2 text-sm text-[var(--dxp-text-muted)]">
                  <Loader2 className="h-4 w-4 animate-spin" /> Reading {fileName}…
                </div>
              )}

              {parsed && !parsing && (
                <div className="rounded-md border border-[var(--dxp-border-light)] p-3">
                  {renderPreview(parsed)}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-[var(--dxp-border-light)] p-4">
              <Button
                variant="secondary"
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={doImport}
                disabled={!parsed || parsing || importing || !canImport(parsed)}
              >
                {importing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Import
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
