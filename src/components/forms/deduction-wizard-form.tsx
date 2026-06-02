'use client';

/**
 * Section 80 entry wizard form — Sprint 5.2 commit 2.
 *
 * Single-page 4-step wizard:
 *   Step 1 — Pick section (with cap + description on each option)
 *   Step 2 — Pick sub-type (filtered by section)
 *   Step 3 — Amount + dates (live cap-usage bar, FY dropdown)
 *   Step 4 — Section-specific extras + optional receipt/cert upload
 *
 * Used by both /tax/new (create) and /tax/[id]/edit (edit, pre-filled).
 * Submits as multipart/form-data when files are attached, JSON
 * otherwise.
 */

import {
  useEffect,
  useState,
  useCallback,
  type ReactNode,
  type ChangeEvent,
} from 'react';
import { Card, CardHeader, CardContent, Input, Select, Button, Badge } from '@dxp/ui';
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  SECTION_LIST,
  SUB_TYPES_BY_SECTION,
  getSubTypes,
  getSection,
  type SubTypeOption,
} from '@/lib/finance/deduction-wizard-config';
import { getCurrentFinancialYear } from '@/lib/finance/tax-constants';

const PAYMENT_METHODS = ['CASH', 'CHEQUE', 'NEFT', 'UPI', 'CARD'];

function fyOptions(): Array<{ value: string; label: string }> {
  const current = getCurrentFinancialYear();
  const startYear = Number(current.split('-')[0]);
  const out: Array<{ value: string; label: string }> = [];
  for (let i = -2; i <= 2; i++) {
    const s = startYear + i;
    const e = String((s + 1) % 100).padStart(2, '0');
    out.push({ value: `${s}-${e}`, label: `FY ${s}-${e}` });
  }
  return out;
}

function fyDateBounds(fy: string): { min: string; max: string } | null {
  const m = fy.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const start = Number(m[1]);
  return { min: `${start}-04-01`, max: `${start + 1}-03-31` };
}

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

export interface DeductionWizardInitial {
  id?: number;
  section?: string;
  subType?: string | null;
  description?: string | null;
  amountRupees?: number;
  paymentDate?: string | null;
  paymentMethod?: string | null;
  recipientName?: string | null;
  recipientPan?: string | null;
  recipient80gNumber?: string | null;
  qualifyingPercent?: number | null;
  hasUpperLimit?: boolean | null;
  financialYear?: string;
  notes?: string | null;
  eightyDBucket?: 'SELF_FAMILY' | 'PARENTS' | null;
  eightyGCategory?: '50_NO_LIMIT' | '100_NO_LIMIT' | '50_WITH_LIMIT' | '100_WITH_LIMIT' | null;
  eligibleUnderNew?: boolean | null;
}

interface Props {
  /** Pre-filled values; used by the edit page. */
  initial?: DeductionWizardInitial;
  /** Pre-selected section from ?section= query param on the create page. */
  initialSection?: string;
  /** When set, the form submits PATCH to /api/tax/deductions/{id}. */
  editId?: number;
  /** Called after successful save. */
  onSaved?: (deductionId: number) => void;
  /** Cancel handler (Link to /tax usually). */
  onCancel?: () => void;
}

