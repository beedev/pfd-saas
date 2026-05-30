'use client';

/**
 * Statement Import Wizard — generic across LIC / Chit / MF SIP.
 *
 * Flow:
 *   1. Upload PDF (+ optional type override)
 *   2. Server parses, returns detected type + structured preview
 *   3. Type-specific preview component renders
 *   4. User confirms → POST to /api/investments/import/commit
 */

import { useState, useMemo, useCallback, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';

import {
  Button,
  Card,
  CardHeader,
  CardContent,
  Badge,
  StatsDisplay,
  DataTable,
  Select,
  type Column,
} from '@dxp/ui';
import {
  ArrowLeft,
  Upload,
  Loader2,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';

/* ─── types mirrored from server ──────────────────────────────────────── */

type DocType = 'lic' | 'chit' | 'mf-sip' | 'unknown';
type LicPaymentMode = 'Yly' | 'Hly' | 'Qly' | 'Mly' | 'Sly';
type PolicyType =
  | 'TERM_LIFE'
  | 'WHOLE_LIFE'
  | 'ENDOWMENT'
  | 'ULIP'
  | 'HEALTH'
  | 'CRITICAL_ILLNESS'
  | 'DISABILITY'
  | 'ACCIDENT';

interface LicPolicy {
  policyNumber: string;
  policyHolder: string;
  startDate: string;
  paymentMode: LicPaymentMode;
  premiumPerInstallmentPaisa: number;
  installmentsInStatement: number;
  totalPaidPaisa: number;
  totalGstPaisa: number;
  lastDueTo: string;
  nextDueDate: string;
  annualPremiumPaisa: number;
  existingId: number | null;
}

interface LicParsed {
  type: 'lic';
  statementYear: string | null;
  policyHolderName: string | null;
  totalPremiumPaisa: number;
  totalGstPaisa: number;
  installmentCount: number;
  warnings: string[];
  policies: LicPolicy[];
}

interface ChitParsed {
  type: 'chit';
  foremanName: string;
  branch: string | null;
  subscriberName: string | null;
  schemeName: string;
  ticketNumber: string | null;
  registrationNumber: string | null;
  isRegistered: boolean;
  chitValuePaisa: number;
  monthlyInstallmentPaisa: number;
  durationMonths: number;
  groupSize: number;
  startDate: string;
  expectedEndDate: string;
  installmentsPaid: number;
  totalPaidPaisa: number;
  totalDividendsPaisa: number;
  netContributionPaisa: number;
  status: 'ACTIVE' | 'WON';
  nextDueDate: string | null;
  reportDate: string | null;
  warnings: string[];
  existingId: number | null;
}

interface MfSipParsed {
  type: 'mf-sip';
  warnings: string[];
}

interface UnknownParsed {
  type: 'unknown';
  warnings: string[];
}

type Parsed = LicParsed | ChitParsed | MfSipParsed | UnknownParsed;

interface ParseResponse {
  detectedType: DocType;
  resolvedType: DocType;
  parsed: Parsed;
}

/* ─── utils ───────────────────────────────────────────────────────────── */

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

const MODE_LABEL: Record<LicPaymentMode, string> = {
  Yly: 'Yearly',
  Hly: 'Half-yearly',
  Qly: 'Quarterly',
  Mly: 'Monthly',
  Sly: 'Single',
};

const POLICY_TYPE_OPTIONS: Array<{ label: string; value: PolicyType }> = [
  { label: 'Endowment (default)', value: 'ENDOWMENT' },
  { label: 'Term life', value: 'TERM_LIFE' },
  { label: 'Whole life', value: 'WHOLE_LIFE' },
  { label: 'ULIP', value: 'ULIP' },
];

const TYPE_HINT_OPTIONS: Array<{ label: string; value: string }> = [
  { label: 'Auto-detect', value: '' },
  { label: 'LIC Premium Statement', value: 'lic' },
  { label: 'Chit Fund Account Copy', value: 'chit' },
  { label: 'Mutual Fund CAS / SIP', value: 'mf-sip' },
];

const TYPE_LABEL: Record<DocType, string> = {
  lic: 'LIC Premium Statement',
  chit: 'Chit Fund Account Copy',
  'mf-sip': 'Mutual Fund Statement',
  unknown: 'Unknown',
};

/* ─── component ───────────────────────────────────────────────────────── */

export default function ImportPageWrapper() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-[var(--dxp-text-secondary)]">Loading…</div>}>
      <ImportPage />
    </Suspense>
  );
}

function ImportPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialHint = searchParams?.get('type') ?? '';
  const [file, setFile] = useState<File | null>(null);
  const [hint, setHint] = useState<string>(initialHint);

  // Re-sync if URL changes (rare, but cheap to handle)
  useEffect(() => {
    const t = searchParams?.get('type');
    if (t && t !== hint) setHint(t);
    // intentional: only react to URL changes, not local hint changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  const [isUploading, setIsUploading] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [response, setResponse] = useState<ParseResponse | null>(null);

  // LIC selection state
  const [licSelected, setLicSelected] = useState<Set<string>>(new Set());
  const [licDefaultType, setLicDefaultType] = useState<PolicyType>('ENDOWMENT');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setResponse(null);
  };

  const handleUpload = useCallback(async () => {
    if (!file) {
      toast.error('Choose a PDF first');
      return;
    }
    setIsUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (hint) fd.append('type', hint);

      const res = await fetch('/api/investments/import/parse', {
        method: 'POST',
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Parse failed');

      const r = data as ParseResponse;
      setResponse(r);

      if (r.parsed.type === 'lic') {
        setLicSelected(new Set(r.parsed.policies.map((p) => p.policyNumber)));
        toast.success(`${TYPE_LABEL[r.resolvedType]}: found ${r.parsed.policies.length} policies`);
      } else if (r.parsed.type === 'chit') {
        toast.success(
          `${TYPE_LABEL[r.resolvedType]}: ${r.parsed.schemeName}/${r.parsed.ticketNumber ?? '?'}`
        );
      } else if (r.parsed.type === 'mf-sip') {
        toast.info('MF SIP parser is a stub — upload a sample to enable it');
      } else {
        toast.error('Could not detect document type');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      toast.error(msg);
    } finally {
      setIsUploading(false);
    }
  }, [file, hint]);

  /* ─── LIC commit ─── */
  const handleLicCommit = async () => {
    if (!response || response.parsed.type !== 'lic') return;
    if (licSelected.size === 0) {
      toast.error('Select at least one policy');
      return;
    }
    setIsCommitting(true);
    try {
      const policies = response.parsed.policies
        .filter((p) => licSelected.has(p.policyNumber))
        .map((p) => ({
          policyNumber: p.policyNumber,
          policyHolder: p.policyHolder,
          startDate: p.startDate,
          paymentMode: p.paymentMode,
          premiumPerInstallmentPaisa: p.premiumPerInstallmentPaisa,
          annualPremiumPaisa: p.annualPremiumPaisa,
          nextDueDate: p.nextDueDate,
          lastDueTo: p.lastDueTo,
          totalPaidPaisa: p.totalPaidPaisa,
          totalGstPaisa: p.totalGstPaisa,
        }));

      const res = await fetch('/api/investments/import/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'lic',
          data: {
            policies,
            statementYear: (response.parsed as LicParsed).statementYear ?? undefined,
            defaultPolicyType: licDefaultType,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Commit failed');
      toast.success(`Imported ${data.inserted} new + ${data.updated} updated policies`);
      router.push('/investments/insurance');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Commit failed';
      toast.error(msg);
    } finally {
      setIsCommitting(false);
    }
  };

  /* ─── Chit commit ─── */
  const handleChitCommit = async () => {
    if (!response || response.parsed.type !== 'chit') return;
    setIsCommitting(true);
    try {
      const res = await fetch('/api/investments/import/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'chit', data: response.parsed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Commit failed');
      toast.success(
        data.inserted ? `Created chit fund (#${data.chitId})` : `Updated chit fund (#${data.chitId})`
      );
      router.push('/investments/chit-funds');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Commit failed';
      toast.error(msg);
    } finally {
      setIsCommitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/investments"
          className="inline-flex items-center text-sm text-[var(--dxp-text-secondary)] hover:text-[var(--dxp-text)]"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to investments
        </Link>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
          Import from PDF
        </h1>
        <p className="text-[var(--dxp-text-secondary)]">
          Upload a statement to bulk-register policies, chit funds, or SIPs
        </p>
      </div>

      {/* Step 1 — Upload */}
      <Card>
        <CardHeader>
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <Upload className="h-5 w-5 text-amber-600" />
            1. Upload statement PDF
          </h3>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3">
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={handleFileChange}
              className="text-sm text-[var(--dxp-text-secondary)] file:mr-4 file:cursor-pointer file:rounded file:border-0 file:bg-amber-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-amber-700"
            />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                  Document type
                </label>
                <Select value={hint} onChange={(v) => setHint(v)} options={TYPE_HINT_OPTIONS} />
              </div>
              <Button variant="primary" onClick={handleUpload} disabled={!file || isUploading}>
                {isUploading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Parsing…
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" /> Parse PDF
                  </>
                )}
              </Button>
            </div>
            {file && !response && (
              <p className="text-xs text-[var(--dxp-text-secondary)]">
                <FileText className="inline h-3 w-3" /> {file.name} ·{' '}
                {(file.size / 1024).toFixed(1)} KB
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Detection notice */}
      {response && (
        <Card>
          <CardContent>
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              <div className="flex-1">
                <p className="text-sm">
                  Detected as{' '}
                  <strong>{TYPE_LABEL[response.resolvedType]}</strong>
                  {response.detectedType !== response.resolvedType && (
                    <span className="ml-2 text-xs text-[var(--dxp-text-secondary)]">
                      (overridden from auto-detect: {TYPE_LABEL[response.detectedType]})
                    </span>
                  )}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Warnings */}
      {response && response.parsed.warnings.length > 0 && (
        <Card className="border-l-4 border-l-amber-500 bg-amber-50">
          <CardContent>
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
              <div>
                <p className="text-xs font-bold text-amber-900">Parser warnings</p>
                <ul className="mt-1 list-disc pl-5 text-xs text-amber-800">
                  {response.parsed.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* LIC preview */}
      {response?.parsed.type === 'lic' && (
        <LicPreview
          parsed={response.parsed}
          selected={licSelected}
          setSelected={setLicSelected}
          defaultType={licDefaultType}
          setDefaultType={setLicDefaultType}
          onCommit={handleLicCommit}
          isCommitting={isCommitting}
        />
      )}

      {/* Chit preview */}
      {response?.parsed.type === 'chit' && (
        <ChitPreview
          parsed={response.parsed}
          onCommit={handleChitCommit}
          isCommitting={isCommitting}
        />
      )}
    </div>
  );
}

/* ─── LIC preview component ───────────────────────────────────────────── */

function LicPreview({
  parsed,
  selected,
  setSelected,
  defaultType,
  setDefaultType,
  onCommit,
  isCommitting,
}: {
  parsed: LicParsed;
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  defaultType: PolicyType;
  setDefaultType: (t: PolicyType) => void;
  onCommit: () => void;
  isCommitting: boolean;
}) {
  const newCount = useMemo(
    () => parsed.policies.filter((p) => !p.existingId).length,
    [parsed]
  );
  const updateCount = parsed.policies.length - newCount;

  const selectedAnnual = useMemo(
    () =>
      parsed.policies
        .filter((p) => selected.has(p.policyNumber))
        .reduce((s, p) => s + p.annualPremiumPaisa, 0),
    [parsed, selected]
  );

  const toggle = (n: string) => {
    const next = new Set(selected);
    if (next.has(n)) next.delete(n);
    else next.add(n);
    setSelected(next);
  };
  const selectAll = () => setSelected(new Set(parsed.policies.map((p) => p.policyNumber)));
  const selectNone = () => setSelected(new Set());
  const selectNew = () =>
    setSelected(new Set(parsed.policies.filter((p) => !p.existingId).map((p) => p.policyNumber)));

  const columns: Column<LicPolicy>[] = [
    {
      key: 'policyNumber',
      header: '',
      render: (_v, p) => (
        <input
          type="checkbox"
          checked={selected.has(p.policyNumber)}
          onChange={() => toggle(p.policyNumber)}
          className="h-4 w-4 cursor-pointer accent-amber-600"
        />
      ),
    },
    {
      key: 'policyNumber',
      header: 'Policy #',
      render: (_v, p) => (
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-[var(--dxp-text)]">{p.policyNumber}</span>
          {p.existingId ? <Badge variant="info">update</Badge> : <Badge variant="success">new</Badge>}
        </div>
      ),
    },
    {
      key: 'policyHolder',
      header: 'Holder',
      render: (_v, p) => <span className="text-sm text-[var(--dxp-text)]">{p.policyHolder}</span>,
    },
    {
      key: 'startDate',
      header: 'Start',
      render: (_v, p) => (
        <span className="text-xs font-mono text-[var(--dxp-text-secondary)]">{p.startDate}</span>
      ),
    },
    {
      key: 'paymentMode',
      header: 'Mode',
      render: (_v, p) => (
        <span className="text-xs text-[var(--dxp-text-secondary)]">{MODE_LABEL[p.paymentMode]}</span>
      ),
    },
    {
      key: 'premiumPerInstallmentPaisa',
      header: 'Per inst.',
      render: (_v, p) => (
        <span className="font-mono text-xs text-[var(--dxp-text)]">
          {formatINR(p.premiumPerInstallmentPaisa)}
        </span>
      ),
    },
    {
      key: 'annualPremiumPaisa',
      header: 'Annual',
      render: (_v, p) => (
        <span className="font-mono text-sm font-semibold text-[var(--dxp-text)]">
          {formatINR(p.annualPremiumPaisa)}
        </span>
      ),
    },
    {
      key: 'nextDueDate',
      header: 'Next due',
      render: (_v, p) => (
        <span className="text-xs font-mono text-[var(--dxp-text-secondary)]">{p.nextDueDate}</span>
      ),
    },
  ];

  return (
    <>
      <StatsDisplay
        currency="INR"
        locale="en-IN"
        columns={4}
        stats={[
          { label: 'Statement year', value: Number(parsed.statementYear?.split('-')[0] ?? 0), format: 'number' },
          {
            label: 'Unique policies',
            value: parsed.policies.length,
            format: 'number',
            delta: { value: 0, label: `${newCount} new · ${updateCount} update` },
          },
          { label: 'Total premium (FY)', value: parsed.totalPremiumPaisa / 100, format: 'currency' },
          {
            label: 'Selected annual',
            value: selectedAnnual / 100,
            format: 'currency',
            delta: { value: 0, label: `${selected.size} of ${parsed.policies.length}` },
          },
        ]}
      />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
              <FileText className="h-5 w-5 text-amber-600" />
              2. Review & select
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" size="sm" onClick={selectAll}>
                Select all
              </Button>
              <Button variant="ghost" size="sm" onClick={selectNew}>
                New only
              </Button>
              <Button variant="ghost" size="sm" onClick={selectNone}>
                Clear
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable<LicPolicy> columns={columns} data={parsed.policies} emptyMessage="No policies" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            3. Confirm import
          </h3>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                Policy type for new entries
              </label>
              <Select
                value={defaultType}
                onChange={(v) => setDefaultType(v as PolicyType)}
                options={POLICY_TYPE_OPTIONS}
              />
              <p className="max-w-md text-xs text-[var(--dxp-text-secondary)]">
                Most LIC traditional plans are <strong>Endowment</strong>. Sum assured is set to ₹0 on
                import — fill it in afterwards.
              </p>
            </div>
            <Button variant="primary" onClick={onCommit} disabled={selected.size === 0 || isCommitting}>
              {isCommitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Importing…
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4" /> Import {selected.size} policies
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

/* ─── Chit preview component ──────────────────────────────────────────── */

function ChitPreview({
  parsed,
  onCommit,
  isCommitting,
}: {
  parsed: ChitParsed;
  onCommit: () => void;
  isCommitting: boolean;
}) {
  const fields: Array<[string, string]> = [
    ['Foreman', parsed.foremanName],
    ['Branch', parsed.branch ?? '—'],
    ['Subscriber', parsed.subscriberName ?? '—'],
    ['Scheme', parsed.schemeName],
    ['Ticket #', parsed.ticketNumber ?? '—'],
    ['Bye Law No', parsed.registrationNumber ?? '—'],
    ['Group value', formatINR(parsed.chitValuePaisa)],
    ['Monthly installment', formatINR(parsed.monthlyInstallmentPaisa)],
    ['Duration', `${parsed.durationMonths} months`],
    ['Start', parsed.startDate || '—'],
    ['End', parsed.expectedEndDate || '—'],
    ['Status', parsed.status],
  ];

  return (
    <>
      <StatsDisplay
        currency="INR"
        locale="en-IN"
        columns={4}
        stats={[
          {
            label: 'Installments paid',
            value: parsed.installmentsPaid,
            format: 'number',
            delta: { value: 0, label: `of ${parsed.durationMonths}` },
          },
          {
            label: 'Total paid',
            value: parsed.totalPaidPaisa / 100,
            format: 'currency',
          },
          {
            label: 'Dividends earned',
            value: parsed.totalDividendsPaisa / 100,
            format: 'currency',
          },
          {
            label: 'Group value',
            value: parsed.chitValuePaisa / 100,
            format: 'currency',
          },
        ]}
      />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
              <FileText className="h-5 w-5 text-amber-600" />
              2. Review parsed details
            </h3>
            {parsed.existingId ? (
              <Badge variant="info">will update existing</Badge>
            ) : (
              <Badge variant="success">new chit</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
            {fields.map(([label, value]) => (
              <div key={label} className="flex justify-between border-b border-[var(--dxp-border)] pb-2">
                <dt className="text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                  {label}
                </dt>
                <dd className="text-sm text-[var(--dxp-text)]">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs text-[var(--dxp-text-secondary)]">
            Per-installment history is not imported in v1 — the chit&apos;s running totals (paid,
            dividends, balance) are populated directly so all reports work. You can record
            individual installments later from the chit detail page.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            3. Confirm import
          </h3>
        </CardHeader>
        <CardContent>
          <div className="flex justify-end">
            <Button variant="primary" onClick={onCommit} disabled={isCommitting}>
              {isCommitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Importing…
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4" />{' '}
                  {parsed.existingId ? 'Update chit fund' : 'Create chit fund'}
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
