'use client';

/**
 * Form 26AS reconciliation page — Sprint 4 Phase 2.
 *
 * Two halves side-by-side:
 *   Left  — TDS credits the user logged in their books (tds_credits rows
 *           for the FY) with checkboxes + a "Mark selected reconciled" CTA.
 *   Right — Form 26AS uploads. Multipart upload form on top, list of
 *           prior uploads + their parsed-total-TDS numbers below.
 *
 * Banner across the top compares the two totals and colours green for
 * match (within ±₹1k tolerance), amber for mismatch. The ±₹1k tolerance
 * exists because rounding inside the 26AS parser is best-effort.
 *
 * Manual reconciliation flow: tick boxes on the left, click "Mark
 * reconciled against this upload" on a chosen upload's row.
 */

import { useEffect, useState, useCallback } from 'react';
import { Button, Card, CardHeader, CardContent, Badge, Select, Input } from '@dxp/ui';
import {
  Loader2,
  Upload,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  Link2,
  FileText,
} from 'lucide-react';
import { toast } from 'sonner';
import { getCurrentFinancialYear } from '@/lib/finance/tax-constants';

interface TdsCredit {
  id: number;
  financialYear: string;
  category: string;
  deductorName: string;
  deductorTan: string | null;
  deductorPan: string | null;
  section: string;
  incomePaisa: number;
  tdsPaisa: number;
  notes: string | null;
  isReconciled: boolean;
  reconciledViaUploadId: number | null;
}

interface UploadRow {
  id: number;
  fy: string;
  filePath: string;
  uploadedAt: string | null;
  parsedTotalTdsPaisa: number | null;
  parsedTotalIncomePaisa: number | null;
  parsedAt: string | null;
  parseNotes: string | null;
}

interface ApiResp {
  fy: string;
  uploads: UploadRow[];
  tdsCredits: TdsCredit[];
  totals: { booksTdsPaisa: number; books26asPaisaSum: number };
}

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

function generateFyOptions(): string[] {
  const current = getCurrentFinancialYear();
  const startYear = Number(current.split('-')[0]);
  const out: string[] = [];
  for (let i = -2; i <= 2; i++) {
    const s = startYear + i;
    const e = String((s + 1) % 100).padStart(2, '0');
    out.push(`${s}-${e}`);
  }
  return out;
}

