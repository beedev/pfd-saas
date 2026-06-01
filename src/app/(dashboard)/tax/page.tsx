'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Button, Card, CardHeader, CardContent, StatsDisplay, Select, Input, Badge } from '@dxp/ui';
import { Plus, Loader2, Calculator, FileText, Gift, EyeOff, Eye, Trash2, IndianRupee, ClipboardCheck } from 'lucide-react';
import { toast } from 'sonner';
import { getCurrentFinancialYear } from '@/lib/finance/tax-constants';
import { RegimeComparisonCard } from '@/components/forms/regime-comparison-card';
import { AdvanceTaxCard } from '@/components/forms/advance-tax-card';

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
      const [s, tp] = await Promise.all([
        fetch(`/api/tax/summary?fy=${encodeURIComponent(fy)}`).then((r) => r.json()),
        fetch(`/api/tax/tax-paid?fy=${encodeURIComponent(fy)}`).then((r) => r.json()),
      ]);
      setSummary(s);
      setTaxPayments(tp.payments ?? []);
      setTotalTaxPaid(tp.totalPaisa ?? 0);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  }, [fy]);

  useEffect(() => {
    load();
  }, [load]);

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">Section 80 — Tax Deductions</h1>
          <p className="text-[var(--dxp-text-secondary)]">
            Track your deductions across every Section 80 bucket for the financial year
          </p>
        </div>
        <div className="flex gap-2">
          <div className="w-40">
            <Select options={fyOptions} value={fy} onChange={(v) => setFy(v)} />
          </div>
          <Link href="/tax/new">
            <Button variant="primary">
              <Plus className="mr-2 h-4 w-4" /> Add deduction
            </Button>
          </Link>
        </div>
      </div>

      {isLoading || !summary ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--dxp-text-muted)]" />
        </div>
      ) : (
        <>
          {/* Sprint 4 Phase 1 — regime comparison card. Reads the user's
              actual income (salary + business/GST + other + rental) and
              shows OLD vs NEW regime tax side-by-side with the
              recommendation. Goes above the deduction stats because the
              "which regime?" decision is upstream of the "how much did I
              deduct?" tracking that follows. */}
          <RegimeComparisonCard fy={fy} />

          {/* Sprint 4 Phase 3 — quarterly advance-tax planner. Sits
              directly under regime-compare so the user sees the
              projected liability and the 4 due-date slots together. */}
          <AdvanceTaxCard fy={fy} />

          <StatsDisplay
            currency="INR"
            locale="en-IN"
            columns={3}
            stats={[
              {
                label: 'Total Deductions',
                value: summary.totalDeductionsPaisa / 100,
                format: 'currency',
              },
              {
                label: 'Estimated Tax Saved (30%)',
                value: summary.estimatedTaxSavedPaisa / 100,
                format: 'currency',
              },
              {
                label: 'Document Coverage %',
                value: summary.documentCoveragePercent,
                format: 'number',
              },
            ]}
          />

          <div className="grid gap-4 md:grid-cols-4">
            <Link href="/tax/form-26as">
              <Card className="cursor-pointer hover:shadow-md transition-shadow">
                <CardContent>
                  <div className="flex items-center gap-3">
                    <ClipboardCheck className="h-8 w-8 text-[var(--dxp-brand)]" />
                    <div>
                      <p className="font-bold text-[var(--dxp-text)]">Form 26AS</p>
                      <p className="text-xs text-[var(--dxp-text-muted)]">TDS reconciliation</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
            <Link href="/tax/80g">
              <Card className="cursor-pointer hover:shadow-md transition-shadow">
                <CardContent>
                  <div className="flex items-center gap-3">
                    <Gift className="h-8 w-8 text-[var(--dxp-brand)]" />
                    <div>
                      <p className="font-bold text-[var(--dxp-text)]">80G Donations</p>
                      <p className="text-xs text-[var(--dxp-text-muted)]">Charitable contributions</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
            <Link href="/tax/ltcg-stcg">
              <Card className="cursor-pointer hover:shadow-md transition-shadow">
                <CardContent>
                  <div className="flex items-center gap-3">
                    <Calculator className="h-8 w-8 text-[var(--dxp-brand)]" />
                    <div>
                      <p className="font-bold text-[var(--dxp-text)]">Capital Gains</p>
                      <p className="text-xs text-[var(--dxp-text-muted)]">LTCG / STCG calculator</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
            <Link href="/tax/filing-pack">
              <Card className="cursor-pointer hover:shadow-md transition-shadow">
                <CardContent>
                  <div className="flex items-center gap-3">
                    <FileText className="h-8 w-8 text-[var(--dxp-brand)]" />
                    <div>
                      <p className="font-bold text-[var(--dxp-text)]">Filing Pack</p>
                      <p className="text-xs text-[var(--dxp-text-muted)]">Generate ZIP for filing</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {summary.buckets.map((bucket) => {
              const capStr = bucket.capPaisa != null ? formatINR(bucket.capPaisa) : 'No cap';
              const pct = Math.min(100, bucket.usedPercent);
              const color =
                pct >= 90 ? 'bg-rose-500' : pct >= 60 ? 'bg-amber-500' : 'bg-emerald-500';
              return (
                <Card key={bucket.section} className={bucket.isExcluded ? 'opacity-40' : ''}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-base font-bold text-[var(--dxp-text)]">
                          {bucket.label}
                          {bucket.isExcluded && <span className="ml-2 text-xs font-normal text-rose-500">Excluded</span>}
                        </h3>
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