export function DeductionWizardForm({
  initial,
  initialSection,
  editId,
  onSaved,
  onCancel,
}: Props) {
  const [section, setSection] = useState<string>(
    initial?.section ?? initialSection ?? '80C',
  );
  const [subType, setSubType] = useState<string>(initial?.subType ?? '');
  const [description, setDescription] = useState<string>(initial?.description ?? '');
  const [amountRupees, setAmountRupees] = useState<string>(
    initial?.amountRupees != null ? String(initial.amountRupees) : '',
  );
  const [paymentDate, setPaymentDate] = useState<string>(
    initial?.paymentDate ?? new Date().toISOString().slice(0, 10),
  );
  const [paymentMethod, setPaymentMethod] = useState<string>(
    initial?.paymentMethod ?? 'NEFT',
  );
  const [financialYear, setFinancialYear] = useState<string>(
    initial?.financialYear ?? getCurrentFinancialYear(),
  );
  const [notes, setNotes] = useState<string>(initial?.notes ?? '');

  // Section-specific extras
  const [eightyDBucket, setEightyDBucket] = useState<'SELF_FAMILY' | 'PARENTS'>(
    initial?.eightyDBucket ?? 'SELF_FAMILY',
  );
  const [recipientName, setRecipientName] = useState<string>(initial?.recipientName ?? '');
  const [recipientPan, setRecipientPan] = useState<string>(initial?.recipientPan ?? '');
  const [recipient80gNumber, setRecipient80gNumber] = useState<string>(
    initial?.recipient80gNumber ?? '',
  );
  const [eligibleUnderNew, setEligibleUnderNew] = useState<boolean>(
    Boolean(initial?.eligibleUnderNew),
  );
  // 80EEA confirmations
  const [eeaCarpetOk, setEeaCarpetOk] = useState(false);
  const [eeaStampOk, setEeaStampOk] = useState(false);
  const [eeaLoanDateOk, setEeaLoanDateOk] = useState(false);

  // Files (create only — edit doesn't change attachments)
  const [receipt, setReceipt] = useState<File | null>(null);
  const [certificate, setCertificate] = useState<File | null>(null);

  // Cap usage
  const [usageRupees, setUsageRupees] = useState<number>(0);
  const [isSaving, setIsSaving] = useState(false);
  const [panError, setPanError] = useState<string | null>(null);

  const subTypes = getSubTypes(section);
  const sectionMeta = getSection(section);
  const subTypeMeta: SubTypeOption | undefined = subTypes.find((s) => s.value === subType);

  // Re-fetch usage when section or FY changes
  useEffect(() => {
    let cancelled = false;
    fetch(
      `/api/tax/deductions?fy=${encodeURIComponent(financialYear)}&section=${encodeURIComponent(section)}`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        const used = (d?.deductions ?? []).reduce(
          (s: number, r: { id: number; amountPaisa: number | null }) => {
            // When editing, exclude THIS row from usage so the bar is meaningful.
            if (editId && r.id === editId) return s;
            return s + (r.amountPaisa ?? 0);
          },
          0,
        );
        setUsageRupees(used / 100);
      });
    return () => {
      cancelled = true;
    };
  }, [section, financialYear, editId]);

  // Reset sub-type and 80G-derived fields when section changes
  const onSectionChange = useCallback(
    (next: string) => {
      setSection(next);
      // Don't blow away an existing valid sub-type when initializing.
      if (!SUB_TYPES_BY_SECTION[next]?.some((o) => o.value === subType)) {
        setSubType('');
      }
    },
    [subType],
  );

  // When sub-type changes, auto-fill description + 80G presets +
  // 80CCD(2) regime flag.
  const onSubTypeChange = useCallback(
    (next: string) => {
      setSubType(next);
      const meta = SUB_TYPES_BY_SECTION[section]?.find((o) => o.value === next);
      if (meta) {
        if (!description) setDescription(meta.label);
        if (meta.alwaysEligibleUnderNew) setEligibleUnderNew(true);
      }
    },
    [section, description],
  );

  // 80G PAN validation on blur
  const onPanBlur = useCallback(() => {
    const amt = Number(amountRupees);
    if (section === '80G' && amt > 2000 && !recipientPan.trim()) {
      setPanError('PAN required for donations above ₹2,000');
    } else {
      setPanError(null);
    }
  }, [section, amountRupees, recipientPan]);

  // Live cap math
  const amt = Number(amountRupees) || 0;
  const capRupees = sectionMeta?.capPaisa != null ? sectionMeta.capPaisa / 100 : null;
  const totalUsed = usageRupees + amt;
  const capUsedPct = capRupees != null ? Math.min(100, (totalUsed / capRupees) * 100) : 0;
  const overCap = capRupees != null && totalUsed > capRupees;
  const overageRupees = overCap && capRupees != null ? totalUsed - capRupees : 0;

  const handleSubmit = async (mode: 'save_and_done' | 'save_and_another') => {
    // Basic validation
    if (!subType) {
      toast.error('Pick a sub-type');
      return;
    }
    if (!amt || amt <= 0) {
      toast.error('Amount must be positive');
      return;
    }
    if (section === '80G' && amt > 2000 && !recipientPan.trim()) {
      setPanError('PAN required for donations above ₹2,000');
      return;
    }
    if (subTypeMeta?.value === 'FIRST_HOME_ADDITIONAL' && !editId) {
      if (!eeaCarpetOk || !eeaStampOk || !eeaLoanDateOk) {
        toast.error('Confirm all 80EEA eligibility checkboxes');
        return;
      }
    }
    const bounds = fyDateBounds(financialYear);
    if (bounds && paymentDate && (paymentDate < bounds.min || paymentDate > bounds.max)) {
      toast.error(`Payment date must fall within FY ${financialYear} (${bounds.min} → ${bounds.max})`);
      return;
    }

    setIsSaving(true);
    try {
      const payload: Record<string, unknown> = {
        section,
        subType,
        description: description || sectionMeta?.label || section,
        amountRupees: amt,
        paymentDate,
        paymentMethod,
        financialYear,
        notes,
        eligibleUnderNew,
      };
      if (section === '80D') payload.eightyDBucket = eightyDBucket;
      if (section === '80G' && subTypeMeta?.eightyGCategory) {
        payload.recipientName = recipientName || null;
        payload.recipientPan = recipientPan || null;
        payload.recipient80gNumber = recipient80gNumber || null;
        payload.qualifyingPercent = subTypeMeta.qualifyingPercent ?? null;
        payload.hasUpperLimit = subTypeMeta.hasUpperLimit ?? false;
        payload.eightyGCategory = subTypeMeta.eightyGCategory;
      }
      if (subTypeMeta?.alwaysEligibleUnderNew) payload.eligibleUnderNew = true;

      let res: Response;
      if (editId) {
        res = await fetch(`/api/tax/deductions/${editId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else if (receipt || certificate) {
        // Multipart create: deduction + file uploads atomically
        const fd = new FormData();
        fd.append('payload', JSON.stringify(payload));
        if (receipt) fd.append('receipt', receipt);
        if (certificate) fd.append('certificate', certificate);
        res = await fetch('/api/tax/deductions', { method: 'POST', body: fd });
      } else {
        res = await fetch('/api/tax/deductions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e?.error || 'Save failed');
      }
      const data = await res.json();
      toast.success(editId ? 'Updated' : 'Deduction saved');
      onSaved?.(data.deduction?.id ?? editId ?? 0);

      if (mode === 'save_and_another') {
        // Reset amount + dates but keep section/sub-type for rapid repeat entry
        setAmountRupees('');
        setNotes('');
        setReceipt(null);
        setCertificate(null);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Step 1 — Section */}
      <StepCard step={1} title="Pick the section" done={Boolean(section)}>
        <Select
          options={SECTION_LIST.map((s) => ({
            value: s.code,
            label: `${s.label} — ${s.description}${s.capPaisa ? ` · cap ${formatINR(s.capPaisa)}` : ''}`,
          }))}
          value={section}
          onChange={onSectionChange}
        />
        {sectionMeta && (
          <p className="mt-2 text-xs text-[var(--dxp-text-muted)]">{sectionMeta.description}</p>
        )}
      </StepCard>

      {/* Step 2 — Sub-type */}
      <StepCard
        step={2}
        title="Pick the sub-type"
        done={Boolean(subType)}
        disabled={!section}
      >
        {subTypes.length === 0 ? (
          <p className="text-xs text-[var(--dxp-text-muted)]">
            No sub-types defined for {section}. Use the description field to clarify.
          </p>
        ) : (
          <>
            <Select
              options={[
                { value: '', label: '— select —' },
                ...subTypes.map((s) => ({ value: s.value, label: s.label })),
              ]}
              value={subType}
              onChange={onSubTypeChange}
            />
            {subTypeMeta && (
              <p className="mt-2 text-xs text-[var(--dxp-text-muted)]">{subTypeMeta.description}</p>
            )}
            {subTypeMeta?.alwaysEligibleUnderNew && (
              <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-900 ring-1 ring-emerald-300">
                <CheckCircle2 className="h-3 w-3" /> Eligible under NEW regime too
              </div>
            )}
          </>
        )}
      </StepCard>

      {/* Step 3 — Amount + dates */}
      <StepCard step={3} title="Amount and dates" done={amt > 0} disabled={!subType}>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Amount (₹)">
            <Input
              type="number"
              value={amountRupees}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setAmountRupees(e.target.value)}
              placeholder="e.g. 50000"
            />
          </Field>
          <Field label="Financial year">
            <Select options={fyOptions()} value={financialYear} onChange={setFinancialYear} />
          </Field>
          <Field label="Payment date">
            <Input
              type="date"
              value={paymentDate}
              min={fyDateBounds(financialYear)?.min}
              max={fyDateBounds(financialYear)?.max}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setPaymentDate(e.target.value)}
            />
          </Field>
          <Field label="Payment method">
            <Select
              options={PAYMENT_METHODS.map((p) => ({ value: p, label: p }))}
              value={paymentMethod}
              onChange={setPaymentMethod}
            />
          </Field>
        </div>
        {/* Cap usage bar */}
        {capRupees != null && (
          <div className="mt-4">
            <div className="mb-1 flex items-baseline justify-between text-xs">
              <span className="text-[var(--dxp-text-secondary)]">
                Used in {sectionMeta?.label}:{' '}
                <span className="font-mono font-bold text-[var(--dxp-text)]">
                  ₹{Math.round(totalUsed).toLocaleString('en-IN')}
                </span>{' '}
                of ₹{Math.round(capRupees).toLocaleString('en-IN')} cap
              </span>
              <span className={overCap ? 'text-amber-700' : 'text-[var(--dxp-text-muted)]'}>
                {Math.round(capUsedPct)}% used
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--dxp-border-light)]">
              <div
                className={`h-full ${
                  overCap ? 'bg-amber-500' : capUsedPct >= 90 ? 'bg-rose-500' : capUsedPct >= 60 ? 'bg-amber-400' : 'bg-emerald-500'
                }`}
                style={{ width: `${capUsedPct}%` }}
              />
            </div>
            {overCap && (
              <p className="mt-1 text-xs text-amber-700">
                <AlertCircle className="mr-1 inline h-3 w-3" />
                ₹{Math.round(overageRupees).toLocaleString('en-IN')} above cap won&apos;t be deductible.
              </p>
            )}
          </div>
        )}
      </StepCard>

      {/* Step 4 — Section-specific extras */}
      <StepCard step={4} title="Extras and proof" disabled={!amt}>
        {section === '80D' && (
          <Field label="80D bucket">
            <Select
              options={[
                { value: 'SELF_FAMILY', label: 'Self + family (₹25k / ₹50k sr citizen)' },
                { value: 'PARENTS', label: 'Parents (₹25k / ₹50k if parents are sr citizen)' },
              ]}
              value={eightyDBucket}
              onChange={(v) => setEightyDBucket(v as 'SELF_FAMILY' | 'PARENTS')}
            />
          </Field>
        )}

        {section === '80G' && (
          <div className="space-y-3">
            <Field label="Recipient name">
              <Input
                value={recipientName}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setRecipientName(e.target.value)}
                placeholder="e.g. PM CARES, ABC Foundation"
              />
            </Field>
            <Field
              label={`Recipient PAN${amt > 2000 ? ' (required above ₹2,000)' : ''}`}
            >
              <Input
                value={recipientPan}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setRecipientPan(e.target.value.toUpperCase())
                }
                onBlur={onPanBlur}
                placeholder="ABCDE1234F"
              />
              {panError && (
                <p className="mt-1 text-xs text-rose-600">{panError}</p>
              )}
            </Field>
            <Field label="80G certificate number (optional)">
              <Input
                value={recipient80gNumber}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setRecipient80gNumber(e.target.value)
                }
              />
            </Field>
            {subTypeMeta?.eightyGCategory && (
              <div className="text-xs text-[var(--dxp-text-muted)]">
                <Badge variant="info">{subTypeMeta.qualifyingPercent}% qualifying</Badge>{' '}
                {subTypeMeta.hasUpperLimit ? '· capped at 10% adjusted GTI' : '· no upper limit'}
              </div>
            )}
          </div>
        )}

        {subTypeMeta?.value === 'FIRST_HOME_ADDITIONAL' && !editId && (
          <div className="rounded-md border border-amber-300 bg-amber-50/40 p-3 text-xs">
            <p className="mb-2 font-bold text-amber-900">Confirm 80EEA eligibility:</p>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={eeaCarpetOk}
                onChange={(e) => setEeaCarpetOk(e.target.checked)}
              />
              Carpet area ≤ 968 sqft (metro) / 1290 sqft (non-metro)
            </label>
            <label className="mt-1 flex items-center gap-2">
              <input
                type="checkbox"
                checked={eeaStampOk}
                onChange={(e) => setEeaStampOk(e.target.checked)}
              />
              Stamp duty value ≤ ₹45L
            </label>
            <label className="mt-1 flex items-center gap-2">
              <input
                type="checkbox"
                checked={eeaLoanDateOk}
                onChange={(e) => setEeaLoanDateOk(e.target.checked)}
              />
              Loan disbursed between 1 Apr 2019 and 31 Mar 2022
            </label>
          </div>
        )}

        {/* Regime eligibility checkbox — auto-checked + locked for 80CCD(2) */}
        {!subTypeMeta?.alwaysEligibleUnderNew && (
          <label className="mt-3 flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={eligibleUnderNew}
              onChange={(e) => setEligibleUnderNew(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="font-bold text-[var(--dxp-text)]">
                Eligible under NEW regime?
              </span>
              <span className="text-[var(--dxp-text-muted)]">
                {' '}
                — most Chapter VI-A deductions are NOT allowed under NEW. Only check if you&apos;re
                certain (e.g. employer NPS 80CCD(2)).
              </span>
            </span>
          </label>
        )}

        {!editId && (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <Field label="Receipt (PDF/JPG, optional)">
              <Input
                type="file"
                accept="application/pdf,image/*"
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setReceipt(e.target.files?.[0] ?? null)
                }
              />
            </Field>
            {section === '80G' && (
              <Field label="80G certificate (PDF/JPG, optional)">
                <Input
                  type="file"
                  accept="application/pdf,image/*"
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    setCertificate(e.target.files?.[0] ?? null)
                  }
                />
              </Field>
            )}
          </div>
        )}

        <Field label="Description">
          <Input
            value={description}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setDescription(e.target.value)}
            placeholder="Auto-filled from sub-type"
          />
        </Field>
        <Field label="Notes (optional)">
          <Input value={notes} onChange={(e: ChangeEvent<HTMLInputElement>) => setNotes(e.target.value)} />
        </Field>
      </StepCard>

      {/* Action row */}
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
        {!editId && (
          <Button
            variant="secondary"
            onClick={() => handleSubmit('save_and_another')}
            disabled={isSaving}
          >
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save &amp; add another
          </Button>
        )}
        <Button
          variant="primary"
          onClick={() => handleSubmit('save_and_done')}
          disabled={isSaving}
        >
          {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {editId ? 'Save changes' : 'Save & done'}
        </Button>
      </div>
    </div>
  );
}

function StepCard({
  step,
  title,
  children,
  disabled,
  done,
}: {
  step: number;
  title: string;
  children: ReactNode;
  disabled?: boolean;
  done?: boolean;
}) {
  return (
    <Card className={disabled ? 'opacity-50' : undefined}>
      <CardHeader>
        <div className="flex items-center gap-2">
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
              done
                ? 'bg-emerald-500 text-white'
                : disabled
                ? 'border border-[var(--dxp-border)] text-[var(--dxp-text-muted)]'
                : 'bg-[var(--dxp-brand)] text-white'
            }`}
          >
            {step}
          </span>
          <h3 className="text-base font-bold text-[var(--dxp-text)]">{title}</h3>
        </div>
      </CardHeader>
      <CardContent>
        <fieldset disabled={disabled} className="space-y-2">
          {children}
        </fieldset>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
        {label}
      </label>
      {children}
    </div>
  );
}
