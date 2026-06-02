'use client';

/**
 * EPF + NPS Statement Import — Sprint 5.6e.
 *
 * Standalone page (kept separate from /investments/import which handles
 * the older LIC / chit / MF-SIP flow) so the EPF/NPS preview + confirm
 * cycle stays simple to read.
 *
 * Flow:
 *   1. Upload PDF.
 *   2. Server detects EPF passbook or NPS Statement of Transactions,
 *      parses, returns preview + diff vs the user's matched account.
 *   3. User ticks the sections to apply (balance, contribution).
 *   4. POST /api/imports/statement/confirm to write changes.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import {
  Button,
  Card,
  CardHeader,
  CardContent,
  Badge,
  DataTable,
  type Column,
} from '@dxp/ui';
import {
  ArrowLeft,
  Upload,
  Loader2,
  FileText,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';

/* ─── server response shapes ─────────────────────────────────────────── */

interface EpfPreview {
  uan: string | null;
  memberId: string | null;
  employerName: string | null;
  asOfDate: string | null;
  employeeBalancePaisa: number;
  employerBalancePaisa: number;
  pensionBalancePaisa: number;
  monthlyContributionPaisa: number | null;
}

interface NpsPreview {
  pran: string | null;
  subscriberName: string | null;
  tier: 'TIER1' | 'TIER2' | null;
  asOfDate: string | null;
  equityFundValuePaisa: number;
  debtFundValuePaisa: number;
  alternativeFundValuePaisa: number;
  totalValuePaisa: number;
  totalContributedPaisa: number;
  monthlyContributionPaisa: number | null;
}

interface DiffRow {
  field: string;
  currentValue: number | string | null;
  newValue: number | string | null;
}

type Kind = 'EPF_PASSBOOK' | 'NPS_SOT' | 'UNKNOWN';

interface PreviewResponse {
  importId: string;
  kind: Kind;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  preview: EpfPreview | NpsPreview | null;
  currentValues: { id: number } | null;
  diff: DiffRow[];
  warnings: string[];
}

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

const KIND_LABEL: Record<Kind, string> = {
  EPF_PASSBOOK: 'EPF Passbook',
  NPS_SOT: 'NPS Statement of Transactions',
  UNKNOWN: 'Unrecognised',
};

const CONFIDENCE_VARIANT: Record<PreviewResponse['confidence'], 'success' | 'warning' | 'danger'> = {
  HIGH: 'success',
  MEDIUM: 'warning',
  LOW: 'danger',
};

/* ─── component ──────────────────────────────────────────────────────── */

