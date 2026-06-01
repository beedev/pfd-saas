'use client';

/**
 * ITR-form selector wizard — Sprint 4 Phase 4.
 *
 * Single-page questionnaire (not a multi-step stepper — KISS). Reads
 * /api/tax/itr-form-selection/detect on mount to prefill answers from
 * the user's existing data. User overrides anything wrong, hits
 * "Compute", server returns the recommended form + reasoning, user
 * clicks "Save selection" to persist.
 *
 * If a selection already exists for the FY, it's shown at the top as
 * "Current selection: ITR-X". Re-running the wizard UPSERTs.
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardContent, Badge, Button, Input, Select } from '@dxp/ui';
import { Loader2, FileCheck2, Sparkles, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { getCurrentFinancialYear } from '@/lib/finance/tax-constants';

interface Detected {
  hasSalary: boolean;
  salaryCount: number;
  salaryPaisa: number;
  numHouseProperties: number;
  hasCapitalGains: boolean;
  capitalGainsPaisa: number;
  hasBusinessIncome: boolean;
  businessPaisa: number;
  hasPresumptive: boolean;
  hasForeignIncome: boolean;
  hasOtherSources: boolean;
  otherPaisa: number;
  totalIncomePaisa: number;
}

interface Selection {
  id: number;
  selectedForm: string;
  reasoning: string | null;
  wizardAnswers: unknown;
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

export default function ItrWizardPage() {
  const [fy, setFy] = useState<string>(previousFy());
  const [detected, setDetected] = useState<Detected | null>(null);
  const [existing, setExisting] = useState<Selection | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Editable wizard answers — initialised from detected.
  const [hasSalary, setHasSalary] = useState(false);
  const [numHouseProperties, setNumHouseProperties] = useState(0);
  const [hasCapitalGains, setHasCapitalGains] = useState(false);
  const [hasBusinessIncome, setHasBusinessIncome] = useState(false);
  const [hasPresumptive, setHasPresumptive] = useState(false);
  const [hasForeignIncome, setHasForeignIncome] = useState(false);
  const [hasOtherSources, setHasOtherSources] = useState(false);
  const [totalIncomeRupees, setTotalIncomeRupees] = useState('');

  const [result, setResult] = useState<{ form: string; reasoning: string } | null>(null);
  const [isComputing, setIsComputing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setResult(null);
    try {
      const [d, s] = await Promise.all([
        fetch(`/api/tax/itr-form-selection/detect?fy=${encodeURIComponent(fy)}`).then((r) =>
          r.json(),
        ),
        fetch(`/api/tax/itr-form-selection?fy=${encodeURIComponent(fy)}`).then((r) => r.json()),
      ]);
      const det: Detected = d.detected;
      setDetected(det);
      setExisting(s.selection ?? null);
      setHasSalary(det.hasSalary);
      setNumHouseProperties(det.numHouseProperties);
      setHasCapitalGains(det.hasCapitalGains);
      setHasBusinessIncome(det.hasBusinessIncome);
      setHasPresumptive(det.hasPresumptive);
      setHasForeignIncome(det.hasForeignIncome);
      setHasOtherSources(det.hasOtherSources);
      setTotalIncomeRupees(String(Math.round(det.totalIncomePaisa / 100)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to detect');
    } finally {
      setIsLoading(false);
    }
  }, [fy]);

  useEffect(() => {
    load();
  }, [load]);

  const compute = async () => {
    setIsComputing(true);
    try {
      const body = {
        fy,
        hasSalary,
        numHouseProperties,
        hasCapitalGains,
        hasBusinessIncome,
        hasPresumptive,
        hasForeignIncome,
        hasOtherSources,
        totalIncomePaisa: Math.round(Number(totalIncomeRupees) * 100) || 0,
      };
      // Posting persists immediately AND returns the recommendation —
      // we choose this over a separate /compute endpoint because the
      // UPSERT cost is negligible and avoids a 2nd round-trip.
      const r = await fetch('/api/tax/itr-form-selection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || 'Failed');
      setResult({ form: d.form, reasoning: d.reasoning });
      setExisting(d.selection);
      toast.success(`Recommended: ${d.form}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setIsComputing(false);
    }
  };

  const fyOptions = generateFyOptions().map((y) => ({ value: y, label: `FY ${y}` }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
            ITR Form Wizard
          </h1>
          <p className="text-[var(--dxp-text-secondary)]">
            Answer a few questions and we&apos;ll tell you which ITR form to file under
          </p>
        </div>
        <div className="w-40">
          <Select options={fyOptions} value={fy} onChange={(v) => setFy(v)} />
        </div>
      </div>

      {existing && (
        <Card>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FileCheck2 className="h-6 w-6 text-emerald-500" />
                <div>
                  <p className="text-sm font-bold text-[var(--dxp-text)]">
                    Saved selection for FY {fy}:{' '}
                    <Badge variant="success">{existing.selectedForm}</Badge>
                  </p>
                  {existing.reasoning && (
                    <p className="text-xs text-[var(--dxp-text-muted)]">{existing.reasoning}</p>
                  )}
                </div>
              </div>
              <Link
                href={`/tax/${existing.selectedForm.toLowerCase().replace('-', '')}?fy=${encodeURIComponent(fy)}`}
              >
                <Button variant="primary" size="sm">
                  Open {existing.selectedForm} walkthrough <ArrowRight className="ml-1 h-3 w-3" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading || !detected ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--dxp-text-muted)]" />
        </div>
      ) : (
        <Card>
          <CardHeader>
            <h3 className="text-base font-bold text-[var(--dxp-text)]">
              Income situation for FY {fy}
            </h3>
            <p className="text-xs text-[var(--dxp-text-muted)]">
              Prefilled from your existing data — adjust as needed.
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <YesNoRow
                question="Do you have salary income?"
                detail={
                  detected.hasSalary
                    ? `Detected ${detected.salaryCount} employer(s), ₹${(detected.salaryPaisa / 100).toLocaleString('en-IN')}`
                    : 'No salary income detected'
                }
                value={hasSalary}
                onChange={setHasSalary}
              />
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-bold text-[var(--dxp-text)]">
                    How many house properties do you own?
                  </p>
                  <p className="text-xs text-[var(--dxp-text-muted)]">
                    Detected {detected.numHouseProperties} from /investments/real-estate
                  </p>
                </div>
                <div className="w-24">
                  <Input
                    type="number"
                    value={String(numHouseProperties)}
                    onChange={(e) => setNumHouseProperties(Number(e.target.value) || 0)}
                  />
                </div>
              </div>
              <YesNoRow
                question="Capital gains realised this year?"
                detail={
                  detected.hasCapitalGains
                    ? `Detected ₹${(detected.capitalGainsPaisa / 100).toLocaleString('en-IN')} in /tax/ltcg-stcg`
                    : 'No capital gains logged'
                }
                value={hasCapitalGains}
                onChange={setHasCapitalGains}
              />
              <YesNoRow
                question="Business or professional income? (GST consulting, freelance)"
                detail={
                  detected.hasBusinessIncome
                    ? `Detected ₹${(detected.businessPaisa / 100).toLocaleString('en-IN')} from GST invoices`
                    : 'No GST invoices in this FY'
                }
                value={hasBusinessIncome}
                onChange={setHasBusinessIncome}
              />
              <YesNoRow
                question="Filing under presumptive scheme (44AD / 44ADA / 44AE)?"
                detail="Not auto-detected — tick if you opt for presumptive income"
                value={hasPresumptive}
                onChange={setHasPresumptive}
              />
              <YesNoRow
                question="Foreign income or foreign assets?"
                detail="Not auto-detected — tick if you have any foreign source income"
                value={hasForeignIncome}
                onChange={setHasForeignIncome}
              />
              <YesNoRow
                question="Income from other sources (interest, dividends)?"
                detail={
                  detected.hasOtherSources
                    ? `Detected ₹${(detected.otherPaisa / 100).toLocaleString('en-IN')}`
                    : 'No entries in other_sources_income'
                }
                value={hasOtherSources}
                onChange={setHasOtherSources}
              />
              <div className="flex items-center justify-between gap-4 border-t border-[var(--dxp-border-light)] pt-3">
                <div>
                  <p className="text-sm font-bold text-[var(--dxp-text)]">
                    Estimated total income for FY (₹)
                  </p>
                  <p className="text-xs text-[var(--dxp-text-muted)]">
                    Detected {formatINR(detected.totalIncomePaisa)} — adjust if needed
                  </p>
                </div>
                <div className="w-40">
                  <Input
                    type="number"
                    value={totalIncomeRupees}
                    onChange={(e) => setTotalIncomeRupees(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <Button variant="primary" onClick={compute} disabled={isComputing}>
                {isComputing && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                <Sparkles className="mr-2 h-4 w-4" /> Compute recommendation
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {result && (
        <Card>
          <CardHeader>
            <h3 className="text-base font-bold text-[var(--dxp-text)]">Recommended ITR form</h3>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <Badge variant="brand">{result.form}</Badge>
              <p className="text-sm text-[var(--dxp-text-secondary)]">{result.reasoning}</p>
            </div>
            <p className="mt-3 text-xs text-[var(--dxp-text-muted)]">
              Saved automatically. You can rerun the wizard any time — the answer for FY {fy} will
              be overwritten.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {/* Sprint 4.1 — CTA to the form-specific walkthrough. The
                  wizard already saved the selection; this opens the
                  filer's home page for the chosen form. ITR-3 routes to
                  the existing multi-page hub; ITR-1/2/4 go to the new
                  Sprint 4.1 summary pages. */}
              <Link
                href={`/tax/${result.form.toLowerCase().replace('-', '')}?fy=${encodeURIComponent(fy)}`}
              >
                <Button variant="primary" size="sm">
                  Continue to {result.form} walkthrough <ArrowRight className="ml-1 h-3 w-3" />
                </Button>
              </Link>
              <Link href={`/api/tax/itr-export/${result.form}?fy=${encodeURIComponent(fy)}`}>
                <Button variant="secondary" size="sm">
                  View export JSON
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function YesNoRow({
  question,
  detail,
  value,
  onChange,
}: {
  question: string;
  detail: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-bold text-[var(--dxp-text)]">{question}</p>
        <p className="text-xs text-[var(--dxp-text-muted)]">{detail}</p>
      </div>
      <div className="flex gap-1 rounded border border-[var(--dxp-border-light)] p-1">
        <button
          type="button"
          onClick={() => onChange(true)}
          className={`rounded px-3 py-1 text-xs font-bold ${
            value
              ? 'bg-[var(--dxp-brand)] text-white'
              : 'text-[var(--dxp-text-secondary)] hover:bg-[var(--dxp-surface-alt,var(--dxp-surface))]'
          }`}
        >
          Yes
        </button>
        <button
          type="button"
          onClick={() => onChange(false)}
          className={`rounded px-3 py-1 text-xs font-bold ${
            !value
              ? 'bg-[var(--dxp-brand)] text-white'
              : 'text-[var(--dxp-text-secondary)] hover:bg-[var(--dxp-surface-alt,var(--dxp-surface))]'
          }`}
        >
          No
        </button>
      </div>
    </div>
  );
}
