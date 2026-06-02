'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Button, Card, CardHeader, CardContent, Select, Input, Badge } from '@dxp/ui';
import {
  Plus,
  Loader2,
  EyeOff,
  Eye,
  Trash2,
  IndianRupee,
  Coins,
  FileCheck2,
  Pencil,
} from 'lucide-react';
import { toast } from 'sonner';
import { getCurrentFinancialYear } from '@/lib/finance/tax-constants';
import { RegimeComparisonCard } from '@/components/forms/regime-comparison-card';
import { AdvanceTaxCard } from '@/components/forms/advance-tax-card';
import { TaxKpiStrip } from '@/components/forms/tax-kpi-strip';
import { TaxProfileInline } from '@/components/forms/tax-profile-inline';
import { Section80RegimeAwareStats } from '@/components/forms/section80-regime-aware-stats';
import {
  TaxOnboardingChecklist,
  type OnboardingStatus,
} from '@/components/forms/tax-onboarding-checklist';

interface SectionBucket {
  section: string;
  label: string;
  description: string;
  capPaisa: number | null;
  totalPaisa: number;
  usedPercent: number;
  sources: Array<{ source: string; amountPaisa: number }>;
  manualEntries: number;
  docCoverage: number;
  isExcluded: boolean;
}

interface Summary {
  financialYear: string;
  totalDeductionsPaisa: number;
  estimatedTaxSavedPaisa: number;
  documentCoveragePercent: number;
  buckets: SectionBucket[];
}

interface TaxPayment {
  id: number;
  paymentType: string;
  amount: number;
  paymentDate: string;
  referenceNumber: string | null;
  notes: string | null;
}

interface DeductionRow {
  id: number;
  section: string;
  subType: string | null;
  description: string | null;
  amountPaisa: number | null;
  paymentDate: string | null;
  financialYear: string;
}

// Sections eligible under NEW regime (besides 80CCD(2) which is always
// eligible_under_new=true via DB default). Used for the per-bucket
// "OLD only" vs "BOTH" badge.
const NEW_ELIGIBLE_SECTIONS = new Set(['80CCD_2']);

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(
    paisa / 100
  );

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

