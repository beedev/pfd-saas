'use client';

/**
 * Recurring Deposit detail page — view + inline Edit/Save/Cancel pattern.
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';

import {
  Button,
  Card,
  CardHeader,
  CardContent,
  Badge,
  Input,
  Select,
  StatsDisplay,
} from '@dxp/ui';
import { ArrowLeft, Loader2, Pencil, Save, X, Trash2, Repeat } from 'lucide-react';

import type { RDCompoundingFreq, RDStatus } from '@/db/schema';

interface RecurringDeposit {
  id: number;
  bankName: string;
  accountNumber: string | null;
  monthlyInstallmentPaisa: number;
  interestRate: number;
  compoundingFreq: RDCompoundingFreq | null;
  tenureMonths: number;
  startDate: string;
  maturityDate: string;
  totalDepositPaisa: number | null;
  maturityAmountPaisa: number | null;
  status: RDStatus | null;
  autoRenew: boolean;
  prematureWithdrawalPenaltyPct: number | null;
  jointHolderName: string | null;
  notes: string | null;
}

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

const COMPOUNDING_OPTIONS: Array<{ value: RDCompoundingFreq; label: string }> = [
  { value: 'QUARTERLY', label: 'Quarterly' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'HALF_YEARLY', label: 'Half-yearly' },
  { value: 'YEARLY', label: 'Yearly' },
];

const STATUS_OPTIONS: Array<{ value: RDStatus; label: string }> = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'MATURED', label: 'Matured' },
  { value: 'BROKEN', label: 'Broken' },
];

interface FormState {
  bankName: string;
  accountNumber: string;
  installmentRupees: string;
  interestRate: string;
  tenureMonths: string;
  compoundingFreq: RDCompoundingFreq;
  startDate: string;
  maturityRupees: string;
  status: RDStatus;
  autoRenew: boolean;
  jointHolderName: string;
  notes: string;
}

function rdToForm(r: RecurringDeposit): FormState {
  return {
    bankName: r.bankName,
    accountNumber: r.accountNumber ?? '',
    installmentRupees: (r.monthlyInstallmentPaisa / 100).toString(),
    interestRate: r.interestRate.toString(),
    tenureMonths: r.tenureMonths.toString(),
    compoundingFreq: (r.compoundingFreq ?? 'QUARTERLY') as RDCompoundingFreq,
    startDate: r.startDate,
    maturityRupees: r.maturityAmountPaisa ? (r.maturityAmountPaisa / 100).toString() : '',
    status: (r.status ?? 'ACTIVE') as RDStatus,
    autoRenew: !!r.autoRenew,
    jointHolderName: r.jointHolderName ?? '',
    notes: r.notes ?? '',
  };
}

export default function RecurringDepositDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [rd, setRd] = useState<RecurringDeposit | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/investments/recurring-deposits/${params.id}`).then((r) =>
        r.json(),
      );
      if (r.error) throw new Error(r.error);
      setRd(r.recurringDeposit);
      setForm(rdToForm(r.recurringDeposit));
    } catch (e) {
      console.error(e);
      toast.error('Failed to load RD');
    } finally {
      setIsLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  const onSave = async () => {
    if (!form) return;
    setIsSaving(true);
    try {
      const body: Record<string, unknown> = {
        bankName: form.bankName,
        accountNumber: form.accountNumber || null,
        monthlyInstallment: Number(form.installmentRupees) || 0,
        interestRate: Number(form.interestRate) || 0,
        tenureMonths: parseInt(form.tenureMonths, 10) || 0,
        compoundingFreq: form.compoundingFreq,
        startDate: form.startDate,
        status: form.status,
        autoRenew: form.autoRenew,
        jointHolderName: form.jointHolderName || null,
        notes: form.notes || null,
      };
      if (form.maturityRupees && Number(form.maturityRupees) > 0) {
        body.maturityAmount = Number(form.maturityRupees);
      }
      const r = await fetch(`/api/investments/recurring-deposits/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || 'save failed');
      setRd(data.recurringDeposit);
      setForm(rdToForm(data.recurringDeposit));
      setIsEditing(false);
      toast.success('RD updated');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  const cancelEdit = () => {
    if (rd) setForm(rdToForm(rd));
    setIsEditing(false);
  };

  const onDelete = async () => {
    if (!confirm('Delete this recurring deposit?')) return;
    setIsDeleting(true);
    try {
      const r = await fetch(`/api/investments/recurring-deposits/${params.id}`, {
        method: 'DELETE',
      });
      if (!r.ok) throw new Error('delete failed');
      toast.success('Removed');
      router.push('/investments/recurring-deposits');
    } catch (e) {
      console.error(e);
      toast.error('Failed to delete');
      setIsDeleting(false);
    }
  };

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--dxp-text-muted)]" />
      </div>
    );
  }
  if (!rd) return null;

  const deposited = rd.totalDepositPaisa ?? rd.monthlyInstallmentPaisa * rd.tenureMonths;
  const maturity = rd.maturityAmountPaisa ?? deposited;
  const interestEarned = maturity - deposited;

  return (
    <div className="space-y-6">
      <Link
        href="/investments/recurring-deposits"
        className="inline-flex items-center gap-1 text-sm text-[var(--dxp-text-muted)] hover:text-[var(--dxp-text)]"
      >
        <ArrowLeft className="h-4 w-4" /> Back to recurring deposits
      </Link>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Repeat className="h-7 w-7 text-[var(--dxp-brand)]" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
              {rd.bankName}
            </h1>
            <p className="text-sm text-[var(--dxp-text-secondary)]">
              {rd.accountNumber ? `${rd.accountNumber} · ` : ''}
              {formatINR(rd.monthlyInstallmentPaisa)}/mo · {rd.interestRate.toFixed(2)}% · matures{' '}
              {fmtDate(rd.maturityDate)}
            </p>
          </div>
          <Badge
            variant={
              rd.status === 'ACTIVE' ? 'success' : rd.status === 'MATURED' ? 'info' : 'warning'
            }
          >
            {rd.status}
          </Badge>
        </div>
        <div className="flex gap-2">
          {!isEditing ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => setIsEditing(true)}>
                <Pencil className="mr-2 h-4 w-4" /> Edit
              </Button>
              <Button variant="danger" size="sm" onClick={onDelete} disabled={isDeleting}>
                {isDeleting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-2 h-4 w-4" />
                )}
                Delete
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" size="sm" onClick={cancelEdit} disabled={isSaving}>
                <X className="mr-2 h-4 w-4" /> Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={onSave} disabled={isSaving}>
                {isSaving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Save
              </Button>
            </>
          )}
        </div>
      </div>

      <StatsDisplay
        currency="INR"
        locale="en-IN"
        columns={4}
        stats={[
          { label: 'Total deposited', value: deposited / 100, format: 'currency' },
          { label: 'Maturity value', value: maturity / 100, format: 'currency' },
          { label: 'Interest earned', value: interestEarned / 100, format: 'currency' },
          { label: 'Tenure', value: rd.tenureMonths ?? 0, format: 'number' },
        ]}
      />

      <Card>
        <CardHeader>
          <h3 className="text-base font-bold text-[var(--dxp-text)]">Details</h3>
        </CardHeader>
        <CardContent>
          {!isEditing ? <ViewMode rd={rd} /> : form && <EditMode form={form} setField={setField} />}
        </CardContent>
      </Card>
    </div>
  );
}

function ViewMode({ rd }: { rd: RecurringDeposit }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
      <Pair label="Bank" value={rd.bankName} />
      <Pair label="Account / receipt" value={rd.accountNumber ?? '—'} />
      <Pair label="Monthly installment" value={formatINR(rd.monthlyInstallmentPaisa)} />
      <Pair label="Interest rate" value={`${rd.interestRate.toFixed(2)}% p.a.`} />
      <Pair label="Compounding" value={rd.compoundingFreq ?? '—'} />
      <Pair label="Tenure" value={`${rd.tenureMonths} months`} />
      <Pair label="Start date" value={fmtDate(rd.startDate)} />
      <Pair label="Maturity date" value={fmtDate(rd.maturityDate)} />
      <Pair
        label="Total deposited"
        value={formatINR(rd.totalDepositPaisa ?? rd.monthlyInstallmentPaisa * rd.tenureMonths)}
      />
      <Pair
        label="Maturity amount"
        value={rd.maturityAmountPaisa ? formatINR(rd.maturityAmountPaisa) : '—'}
      />
      <Pair label="Joint holder" value={rd.jointHolderName ?? '—'} />
      <Pair label="Premature penalty" value={`${rd.prematureWithdrawalPenaltyPct ?? 0}%`} />
      <Pair label="Auto-renew" value={rd.autoRenew ? 'Yes' : 'No'} />
      {rd.notes && <Pair label="Notes" value={rd.notes} full />}
    </dl>
  );
}

function Pair({ label, value, full }: { label: string; value: string; full?: boolean }) {
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      <dt className="text-[10px] font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
        {label}
      </dt>
      <dd className="font-mono text-[var(--dxp-text)]">{value}</dd>
    </div>
  );
}

function EditMode({
  form,
  setField,
}: {
  form: FormState;
  setField: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <EditField label="Bank">
        <Input value={form.bankName} onChange={(e) => setField('bankName', e.target.value)} />
      </EditField>
      <EditField label="Account no.">
        <Input
          value={form.accountNumber}
          onChange={(e) => setField('accountNumber', e.target.value)}
        />
      </EditField>
      <EditField label="Monthly installment (₹)">
        <Input
          type="number"
          step="0.01"
          min="0"
          value={form.installmentRupees}
          onChange={(e) => setField('installmentRupees', e.target.value)}
        />
      </EditField>
      <EditField label="Interest rate (%)">
        <Input
          type="number"
          step="0.01"
          min="0"
          value={form.interestRate}
          onChange={(e) => setField('interestRate', e.target.value)}
        />
      </EditField>
      <EditField label="Tenure (months)">
        <Input
          type="number"
          step="1"
          min="1"
          value={form.tenureMonths}
          onChange={(e) => setField('tenureMonths', e.target.value)}
        />
      </EditField>
      <EditField label="Compounding">
        <Select
          value={form.compoundingFreq}
          onChange={(v) => setField('compoundingFreq', v as RDCompoundingFreq)}
          options={COMPOUNDING_OPTIONS}
        />
      </EditField>
      <EditField label="Start date">
        <Input
          type="date"
          value={form.startDate}
          onChange={(e) => setField('startDate', e.target.value)}
        />
      </EditField>
      <EditField label="Maturity amount (₹) — leave blank to auto-compute">
        <Input
          type="number"
          step="0.01"
          min="0"
          value={form.maturityRupees}
          onChange={(e) => setField('maturityRupees', e.target.value)}
          placeholder="auto-computed"
        />
      </EditField>
      <EditField label="Status">
        <Select
          value={form.status}
          onChange={(v) => setField('status', v as RDStatus)}
          options={STATUS_OPTIONS}
        />
      </EditField>
      <EditField label="Joint holder">
        <Input
          value={form.jointHolderName}
          onChange={(e) => setField('jointHolderName', e.target.value)}
        />
      </EditField>
      <div className="flex items-center gap-4 sm:col-span-2">
        <label className="flex items-center gap-2 text-sm text-[var(--dxp-text)]">
          <input
            type="checkbox"
            checked={form.autoRenew}
            onChange={(e) => setField('autoRenew', e.target.checked)}
            className="h-4 w-4"
          />
          Auto-renew
        </label>
      </div>
      <EditField label="Notes" full>
        <Input value={form.notes} onChange={(e) => setField('notes', e.target.value)} />
      </EditField>
    </div>
  );
}

function EditField({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
        {label}
      </label>
      {children}
    </div>
  );
}
