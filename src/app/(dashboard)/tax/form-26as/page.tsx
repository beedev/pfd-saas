'use client';

/**
 * Form 26AS reconciliation page — Sprint 5.14 rewrite.
 *
 * The old layout had two side-by-side columns (books rows on the left
 * with checkboxes, 26AS uploads on the right) and a single consolidated
 * "Discrepancy ₹X" headline computed as `26AS_total − books_total`.
 * When books and 26AS deductors didn't overlap (very common — demo
 * seed deductors in books vs the real employer in 26AS) the number was
 * meaningless and the UI gave no path to reconcile anything.
 *
 * The new layout flips to per-TAN matching:
 *   - Top: headline summary with five buckets.
 *   - Middle: per-TAN match cards, sorted by attention priority.
 *   - Bottom: collapsible upload panel so the file-upload affordance
 *     stays accessible but doesn't dominate the page.
 *
 * Each match card shows the 26AS side and books side aggregated to a
 * single TAN, a delta, a status badge, and a "likely explanation" hint
 * when a heuristic fires. Cards with both sides also expose an
 * "Accept this match" button that persists the user's decision via
 * /api/tax/reconciliation/per-tan/accept.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  Button,
  Card,
  CardHeader,
  CardContent,
  Badge,
  Select,
  Input,
} from '@dxp/ui';
import { ScreenReportButton } from '@/components/reports/screen-report-button';
import {
  Loader2,
  Upload,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  PlusCircle,
  MinusCircle,
  Trash2,
  FileText,
  ChevronDown,
  ChevronRight,
  ArrowRight,
  ArrowLeft,
  Lightbulb,
  Link2,
  Undo2,
} from 'lucide-react';
import { toast } from 'sonner';
import { getCurrentFinancialYear } from '@/lib/finance/tax-constants';

// ─── shapes ────────────────────────────────────────────────────────────

type TanStatus =
  | 'matched'
  | 'partial'
  | 'mismatch'
  | 'unmatched-in-26as'
  | 'unmatched-in-books';

interface ReconBooksSide {
  totalTdsPaisa: number;
  sections: string[];
  rowCount: number;
  rowIds: number[];
  sources: string[];
  allReconciled: boolean;
  reconciledViaUploadId: number | null;
}

interface Recon26asSide {
  totalTdsPaisa: number;
  totalPaidPaisa: number;
  section: string | null;
  transactionDate: string | null;
  uploadId: number;
  deductorName: string;
}

interface TanMatch {
  tan: string;
  books: ReconBooksSide | null;
  form26as: Recon26asSide | null;
  deltaPaisa: number;
  status: TanStatus;
  explanation: string | null;
}

interface ReconResp {
  fy: string;
  summary: {
    reconciledCount: number;
    partialCount: number;
    mismatchedCount: number;
    unmatchedInBooksCount: number;
    unmatchedIn26asCount: number;
    totalBooksPaisa: number;
    total26asPaisa: number;
    totalDeltaPaisa: number;
  };
  tans: TanMatch[];
}

interface UploadRow {
  id: number;
  fy: string;
  filePath: string;
  uploadedAt: string | null;
  parsedTotalTdsPaisa: number | null;
  parsedTotalIncomePaisa: number | null;
  parseNotes: string | null;
}

// ─── helpers ───────────────────────────────────────────────────────────

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

function statusMeta(s: TanStatus): {
  label: string;
  icon: React.ReactNode;
  badgeVariant: 'success' | 'warning' | 'danger' | 'info' | 'default';
  cardBorder: string;
} {
  switch (s) {
    case 'matched':
      return {
        label: '✓ Matched',
        icon: <CheckCircle2 className="h-5 w-5 text-emerald-500" />,
        badgeVariant: 'success',
        cardBorder: 'border-emerald-300',
      };
    case 'partial':
      return {
        label: '⚠ Partial',
        icon: <AlertTriangle className="h-5 w-5 text-amber-500" />,
        badgeVariant: 'warning',
        cardBorder: 'border-amber-300',
      };
    case 'mismatch':
      return {
        label: '✗ Mismatch',
        icon: <XCircle className="h-5 w-5 text-rose-500" />,
        badgeVariant: 'danger',
        cardBorder: 'border-rose-300',
      };
    case 'unmatched-in-26as':
      return {
        label: '➕ Not in 26AS',
        icon: <PlusCircle className="h-5 w-5 text-sky-500" />,
        badgeVariant: 'info',
        cardBorder: 'border-sky-300',
      };
    case 'unmatched-in-books':
      return {
        label: '➖ Not in books',
        icon: <MinusCircle className="h-5 w-5 text-violet-500" />,
        badgeVariant: 'default',
        cardBorder: 'border-violet-300',
      };
  }
}

// ─── page ──────────────────────────────────────────────────────────────

export default function Form26asPage() {
  const [fy, setFy] = useState<string>(previousFy());
  const [data, setData] = useState<ReconResp | null>(null);
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pendingTan, setPendingTan] = useState<string | null>(null);
  const [uploadPanelOpen, setUploadPanelOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [reconR, indexR] = await Promise.all([
        fetch(`/api/tax/reconciliation/per-tan?fy=${encodeURIComponent(fy)}`),
        fetch(`/api/tax/form-26as?fy=${encodeURIComponent(fy)}`),
      ]);
      if (!reconR.ok) throw new Error('Failed to load reconciliation');
      const recon = (await reconR.json()) as ReconResp;
      setData(recon);
      if (indexR.ok) {
        const idx = (await indexR.json()) as { uploads: UploadRow[] };
        setUploads(idx.uploads ?? []);
      } else {
        setUploads([]);
      }
      setExpanded(new Set());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setIsLoading(false);
    }
  }, [fy]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleExpanded = (tan: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(tan)) next.delete(tan);
      else next.add(tan);
      return next;
    });
  };

  const handleAcceptMatch = async (tan: string, uploadId: number) => {
    setPendingTan(tan);
    try {
      const r = await fetch('/api/tax/reconciliation/per-tan/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fy, tan, uploadId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || 'Accept failed');
      toast.success(`Matched ${d.matchedCount} row${d.matchedCount === 1 ? '' : 's'} for ${tan}`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Accept failed');
    } finally {
      setPendingTan(null);
    }
  };

  const handleUndoMatch = async (tan: string) => {
    setPendingTan(tan);
    try {
      const params = new URLSearchParams({ fy, tan });
      const r = await fetch(`/api/tax/reconciliation/per-tan/accept?${params.toString()}`, {
        method: 'DELETE',
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || 'Undo failed');
      toast.success(`Cleared ${d.clearedCount} reconciliation${d.clearedCount === 1 ? '' : 's'}`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Undo failed');
    } finally {
      setPendingTan(null);
    }
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
      toast.success('Uploaded — recomputing reconciliation');
      setFile(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setIsUploading(false);
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

  // Empty-state — no books rows AND no 26AS uploads.
  const isFullyEmpty =
    !isLoading &&
    data &&
    data.tans.length === 0 &&
    uploads.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
            Form 26AS Reconciliation
          </h1>
          <p className="text-[var(--dxp-text-secondary)]">
            Match every deductor (by TAN) between your books and the IT department&apos;s 26AS
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-40">
            <Select options={fyOptions} value={fy} onChange={(v) => setFy(v)} />
          </div>
          <ScreenReportButton reportId="form26as-recon" fy={fy} />
        </div>
      </div>

      {/* ── Empty state ── */}
      {isFullyEmpty && (
        <Card>
          <CardContent>
            <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
              <Upload className="h-12 w-12 text-[var(--dxp-text-muted)]" />
              <h3 className="text-lg font-bold text-[var(--dxp-text)]">
                No reconciliation data yet for FY {fy}
              </h3>
              <p className="max-w-md text-sm text-[var(--dxp-text-secondary)]">
                Upload your Form 26AS PDF to see per-deductor matches against your books.
                If you also need to log TDS credits manually, add them under{' '}
                <a href="/tax/itr3/tds" className="text-[var(--dxp-brand)] underline">
                  Tax → ITR Filing → TDS
                </a>
                .
              </p>
              <Button
                variant="primary"
                onClick={() => setUploadPanelOpen(true)}
                className="mt-2"
              >
                <Upload className="mr-2 h-4 w-4" />
                Upload 26AS PDF
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Loading ── */}
      {isLoading && (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--dxp-text-muted)]" />
        </div>
      )}

      {/* ── Headline summary ── */}
      {!isLoading && data && !isFullyEmpty && (
        <SummaryCard data={data} />
      )}

      {/* ── Per-TAN cards ── */}
      {!isLoading && data && data.tans.length > 0 && (
        <div className="space-y-4">
          {data.tans.map((m) => (
            <TanCard
              key={m.tan}
              match={m}
              expanded={expanded.has(m.tan)}
              onToggleExpand={() => toggleExpanded(m.tan)}
              onAcceptMatch={handleAcceptMatch}
              onUndoMatch={handleUndoMatch}
              pending={pendingTan === m.tan}
            />
          ))}
        </div>
      )}

      {/* ── Collapsible upload panel ── */}
      {!isLoading && data && !isFullyEmpty && (
        <Card>
          <CardHeader>
            <button
              type="button"
              onClick={() => setUploadPanelOpen((v) => !v)}
              className="flex w-full items-center justify-between text-left"
            >
              <div className="flex items-center gap-2">
                <Upload className="h-4 w-4 text-[var(--dxp-text-muted)]" />
                <h3 className="text-base font-bold text-[var(--dxp-text)]">
                  Form 26AS uploads ({uploads.length})
                </h3>
              </div>
              {uploadPanelOpen ? (
                <ChevronDown className="h-4 w-4 text-[var(--dxp-text-muted)]" />
              ) : (
                <ChevronRight className="h-4 w-4 text-[var(--dxp-text-muted)]" />
              )}
            </button>
          </CardHeader>
          {uploadPanelOpen && (
            <CardContent>
              <div className="mb-4 rounded-lg border border-[var(--dxp-border)] p-3">
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                  Upload Form 26AS PDF for FY {fy}
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    type="file"
                    accept="application/pdf"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleUpload}
                    disabled={isUploading || !file}
                  >
                    {isUploading ? (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    ) : (
                      <Upload className="mr-1 h-3 w-3" />
                    )}
                    Upload
                  </Button>
                </div>
                <p className="mt-1 text-xs text-[var(--dxp-text-muted)]">
                  We parse per-deductor rows from PART-I. Each TAN becomes a match card above.
                </p>
              </div>

              {uploads.length === 0 ? (
                <p className="text-sm text-[var(--dxp-text-muted)]">
                  No Form 26AS uploaded yet for FY {fy}.
                </p>
              ) : (
                <div className="space-y-2">
                  {uploads.map((u) => (
                    <div
                      key={u.id}
                      className="flex items-start justify-between rounded border border-[var(--dxp-border-light)] p-3"
                    >
                      <div className="flex items-start gap-2">
                        <FileText className="mt-0.5 h-4 w-4 text-[var(--dxp-text-muted)]" />
                        <div>
                          <p className="text-sm font-bold text-[var(--dxp-text)]">
                            {u.filePath.split('/').pop()}
                          </p>
                          <p className="text-xs text-[var(--dxp-text-muted)]">
                            Uploaded {u.uploadedAt ? new Date(u.uploadedAt).toLocaleString() : '—'}
                            {' · '}Parsed TDS:{' '}
                            <span className="font-mono">
                              {u.parsedTotalTdsPaisa != null
                                ? formatINR(u.parsedTotalTdsPaisa)
                                : 'not detected'}
                            </span>
                          </p>
                          {u.parseNotes && (
                            <p className="text-xs text-amber-600 dark:text-amber-400">
                              {u.parseNotes}
                            </p>
                          )}
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
                  ))}
                </div>
              )}
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}

// ─── Summary card ──────────────────────────────────────────────────────

function SummaryCard({ data }: { data: ReconResp }) {
  const { summary } = data;
  const hasIssues =
    summary.mismatchedCount + summary.partialCount + summary.unmatchedInBooksCount > 0;
  return (
    <Card>
      <CardContent>
        <div className="flex flex-wrap items-center gap-3">
          <SummaryPill
            icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
            label="Reconciled"
            count={summary.reconciledCount}
          />
          <SummaryPill
            icon={<AlertTriangle className="h-4 w-4 text-amber-500" />}
            label="Partial"
            count={summary.partialCount}
          />
          <SummaryPill
            icon={<XCircle className="h-4 w-4 text-rose-500" />}
            label="Mismatched"
            count={summary.mismatchedCount}
          />
          <SummaryPill
            icon={<PlusCircle className="h-4 w-4 text-sky-500" />}
            label="Not in 26AS"
            count={summary.unmatchedIn26asCount}
          />
          <SummaryPill
            icon={<MinusCircle className="h-4 w-4 text-violet-500" />}
            label="Not in books"
            count={summary.unmatchedInBooksCount}
          />
        </div>
        <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <span className="text-[var(--dxp-text-muted)]">Total books:</span>{' '}
            <span className="font-mono font-bold text-[var(--dxp-text)]">
              {formatINR(summary.totalBooksPaisa)}
            </span>
          </div>
          <div>
            <span className="text-[var(--dxp-text-muted)]">Total 26AS:</span>{' '}
            <span className="font-mono font-bold text-[var(--dxp-text)]">
              {formatINR(summary.total26asPaisa)}
            </span>
          </div>
          <div>
            <span className="text-[var(--dxp-text-muted)]">Net delta:</span>{' '}
            <span
              className={`font-mono font-bold ${
                hasIssues ? 'text-amber-700' : 'text-emerald-700'
              }`}
            >
              {summary.totalDeltaPaisa < 0 ? '−' : ''}
              {formatINR(Math.abs(summary.totalDeltaPaisa))}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryPill({
  icon,
  label,
  count,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <div className="flex items-center gap-1 rounded-full border border-[var(--dxp-border-light)] px-3 py-1 text-xs">
      {icon}
      <span className="font-bold text-[var(--dxp-text)]">{count}</span>
      <span className="text-[var(--dxp-text-secondary)]">{label}</span>
    </div>
  );
}

// ─── TAN match card ────────────────────────────────────────────────────

function TanCard({
  match,
  expanded,
  onToggleExpand,
  onAcceptMatch,
  onUndoMatch,
  pending,
}: {
  match: TanMatch;
  expanded: boolean;
  onToggleExpand: () => void;
  onAcceptMatch: (tan: string, uploadId: number) => void;
  onUndoMatch: (tan: string) => void;
  pending: boolean;
}) {
  const meta = statusMeta(match.status);
  const hasBoth = match.books && match.form26as;
  const isReconciledLock =
    match.status === 'matched' &&
    match.books?.allReconciled === true &&
    match.form26as &&
    match.books?.reconciledViaUploadId === match.form26as.uploadId;

  // Resolve a display name: 26AS gives us deductorName, books only gives
  // us deductor_name on individual rows so for unmatched-in-26as we just
  // show the TAN itself (the drill-down lists the names).
  const headlineName = match.form26as?.deductorName || match.tan;

  return (
    <Card className={`border-2 ${meta.cardBorder}`}>
      <CardContent>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            {meta.icon}
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-bold text-[var(--dxp-text)]">{headlineName}</h3>
                <Badge variant={meta.badgeVariant}>{meta.label}</Badge>
                {isReconciledLock && (
                  <Badge variant="success">
                    <Link2 className="mr-1 inline h-3 w-3" />
                    Reconciled
                  </Badge>
                )}
              </div>
              <p className="font-mono text-xs text-[var(--dxp-text-muted)]">{match.tan}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onToggleExpand}>
            {expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            <span className="ml-1 text-xs">view</span>
          </Button>
        </div>

        {/* Body: two columns when both sides exist; single column otherwise. */}
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {match.form26as ? (
            <SidePanel
              title="From 26AS"
              tone="info"
              rows={[
                { label: 'Paid', value: formatINR(match.form26as.totalPaidPaisa) },
                {
                  label: 'TDS',
                  value: formatINR(match.form26as.totalTdsPaisa),
                  bold: true,
                },
                { label: 'Section', value: match.form26as.section || '—' },
                {
                  label: 'Transaction date',
                  value: match.form26as.transactionDate || '—',
                },
              ]}
            />
          ) : (
            <SidePanel
              title="From 26AS"
              tone="muted"
              rows={[{ label: '', value: 'No matching deductor in 26AS yet.' }]}
            />
          )}
          {match.books ? (
            <SidePanel
              title={`Your books (${match.books.rowCount} ${match.books.rowCount === 1 ? 'row' : 'rows'})`}
              tone="default"
              rows={[
                {
                  label: 'TDS',
                  value: formatINR(match.books.totalTdsPaisa),
                  bold: true,
                },
                {
                  label: 'Sections',
                  value: match.books.sections.length > 0 ? match.books.sections.join(', ') : '—',
                },
                {
                  label: 'Sources',
                  value: match.books.sources.join(', '),
                },
              ]}
            />
          ) : (
            <SidePanel
              title="Your books"
              tone="muted"
              rows={[{ label: '', value: 'No books entry for this TAN yet.' }]}
            />
          )}
        </div>

        {/* Delta + explanation */}
        {hasBoth && (
          <div className="mt-3 border-t border-[var(--dxp-border-light)] pt-3 text-sm">
            <DeltaLine delta={match.deltaPaisa} />
            {match.explanation && (
              <p className="mt-2 flex items-start gap-2 text-xs text-[var(--dxp-text-secondary)]">
                <Lightbulb className="mt-0.5 h-3 w-3 flex-shrink-0 text-amber-500" />
                <span>
                  <span className="font-bold text-[var(--dxp-text)]">Likely explanation:</span>{' '}
                  {match.explanation}
                </span>
              </p>
            )}
          </div>
        )}

        {/* Single-side explanation (no delta line) */}
        {!hasBoth && match.explanation && (
          <p className="mt-3 flex items-start gap-2 border-t border-[var(--dxp-border-light)] pt-3 text-xs text-[var(--dxp-text-secondary)]">
            <Lightbulb className="mt-0.5 h-3 w-3 flex-shrink-0 text-amber-500" />
            <span>{match.explanation}</span>
          </p>
        )}

        {/* Actions */}
        <div className="mt-3 flex flex-wrap gap-2">
          {hasBoth && !isReconciledLock && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => onAcceptMatch(match.tan, match.form26as!.uploadId)}
              disabled={pending}
            >
              {pending ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-1 h-3 w-3" />
              )}
              Accept this match
            </Button>
          )}
          {isReconciledLock && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onUndoMatch(match.tan)}
              disabled={pending}
            >
              {pending ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Undo2 className="mr-1 h-3 w-3" />
              )}
              Undo match
            </Button>
          )}
          {match.books && match.books.rowIds.length > 0 && (
            <a href="/tax/itr3/tds">
              <Button variant="ghost" size="sm">
                Open books rows
              </Button>
            </a>
          )}
          {!match.books && match.form26as && (
            <a
              href={`/tax/itr3/tds/new?prefillTan=${encodeURIComponent(match.tan)}&prefillTds=${match.form26as.totalTdsPaisa}&prefillName=${encodeURIComponent(match.form26as.deductorName)}&prefillSection=${encodeURIComponent(match.form26as.section ?? '')}`}
            >
              <Button variant="primary" size="sm">
                Create books entry
              </Button>
            </a>
          )}
        </div>

        {/* Drill-down — contributing books rows */}
        {expanded && match.books && match.books.rowIds.length > 0 && (
          <div className="mt-4 rounded border border-[var(--dxp-border-light)] bg-[var(--dxp-surface-alt,var(--dxp-surface))] p-3">
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
              Contributing books rows ({match.books.rowCount})
            </p>
            <ul className="space-y-1 text-xs">
              {match.books.rowIds.map((rowId) => (
                <li key={rowId} className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[var(--dxp-text-muted)]">
                    tds_credits #{rowId}
                  </span>
                  <a
                    href="/tax/itr3/tds"
                    className="text-[var(--dxp-brand)] underline"
                  >
                    Open
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SidePanel({
  title,
  tone,
  rows,
}: {
  title: string;
  tone: 'default' | 'info' | 'muted';
  rows: Array<{ label: string; value: string; bold?: boolean }>;
}) {
  const bg =
    tone === 'info'
      ? 'bg-sky-50/40 dark:bg-sky-950/20'
      : tone === 'muted'
      ? 'bg-[var(--dxp-surface-alt,var(--dxp-surface))]'
      : 'bg-transparent';
  return (
    <div className={`rounded border border-[var(--dxp-border-light)] p-3 ${bg}`}>
      <p className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
        {title}
      </p>
      <div className="space-y-1 text-sm">
        {rows.map((row, i) => (
          <div key={i} className="flex items-baseline justify-between gap-2">
            {row.label && (
              <span className="text-xs text-[var(--dxp-text-muted)]">{row.label}</span>
            )}
            <span
              className={`text-right ${
                row.bold
                  ? 'font-mono font-bold text-[var(--dxp-text)]'
                  : 'text-[var(--dxp-text)]'
              }`}
            >
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DeltaLine({ delta }: { delta: number }) {
  if (delta === 0) {
    return (
      <p className="text-xs text-emerald-700">
        <CheckCircle2 className="mr-1 inline h-3 w-3" />
        Books and 26AS are aligned.
      </p>
    );
  }
  const arrow = delta < 0 ? <ArrowLeft className="inline h-3 w-3" /> : <ArrowRight className="inline h-3 w-3" />;
  const side = delta < 0 ? '26AS' : 'Books';
  return (
    <p className="text-xs text-[var(--dxp-text-secondary)]">
      <span className="font-bold text-[var(--dxp-text)]">Delta:</span>{' '}
      {arrow} {side} has{' '}
      <span className="font-mono font-bold text-[var(--dxp-text)]">
        {formatINR(Math.abs(delta))}
      </span>{' '}
      more
    </p>
  );
}