function previousFy(): string {
  const current = getCurrentFinancialYear();
  const startYear = Number(current.split('-')[0]) - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

export default function Form26asPage() {
  const [fy, setFy] = useState<string>(previousFy());
  const [data, setData] = useState<ApiResp | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const r = await fetch(`/api/tax/form-26as?fy=${encodeURIComponent(fy)}`);
      if (!r.ok) throw new Error('Failed to load');
      const d = (await r.json()) as ApiResp;
      setData(d);
      setSelectedIds(new Set());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setIsLoading(false);
    }
  }, [fy]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleSelected = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleUpload = async () => {
    if (!file) {
      toast.error('Pick a PDF first');
      return;
    }
    setIsUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('fy', fy);
      const r = await fetch('/api/tax/form-26as/upload', { method: 'POST', body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || 'Upload failed');
      toast.success('Uploaded — parsed totals below');
      setFile(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  const handleMatch = async (uploadId: number) => {
    if (selectedIds.size === 0) {
      toast.error('Tick the TDS rows you want to reconcile first');
      return;
    }
    try {
      const r = await fetch(`/api/tax/form-26as/${uploadId}/match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tdsCreditIds: [...selectedIds] }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || 'Match failed');
      toast.success(`Reconciled ${d.matchedCount} row(s)`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Match failed');
    }
  };

  const handleUnmatch = async (uploadId: number) => {
    try {
      const r = await fetch(`/api/tax/form-26as/${uploadId}/match`, { method: 'DELETE' });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || 'Unmatch failed');
      toast.success(`Cleared ${d.clearedCount} reconciliation(s)`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Unmatch failed');
    }
  };

  const handleDeleteUpload = async (uploadId: number) => {
    if (!confirm('Delete this Form 26AS upload? Reconciliations against it will be cleared.')) return;
    try {
      const r = await fetch(`/api/tax/form-26as/upload?id=${uploadId}`, { method: 'DELETE' });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || 'Delete failed');
      toast.success('Upload deleted');
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const fyOptions = generateFyOptions().map((y) => ({ value: y, label: `FY ${y}` }));

  // Banner math
  const booksTotal = data?.totals.booksTdsPaisa ?? 0;
  const tracesTotal = data?.totals.books26asPaisaSum ?? 0;
  const delta = booksTotal - tracesTotal;
  const tolerancePaisa = 100_000; // ±₹1k
  const isMatch = data && Math.abs(delta) <= tolerancePaisa;
  const hasUploads = (data?.uploads.length ?? 0) > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
            Form 26AS Reconciliation
          </h1>
          <p className="text-[var(--dxp-text-secondary)]">
            Match the TDS credits you logged against what the IT department&apos;s 26AS PDF shows
          </p>
        </div>
        <div className="w-40">
          <Select options={fyOptions} value={fy} onChange={(v) => setFy(v)} />
        </div>
      </div>

      {/* Top banner */}
      {!isLoading && data && hasUploads && (
        <Card>
          <CardContent>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {isMatch ? (
                  <CheckCircle2 className="h-7 w-7 text-emerald-500" />
                ) : (
                  <AlertTriangle className="h-7 w-7 text-amber-500" />
                )}
                <div>
                  <p className="text-base font-bold text-[var(--dxp-text)]">
                    {isMatch
                      ? `Reconciled — books match Form 26AS within ±₹1k.`
                      : `Discrepancy of ${formatINR(Math.abs(delta))} between your books and Form 26AS.`}
                  </p>
                  <p className="text-xs text-[var(--dxp-text-muted)]">
                    Books: <span className="font-mono">{formatINR(booksTotal)}</span> &nbsp;·&nbsp; Form 26AS (sum across {data.uploads.length} upload{data.uploads.length === 1 ? '' : 's'}): <span className="font-mono">{formatINR(tracesTotal)}</span>
                  </p>
                </div>
              </div>
              <Badge variant={isMatch ? 'success' : 'warning'}>
                {isMatch ? 'MATCH' : 'MISMATCH'}
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading || !data ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--dxp-text-muted)]" />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* LEFT — from your books */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-[var(--dxp-text)]">
                  From your books — {data.tdsCredits.length} TDS row{data.tdsCredits.length === 1 ? '' : 's'}
                </h3>
                <span className="font-mono text-sm text-[var(--dxp-text-secondary)]">
                  Total: {formatINR(booksTotal)}
                </span>
              </div>
            </CardHeader>
            <CardContent>
              {data.tdsCredits.length === 0 ? (
                <p className="text-sm text-[var(--dxp-text-muted)]">
                  No TDS credits logged for FY {fy}. Add them under{' '}
                  <a href="/tax/itr3/tds" className="text-[var(--dxp-brand)] underline">
                    Tax → ITR Filing → TDS
                  </a>
                  .
                </p>
              ) : (
                <div className="space-y-2">
                  {data.tdsCredits.map((c) => {
                    const checked = selectedIds.has(c.id);
                    return (
                      <label
                        key={c.id}
                        className="flex cursor-pointer items-center gap-3 rounded border border-[var(--dxp-border-light)] px-3 py-2 hover:bg-[var(--dxp-surface-alt,var(--dxp-surface))]"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSelected(c.id)}
                          className="h-4 w-4"
                        />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-bold text-[var(--dxp-text)]">{c.deductorName}</p>
                            <Badge variant="default">{c.section}</Badge>
                            <Badge variant="info">{c.category}</Badge>
                            {c.isReconciled && (
                              <Badge variant="success">Reconciled</Badge>
                            )}
                          </div>
                          <p className="text-xs text-[var(--dxp-text-muted)]">
                            Income {formatINR(c.incomePaisa)} · TAN {c.deductorTan ?? '—'}
                          </p>
                        </div>
                        <span className="font-mono font-bold text-[var(--dxp-text)]">
                          {formatINR(c.tdsPaisa)}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* RIGHT — Form 26AS uploads */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-[var(--dxp-text)]">From Form 26AS</h3>
                <span className="font-mono text-sm text-[var(--dxp-text-secondary)]">
                  Total parsed: {formatINR(tracesTotal)}
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="mb-4 rounded-lg border border-[var(--dxp-border)] p-3">
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                  Upload Form 26AS PDF
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    type="file"
                    accept="application/pdf"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                  <Button variant="primary" size="sm" onClick={handleUpload} disabled={isUploading || !file}>
                    {isUploading ? (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    ) : (
                      <Upload className="mr-1 h-3 w-3" />
                    )}
                    Upload
                  </Button>
                </div>
                <p className="mt-1 text-xs text-[var(--dxp-text-muted)]">
                  We&apos;ll try to auto-extract the headline TDS total. Parsing is best-effort —
                  the file is still saved either way.
                </p>
              </div>

              {data.uploads.length === 0 ? (
                <p className="text-sm text-[var(--dxp-text-muted)]">No Form 26AS uploaded yet.</p>
              ) : (
                <div className="space-y-3">
                  {data.uploads.map((u) => {
                    const matched = data.tdsCredits.filter(
                      (c) => c.reconciledViaUploadId === u.id,
                    );
                    return (
                      <div
                        key={u.id}
                        className="rounded border border-[var(--dxp-border-light)] p-3"
                      >
                        <div className="mb-2 flex items-start justify-between">
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-[var(--dxp-text-muted)]" />
                            <div>
                              <p className="text-sm font-bold text-[var(--dxp-text)]">
                                {u.filePath.split('/').pop()}
                              </p>
                              <p className="text-xs text-[var(--dxp-text-muted)]">
                                Uploaded{' '}
                                {u.uploadedAt ? new Date(u.uploadedAt).toLocaleString() : '—'}
                              </p>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteUpload(u.id)}
                          >
                            <Trash2 className="h-3 w-3 text-rose-500" />
                          </Button>
                        </div>
                        <div className="mb-2 grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <span className="text-[var(--dxp-text-muted)]">Parsed TDS:</span>{' '}
                            <span className="font-mono font-bold text-[var(--dxp-text)]">
                              {u.parsedTotalTdsPaisa != null
                                ? formatINR(u.parsedTotalTdsPaisa)
                                : 'not detected'}
                            </span>
                          </div>
                          <div>
                            <span className="text-[var(--dxp-text-muted)]">Parsed Income:</span>{' '}
                            <span className="font-mono font-bold text-[var(--dxp-text)]">
                              {u.parsedTotalIncomePaisa != null
                                ? formatINR(u.parsedTotalIncomePaisa)
                                : 'not detected'}
                            </span>
                          </div>
                        </div>
                        {u.parseNotes && (
                          <p className="text-xs text-amber-600 dark:text-amber-400">
                            {u.parseNotes}
                          </p>
                        )}
                        {matched.length > 0 && (
                          <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
                            Reconciled against {matched.length} TDS row
                            {matched.length === 1 ? '' : 's'}
                          </p>
                        )}
                        <div className="mt-2 flex gap-2">
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => handleMatch(u.id)}
                            disabled={selectedIds.size === 0}
                          >
                            <Link2 className="mr-1 h-3 w-3" />
                            Mark selected reconciled
                          </Button>
                          {matched.length > 0 && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleUnmatch(u.id)}
                            >
                              Unlink {matched.length}
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