export default function TaxDashboardPage() {
  const [fy, setFy] = useState<string>(previousFy());
  const [summary, setSummary] = useState<Summary | null>(null);
  const [taxPayments, setTaxPayments] = useState<TaxPayment[]>([]);
  const [totalTaxPaid, setTotalTaxPaid] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  // Sprint 5.2 (U5) — manual deduction rows for inline edit/delete
  const [deductionRows, setDeductionRows] = useState<DeductionRow[]>([]);
  // Sprint 5.2 — onboarding completion signals (drives U9 checklist)
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  // Bump this to force child components (KPI strip, regime card,
  // regime-aware stats) to re-fetch after a tax-profile chip toggle.
  const [refreshTick, setRefreshTick] = useState(0);

  // Ref to the advance-tax card for the Quick Actions "Mark advance tax
  // paid" CTA — clicking scrolls the user to it.
  const advanceTaxRef = useRef<HTMLDivElement | null>(null);

  // Tax paid form
  const [showTaxForm, setShowTaxForm] = useState(false);
  const [tpType, setTpType] = useState('ADVANCE_TAX');
  const [tpAmount, setTpAmount] = useState('');
  const [tpDate, setTpDate] = useState('');
  const [tpRef, setTpRef] = useState('');
  const [isSavingTp, setIsSavingTp] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [s, tp, itr1, f26, sel, fp, ded] = await Promise.all([
        fetch(`/api/tax/summary?fy=${encodeURIComponent(fy)}`).then((r) => r.json()),
        fetch(`/api/tax/tax-paid?fy=${encodeURIComponent(fy)}`).then((r) => r.json()),
        // Onboarding signals — non-blocking, only used to decide whether
        // to surface the U9 checklist. Each endpoint returns minimal
        // data we can check existence on.
        fetch(`/api/tax/itr1/summary?fy=${encodeURIComponent(fy)}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch(`/api/tax/form-26as?fy=${encodeURIComponent(fy)}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch(`/api/tax/itr-form-selection?fy=${encodeURIComponent(fy)}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch(`/api/tax/documents?fy=${encodeURIComponent(fy)}&category=FILING_PACK`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        // U5 — manual deductions for the inline edit/delete list
        fetch(`/api/tax/deductions?fy=${encodeURIComponent(fy)}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);
      setDeductionRows((ded?.deductions ?? []) as DeductionRow[]);
      setSummary(s);
      setTaxPayments(tp.payments ?? []);
      setTotalTaxPaid(tp.totalPaisa ?? 0);

      const hasSalary = (itr1?.blocks?.salary?.grossPaisa ?? 0) > 0;
      const hasDeductions =
        (s?.totalDeductionsPaisa ?? 0) > 0 ||
        ((s?.buckets ?? []) as SectionBucket[]).some(
          (b) => (b.totalPaisa ?? 0) > 0,
        );
      const has26AS = (f26?.uploads?.length ?? 0) > 0;
      const hasItrSelection = sel?.selection != null || sel?.form != null;
      const hasFilingPack = (fp?.documents?.length ?? 0) > 0;
      setOnboarding({ hasSalary, hasDeductions, has26AS, hasItrSelection, hasFilingPack });
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  }, [fy]);

  useEffect(() => {
    load();
  }, [load]);

  const deleteDeduction = async (id: number) => {
    if (!confirm('Delete this deduction? This cannot be undone.')) return;
    try {
      const r = await fetch(`/api/tax/deductions/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('Delete failed');
      toast.success('Deleted');
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const toggleSection = async (section: string, currentlyExcluded: boolean) => {
    try {
      const r = await fetch('/api/tax/summary', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fy, section, exclude: !currentlyExcluded }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || 'Failed');
      toast.success(d.message);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  const fyOptions = generateFyOptions().map((y) => ({ value: y, label: `FY ${y}` }));

  // Decide whether to render the full dashboard or the empty-state
  // checklist instead. Rule: render checklist if both salary AND
  // deductions are missing. If at least one exists, render BOTH (so
  // the user sees progress + the regime card).
  const showChecklistOnly =
    onboarding && !onboarding.hasSalary && !onboarding.hasDeductions;
  const showChecklistAlongside =
    onboarding &&
    !showChecklistOnly &&
    Object.values(onboarding).filter(Boolean).length < 5;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
            Income Tax
          </h1>
          <p className="text-[var(--dxp-text-secondary)]">
            Recommendation, deductions, and filing pack — for FY {fy}
          </p>
        </div>
        <div className="flex gap-2">
          <div className="w-40">
            <Select options={fyOptions} value={fy} onChange={(v) => setFy(v)} />
          </div>
        </div>
      </div>

      {isLoading || !summary ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--dxp-text-muted)]" />
        </div>
      ) : showChecklistOnly && onboarding ? (
        <TaxOnboardingChecklist fy={fy} status={onboarding} />
      ) : (
        <>
          {/* U7 — Tax profile chips (top, compact) */}
          <TaxProfileInline onChange={() => setRefreshTick((t) => t + 1)} />

          {/* A — Tax KPI strip */}
          <TaxKpiStrip key={`kpi-${fy}-${refreshTick}`} fy={fy} />

          {/* B — Regime comparison (banner promoted above columns) */}
          <RegimeComparisonCard key={`regime-${fy}-${refreshTick}`} fy={fy} />

          {/* Quarterly advance-tax planner */}
          <div ref={advanceTaxRef}>
            <AdvanceTaxCard fy={fy} />
          </div>

          {/* C — Quick Actions row (replaces 5-tile sub-nav grid) */}
          <Card>
            <CardContent>
              <div className="flex flex-wrap items-center gap-3">
                <span className="mr-1 text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                  Quick actions
                </span>
                <Link href="/tax/new">
                  <Button variant="primary" size="sm">
                    <Plus className="mr-1 h-3 w-3" /> Add deduction
                  </Button>
                </Link>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    advanceTaxRef.current?.scrollIntoView({
                      behavior: 'smooth',
                      block: 'start',
                    });
                  }}
                >
                  <Coins className="mr-1 h-3 w-3" /> Mark advance tax paid
                </Button>
                <Link href="/tax/itr-wizard">
                  <Button variant="secondary" size="sm">
                    <FileCheck2 className="mr-1 h-3 w-3" /> Run ITR wizard
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* D — Section 80 regime-aware stats (replaces 3-tile stats) */}
          <Section80RegimeAwareStats key={`s80-${fy}-${refreshTick}`} fy={fy} />

          {/* Per-bucket progress bars + regime-eligibility badges */}
          <div className="grid gap-4 md:grid-cols-2">
            {summary.buckets.map((bucket) => {
              const capStr = bucket.capPaisa != null ? formatINR(bucket.capPaisa) : 'No cap';
              const pct = Math.min(100, bucket.usedPercent);
              const color =
                pct >= 90 ? 'bg-rose-500' : pct >= 60 ? 'bg-amber-500' : 'bg-emerald-500';
              const eligibleBoth = NEW_ELIGIBLE_SECTIONS.has(bucket.section);
              return (
                <Card key={bucket.section} className={bucket.isExcluded ? 'opacity-40' : ''}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-base font-bold text-[var(--dxp-text)]">
                            {bucket.label}
                          </h3>
                          <Badge variant={eligibleBoth ? 'success' : 'default'}>
                            {eligibleBoth ? 'BOTH' : 'OLD only'}
                          </Badge>
                          {bucket.isExcluded && (
                            <span className="text-xs font-normal text-rose-500">Excluded</span>
                          )}
                        </div>
                        <p className="text-xs text-[var(--dxp-text-muted)]">{bucket.description}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-mono text-[var(--dxp-text-muted)]">Cap: {capStr}</p>
                        <button
                          onClick={() => toggleSection(bucket.section, bucket.isExcluded)}
                          className="p-1 rounded hover:bg-[var(--dxp-surface-alt,var(--dxp-surface))]"
                          title={bucket.isExcluded ? 'Include this section' : 'Exclude this section'}
                        >
                          {bucket.isExcluded
                            ? <Eye className="h-4 w-4 text-emerald-500" />
                            : <EyeOff className="h-4 w-4 text-[var(--dxp-text-muted)]" />}
                        </button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="mb-3 flex items-baseline justify-between">
                      <p className="text-2xl font-mono font-bold text-[var(--dxp-text)]">
                        {formatINR(bucket.totalPaisa)}
                      </p>
                      {bucket.capPaisa != null && (
                        <p className="text-xs text-[var(--dxp-text-muted)]">{pct.toFixed(0)}% used</p>
                      )}
                    </div>
                    {bucket.capPaisa != null && (
                      <div className="h-2 overflow-hidden rounded-full bg-[var(--dxp-border-light)]">
                        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
                      </div>
                    )}
                    {bucket.sources.length > 0 && (
                      <div className="mt-3 space-y-1">
                        {bucket.sources.map((src, idx) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between text-xs text-[var(--dxp-text-secondary)]"
                          >
                            <span>{src.source}</span>
                            <span className="font-mono">{formatINR(src.amountPaisa)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {bucket.sources.length === 0 && (
                      <p className="mt-3 text-xs text-[var(--dxp-text-muted)]">No entries yet</p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Optional inline onboarding checklist (when partial progress) */}
          {showChecklistAlongside && onboarding && (
            <TaxOnboardingChecklist fy={fy} status={onboarding} />
          )}

          {/* U5 — Manual deduction entries with edit/delete */}
          {deductionRows.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-bold text-[var(--dxp-text)]">
                    Manual deduction entries ({deductionRows.length})
                  </h3>
                  <Link href="/tax/new">
                    <Button variant="secondary" size="sm">
                      <Plus className="mr-1 h-3 w-3" /> Add
                    </Button>
                  </Link>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  {deductionRows.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center gap-3 rounded border border-[var(--dxp-border-light)] px-3 py-2 text-sm"
                    >
                      <Badge variant="info">{d.section}</Badge>
                      {d.subType && (
                        <span className="text-xs text-[var(--dxp-text-muted)]">{d.subType}</span>
                      )}
                      <span className="flex-1 truncate text-[var(--dxp-text-secondary)]">
                        {d.description}
                      </span>
                      <span className="text-xs text-[var(--dxp-text-muted)]">{d.paymentDate ?? '—'}</span>
                      <span className="font-mono font-bold text-[var(--dxp-text)]">
                        {formatINR(d.amountPaisa ?? 0)}
                      </span>
                      <Link href={`/tax/${d.id}/edit`}>
                        <Button variant="ghost" size="sm" title="Edit">
                          <Pencil className="h-3 w-3 text-[var(--dxp-text-muted)]" />
                        </Button>
                      </Link>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteDeduction(d.id)}
                        title="Delete"
                      >
                        <Trash2 className="h-3 w-3 text-rose-500" />
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Tax Paid Section */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
                  <IndianRupee className="h-5 w-5 text-[var(--dxp-brand)]" />
                  Tax Paid So Far
                </h3>
                <div className="flex items-center gap-3">
                  <span className="text-lg font-mono font-bold text-[var(--dxp-text)]">{formatINR(totalTaxPaid)}</span>
                  <Button variant="secondary" size="sm" onClick={() => setShowTaxForm(true)}>
                    <Plus className="mr-1 h-3 w-3" /> Add
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {showTaxForm && (
                <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-[var(--dxp-border)] p-3">
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Type</label>
                    <Select
                      options={[
                        { value: 'ADVANCE_TAX', label: 'Advance Tax' },
                        { value: 'TDS', label: 'TDS' },
                        { value: 'SELF_ASSESSMENT', label: 'Self Assessment' },
                        { value: 'OTHER', label: 'Other' },
                      ]}
                      value={tpType}
                      onChange={setTpType}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Amount (₹)</label>
                    <Input type="number" value={tpAmount} onChange={(e) => setTpAmount(e.target.value)} placeholder="e.g., 50000" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Date</label>
                    <Input type="date" value={tpDate} onChange={(e) => setTpDate(e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Reference</label>
                    <Input value={tpRef} onChange={(e) => setTpRef(e.target.value)} placeholder="Challan no." />
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={isSavingTp}
                    onClick={async () => {
                      if (!tpAmount || !tpDate) { toast.error('Amount and date required'); return; }
                      setIsSavingTp(true);
                      try {
                        const r = await fetch('/api/tax/tax-paid', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ financialYear: fy, paymentType: tpType, amount: Number(tpAmount), paymentDate: tpDate, referenceNumber: tpRef || null }),
                        });
                        if (!r.ok) throw new Error('Failed');
                        toast.success('Tax payment recorded');
                        setShowTaxForm(false); setTpAmount(''); setTpDate(''); setTpRef('');
                        load();
                      } catch { toast.error('Failed'); } finally { setIsSavingTp(false); }
                    }}
                  >
                    {isSavingTp && <Loader2 className="mr-1 h-3 w-3 animate-spin" />} Save
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setShowTaxForm(false)}>Cancel</Button>
                </div>
              )}
              {taxPayments.length > 0 ? (
                <div className="space-y-2">
                  {taxPayments.map((tp) => (
                    <div key={tp.id} className="flex items-center justify-between rounded border border-[var(--dxp-border-light)] px-3 py-2 text-sm">
                      <div className="flex items-center gap-2">
                        <Badge variant="info">{tp.paymentType.replace('_', ' ')}</Badge>
                        <span className="text-[var(--dxp-text-secondary)]">{tp.paymentDate}</span>
                        {tp.referenceNumber && <span className="text-xs text-[var(--dxp-text-muted)]">Ref: {tp.referenceNumber}</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-[var(--dxp-text)]">{formatINR(tp.amount)}</span>
                        <Button variant="ghost" size="sm" onClick={async () => {
                          await fetch(`/api/tax/tax-paid?id=${tp.id}`, { method: 'DELETE' });
                          toast.success('Deleted');
                          load();
                        }}><Trash2 className="h-3 w-3 text-rose-500" /></Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[var(--dxp-text-muted)]">No tax payments recorded for FY {fy}.</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