export default function StatementImportPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [resp, setResp] = useState<PreviewResponse | null>(null);
  const [applyBalance, setApplyBalance] = useState(true);
  const [applyContribution, setApplyContribution] = useState(true);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFile(e.target.files?.[0] ?? null);
    setResp(null);
  };

  const handleUpload = async () => {
    if (!file) {
      toast.error('Choose a PDF first');
      return;
    }
    setIsUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/imports/statement', {
        method: 'POST',
        body: fd,
      });
      const data = (await res.json()) as PreviewResponse | { error: string };
      if (!res.ok) throw new Error('error' in data ? data.error : 'Parse failed');
      setResp(data as PreviewResponse);
      // Reset toggles to safe defaults (only apply what's confidently parsed).
      setApplyBalance(true);
      setApplyContribution((data as PreviewResponse).preview
        ? (data as PreviewResponse).preview!.monthlyContributionPaisa !== null
          ? true
          : false
        : false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  const handleConfirm = async () => {
    if (!resp || resp.kind === 'UNKNOWN') return;
    setIsCommitting(true);
    try {
      const res = await fetch('/api/imports/statement/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          importId: resp.importId,
          kind: resp.kind,
          mappings: {
            balance: applyBalance,
            contribution: applyContribution,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Confirm failed');
      toast.success('Statement imported');
      // Navigate to the updated account's detail page.
      const sub = resp.kind === 'EPF_PASSBOOK' ? 'pf' : 'nps';
      router.push(`/investments/${sub}/${data.accountId}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Confirm failed');
    } finally {
      setIsCommitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/investments"
          className="inline-flex items-center text-sm text-[var(--dxp-text-secondary)] hover:text-[var(--dxp-brand)]"
        >
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to Investments
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
          Import EPF / NPS statement
        </h1>
        <p className="text-[var(--dxp-text-secondary)]">
          Upload your EPFO member passbook PDF or NPS Statement of Transactions PDF — we&apos;ll auto-detect the format, preview the
          changes, and update the matched account once you confirm.
        </p>
      </div>

      {/* Upload card */}
      <Card>
        <CardHeader>
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <Upload className="h-5 w-5 text-[var(--dxp-brand)]" /> Upload PDF
          </h3>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <input
              type="file"
              accept="application/pdf"
              onChange={handleFileChange}
              className="text-sm text-[var(--dxp-text)] file:mr-4 file:rounded file:border-0 file:bg-[var(--dxp-brand)] file:px-4 file:py-2 file:text-sm file:font-bold file:text-white hover:file:opacity-90"
            />
            <Button onClick={handleUpload} disabled={!file || isUploading} variant="primary">
              {isUploading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <FileText className="mr-2 h-4 w-4" />
              )}
              Parse statement
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Preview card */}
      {resp && <PreviewCard resp={resp} />}

      {/* Diff + confirm */}
      {resp && resp.kind !== 'UNKNOWN' && resp.preview && (
        <Card>
          <CardHeader>
            <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
              <CheckCircle2 className="h-5 w-5 text-[var(--dxp-brand)]" /> Review &amp; confirm
            </h3>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-2 text-sm">
              <label className="flex items-center gap-2 text-[var(--dxp-text)]">
                <input
                  type="checkbox"
                  checked={applyBalance}
                  onChange={(e) => setApplyBalance(e.target.checked)}
                />
                Apply parsed balances
              </label>
              <label className="flex items-center gap-2 text-[var(--dxp-text)]">
                <input
                  type="checkbox"
                  checked={applyContribution}
                  onChange={(e) => setApplyContribution(e.target.checked)}
                  disabled={resp.preview.monthlyContributionPaisa === null}
                />
                Apply parsed monthly contribution
                {resp.preview.monthlyContributionPaisa === null && (
                  <span className="text-xs text-[var(--dxp-text-muted)]">(not detected)</span>
                )}
              </label>
            </div>
            {resp.currentValues ? (
              <DiffTable diff={resp.diff} />
            ) : (
              <p className="text-sm text-[var(--dxp-text-secondary)]">
                No matching account found. The confirm step will return an error — link the statement to an account manually or
                create one first.
              </p>
            )}
            <Button
              onClick={handleConfirm}
              disabled={isCommitting || !resp.currentValues || (!applyBalance && !applyContribution)}
              variant="primary"
            >
              {isCommitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-2 h-4 w-4" />
              )}
              Confirm import
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ─── preview + diff sub-components ──────────────────────────────────── */

function PreviewCard({ resp }: { resp: PreviewResponse }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <FileText className="h-5 w-5 text-[var(--dxp-brand)]" /> Detected: {KIND_LABEL[resp.kind]}
          </h3>
          <Badge variant={CONFIDENCE_VARIANT[resp.confidence]}>{resp.confidence}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {resp.warnings.length > 0 && (
          <div className="rounded border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950">
            <p className="flex items-center gap-1 text-sm font-medium text-amber-900 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4" /> Warnings
            </p>
            <ul className="mt-1 list-disc pl-5 text-xs text-amber-900 dark:text-amber-200">
              {resp.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}
        {resp.preview && resp.kind === 'EPF_PASSBOOK' && (
          <EpfPreviewDl preview={resp.preview as EpfPreview} />
        )}
        {resp.preview && resp.kind === 'NPS_SOT' && (
          <NpsPreviewDl preview={resp.preview as NpsPreview} />
        )}
      </CardContent>
    </Card>
  );
}

function EpfPreviewDl({ preview }: { preview: EpfPreview }) {
  const fields: Array<[string, string]> = [
    ['UAN', preview.uan ?? '—'],
    ['Member ID', preview.memberId ?? '—'],
    ['Employer', preview.employerName ?? '—'],
    ['As of', preview.asOfDate ?? '—'],
    ['Employee balance', formatINR(preview.employeeBalancePaisa)],
    ['Employer balance', formatINR(preview.employerBalancePaisa)],
    ['Pension balance', formatINR(preview.pensionBalancePaisa)],
    [
      'Monthly contribution (derived)',
      preview.monthlyContributionPaisa !== null
        ? `${formatINR(preview.monthlyContributionPaisa)}/mo`
        : 'Not detected',
    ],
  ];
  return <DlGrid rows={fields} />;
}

function NpsPreviewDl({ preview }: { preview: NpsPreview }) {
  const fields: Array<[string, string]> = [
    ['PRAN', preview.pran ?? '—'],
    ['Subscriber', preview.subscriberName ?? '—'],
    ['Tier', preview.tier === 'TIER1' ? 'Tier I' : preview.tier === 'TIER2' ? 'Tier II' : '—'],
    ['As of', preview.asOfDate ?? '—'],
    ['Equity', formatINR(preview.equityFundValuePaisa)],
    ['Debt (C + G)', formatINR(preview.debtFundValuePaisa)],
    ['Alternative', formatINR(preview.alternativeFundValuePaisa)],
    ['Total value', formatINR(preview.totalValuePaisa)],
    ['Total contributed', formatINR(preview.totalContributedPaisa)],
    [
      'Monthly contribution (derived)',
      preview.monthlyContributionPaisa !== null
        ? `${formatINR(preview.monthlyContributionPaisa)}/mo`
        : 'Not detected',
    ],
  ];
  return <DlGrid rows={fields} />;
}

function DlGrid({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between border-b border-[var(--dxp-border)] pb-1">
          <dt className="text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
            {label}
          </dt>
          <dd className="text-sm text-[var(--dxp-text)]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function DiffTable({ diff }: { diff: DiffRow[] }) {
  if (!diff.length) {
    return (
      <p className="text-sm text-[var(--dxp-text-secondary)]">
        No changes — the parsed statement matches what&apos;s already on file.
      </p>
    );
  }
  // DataTable's Column type uses `key: keyof T` + `render(value, row)`.
  // For our display-only diff we pre-key against DiffRow fields and let
  // render swap in a formatted currency string.
  const cols: Column<DiffRow>[] = [
    { key: 'field', header: 'Field' },
    {
      key: 'currentValue',
      header: 'Current',
      render: (_value, row) => formatDiffValue(row.currentValue),
    },
    {
      key: 'newValue',
      header: 'After import',
      render: (_value, row) => formatDiffValue(row.newValue),
    },
  ];
  return <DataTable data={diff} columns={cols} />;
}

function formatDiffValue(v: number | string | null): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') {
    // Heuristic: anything > 100 is paisa, anything ≤ 100 is a small
    // count / index that's not currency. Field names are simple enough
    // that we don't track types — only one diff row carries a non-money
    // value (`tier`-style) and that's always a string here.
    return formatINR(v);
  }
  return String(v);
}
