'use client';

/**
 * Shared presumptive-income form — Sprint 4.1.
 *
 * Used by both /tax/itr4/presumptive/new and /tax/itr4/presumptive/[id].
 * The parent decides whether to POST (create) or PATCH (update) by
 * passing the `mode` + optional `initial` row.
 *
 * Live computes the deemed-profit minimum next to the declared-profit
 * input so the user can spot a 44AB(e) audit-trigger before submit.
 * Server still re-validates (defense in depth).
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Card,
  CardHeader,
  CardContent,
  CardFooter,
  Button,
  Input,
  Select,
} from '@dxp/ui';
import { ArrowLeft, Save } from 'lucide-react';
import { toast } from 'sonner';
import { deemedProfitPctFor } from '@/lib/finance/itr4-summary';

type Section = '44AD' | '44ADA' | '44AE';
type Mode = 'DIGITAL' | 'CASH' | 'MIXED';

export interface PresumptiveFormInitial {
  id: number;
  fy: string;
  section: Section;
  businessName: string;
  natureOfBusiness: string | null;
  grossReceiptsPaisa: number;
  receiptMode: Mode;
  declaredProfitPaisa: number;
  notes: string | null;
}

interface Props {
  mode: 'create' | 'edit';
  fy: string;
  initial?: PresumptiveFormInitial;
}

const SECTION_OPTIONS = [
  { value: '44AD', label: '44AD — Small business' },
  { value: '44ADA', label: '44ADA — Professionals' },
  { value: '44AE', label: '44AE — Goods carriage' },
];

const RECEIPT_MODE_OPTIONS = [
  { value: 'DIGITAL', label: 'Digital — 6% (44AD only)' },
  { value: 'CASH', label: 'Cash — 8% (44AD only)' },
  { value: 'MIXED', label: 'Mixed — treated as 8%' },
];

const SECTION_DESCRIPTION: Record<Section, string> = {
  '44AD': 'Resident individuals / HUFs / partnership firms (not LLP) with business turnover ≤ ₹2cr. Deemed profit: 6% digital / 8% cash.',
  '44ADA': 'Resident professionals (consultants, doctors, lawyers, architects, technical consultants) with gross receipts ≤ ₹75L. Deemed profit: 50%.',
  '44AE': 'Goods carriage operators owning ≤ 10 vehicles. Per-vehicle math (₹1,000/tonne/month heavy / ₹7,500/month light). Declared profit entered manually.',
};

export function PresumptiveForm({ mode, fy, initial }: Props) {
  const router = useRouter();
  const [section, setSection] = useState<Section>(initial?.section ?? '44AD');
  const [businessName, setBusinessName] = useState(initial?.businessName ?? '');
  const [nature, setNature] = useState(initial?.natureOfBusiness ?? '');
  const [grossReceipts, setGrossReceipts] = useState(
    initial ? String(Math.round(initial.grossReceiptsPaisa / 100)) : '',
  );
  const [receiptMode, setReceiptMode] = useState<Mode>(initial?.receiptMode ?? 'DIGITAL');
  const [declaredProfit, setDeclaredProfit] = useState(
    initial ? String(Math.round(initial.declaredProfitPaisa / 100)) : '',
  );
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [isSaving, setIsSaving] = useState(false);

  // Live-compute the minimum profit the user must declare. For 44AE
  // there's no auto-minimum, so we show "—".
  const grossNum = Number(grossReceipts) || 0;
  const pct = deemedProfitPctFor(section, receiptMode);
  const minimumRupees = pct != null ? Math.round((grossNum * pct) / 100) : null;
  const declaredNum = Number(declaredProfit) || 0;
  const declaredBelowMinimum =
    pct != null && minimumRupees != null && declaredNum < minimumRupees;

  // 44AD's 6%/8% pivots on receipt mode. 44ADA / 44AE don't care.
  useEffect(() => {
    if (section !== '44AD') {
      // Receipt mode irrelevant for 44ADA / 44AE — keep its value but
      // surface the fact visually (the Input below is dimmed).
    }
  }, [section]);

  const save = async () => {
    if (!businessName.trim()) {
      toast.error('Business name required');
      return;
    }
    if (!Number.isFinite(grossNum) || grossNum < 0) {
      toast.error('Gross receipts must be a non-negative number');
      return;
    }
    if (!Number.isFinite(declaredNum) || declaredNum < 0) {
      toast.error('Declared profit must be a non-negative number');
      return;
    }
    if (declaredBelowMinimum) {
      // Server will reject with 422 — we let it through to surface the
      // exact server message rather than duplicating the rule client-side.
      if (
        !confirm(
          `Declared profit ₹${declaredNum.toLocaleString(
            'en-IN',
          )} is below the ${section} minimum of ${pct}% (₹${minimumRupees?.toLocaleString(
            'en-IN',
          )}). Filing below the minimum triggers a mandatory tax audit under sec 44AB(e). The server will reject this. Continue anyway?`,
        )
      ) {
        return;
      }
    }

    setIsSaving(true);
    try {
      const body = {
        fy,
        section,
        businessName: businessName.trim(),
        natureOfBusiness: nature.trim() || null,
        grossReceiptsRupees: grossNum,
        receiptMode,
        declaredProfitRupees: declaredNum,
        notes: notes.trim() || null,
      };
      const url =
        mode === 'create'
          ? '/api/tax/itr4/presumptive'
          : `/api/tax/itr4/presumptive/${initial!.id}`;
      const method = mode === 'create' ? 'POST' : 'PATCH';
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || 'Save failed');
      toast.success(mode === 'create' ? 'Created' : 'Updated');
      router.push(`/tax/itr4?fy=${encodeURIComponent(fy)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-4">
      <Link
        href={`/tax/itr4?fy=${encodeURIComponent(fy)}`}
        className="inline-flex items-center gap-1 text-sm text-[var(--dxp-brand)] hover:underline"
      >
        <ArrowLeft className="h-3 w-3" /> Back to ITR-4
      </Link>

      <Card>
        <CardHeader>
          <h3 className="text-base font-bold text-[var(--dxp-text)]">
            {mode === 'create' ? 'Add' : 'Edit'} presumptive-income row — FY {fy}
          </h3>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-xs font-bold text-[var(--dxp-text-muted)]">
                Section
              </label>
              <Select
                options={SECTION_OPTIONS}
                value={section}
                onChange={(v) => setSection(v as Section)}
              />
              <p className="mt-1 text-xs text-[var(--dxp-text-muted)]">
                {SECTION_DESCRIPTION[section]}
              </p>
            </div>

            <div>
              <label className="text-xs font-bold text-[var(--dxp-text-muted)]">
                Receipt mode {section !== '44AD' && '(only used for 44AD)'}
              </label>
              <Select
                options={RECEIPT_MODE_OPTIONS}
                value={receiptMode}
                onChange={(v) => setReceiptMode(v as Mode)}
              />
            </div>

            <div className="md:col-span-2">
              <label className="text-xs font-bold text-[var(--dxp-text-muted)]">
                Business / profession name
              </label>
              <Input
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="e.g. Bharath Consulting"
              />
            </div>

            <div className="md:col-span-2">
              <label className="text-xs font-bold text-[var(--dxp-text-muted)]">
                Nature of business (optional)
              </label>
              <Input
                value={nature}
                onChange={(e) => setNature(e.target.value)}
                placeholder="e.g. Technical consulting / engineering services"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-[var(--dxp-text-muted)]">
                Gross receipts (₹)
              </label>
              <Input
                type="number"
                value={grossReceipts}
                onChange={(e) => setGrossReceipts(e.target.value)}
                placeholder="e.g. 1500000"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-[var(--dxp-text-muted)]">
                Declared profit (₹)
              </label>
              <Input
                type="number"
                value={declaredProfit}
                onChange={(e) => setDeclaredProfit(e.target.value)}
                placeholder="e.g. 750000"
              />
            </div>

            {/* Live minimum preview */}
            <div className="md:col-span-2">
              <div className="rounded border border-[var(--dxp-border-light)] bg-[var(--dxp-surface)] p-3 text-sm">
                {pct == null ? (
                  <p className="text-[var(--dxp-text-muted)]">
                    Section {section} accepts the declared profit as-is (no auto-minimum
                    enforced here).
                  </p>
                ) : (
                  <>
                    <p className="text-[var(--dxp-text)]">
                      <span className="font-bold">{section}</span> minimum profit ({pct}% of
                      gross receipts):{' '}
                      <span className="font-mono">
                        ₹{(minimumRupees ?? 0).toLocaleString('en-IN')}
                      </span>
                    </p>
                    {declaredBelowMinimum ? (
                      <p className="mt-1 text-xs text-red-500">
                        Declared ₹{declaredNum.toLocaleString('en-IN')} is below the minimum.
                        Filing below triggers tax audit under sec 44AB(e). Server will reject.
                      </p>
                    ) : declaredNum > 0 && declaredNum === minimumRupees ? (
                      <p className="mt-1 text-xs text-amber-500">
                        Declared exactly at the floor — compliant but on the edge.
                      </p>
                    ) : declaredNum > (minimumRupees ?? 0) ? (
                      <p className="mt-1 text-xs text-emerald-500">
                        Above minimum — compliant.
                      </p>
                    ) : null}
                  </>
                )}
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="text-xs font-bold text-[var(--dxp-text-muted)]">
                Notes (optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full rounded border border-[var(--dxp-border-light)] bg-[var(--dxp-surface)] p-2 text-sm text-[var(--dxp-text)]"
              />
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <div className="flex justify-end gap-2">
            <Link href={`/tax/itr4?fy=${encodeURIComponent(fy)}`}>
              <Button variant="secondary">Cancel</Button>
            </Link>
            <Button variant="primary" onClick={save} disabled={isSaving}>
              <Save className="mr-1 h-3 w-3" /> {isSaving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
