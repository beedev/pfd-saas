'use client';

/**
 * Fixed Deposit detail page — view + inline Edit/Save/Cancel pattern.
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
import {
  ArrowLeft,
  Loader2,
  Pencil,
  Save,
  X,
  Trash2,
  PiggyBank,
} from 'lucide-react';

import type { FDCompoundingFreq, FDInterestType, FDStatus } from '@/db/schema';

interface FixedDeposit {
  id: number;
  bankName: string;
  accountNumber: string | null;
  principalPaisa: number;
  interestRate: number;
  compoundingFreq: FDCompoundingFreq | null;
  interestType: FDInterestType | null;
  startDate: string;
  maturityDate: string;
  tenureMonths: number | null;
  maturityAmountPaisa: number | null;
  status: FDStatus | null;
  isTaxSaver: boolean;
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
  new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

const COMPOUNDING_OPTIONS: Array<{ value: FDCompoundingFreq; label: string }> = [
  { value: 'QUARTERLY', label: 'Quarterly' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'HALF_YEARLY', label: 'Half-yearly' },
  { value: 'YEARLY', label: 'Yearly' },
];

const INTEREST_TYPE_OPTIONS: Array<{ value: FDInterestType; label: string }> = [
  { value: 'CUMULATIVE', label: 'Cumulative' },
  { value: 'NON_CUMULATIVE', label: 'Non-cumulative' },
];

const STATUS_OPTIONS: Array<{ value: FDStatus; label: string }> = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'MATURED', label: 'Matured' },
  { value: 'BROKEN', label: 'Broken' },
];

interface FormState {
  bankName: string;
  accountNumber: string;
  principalRupees: string;
  interestRate: string;
  compoundingFreq: FDCompoundingFreq;
  interestType: FDInterestType;
  startDate: string;
  maturityDate: string;
  maturityRupees: string;
  status: FDStatus;
  isTaxSaver: boolean;
  autoRenew: boolean;
  jointHolderName: string;
  notes: string;
}

function fdToForm(f: FixedDeposit): FormState {
  return {
    bankName: f.bankName,
    accountNumber: f.accountNumber ?? '',
    principalRupees: (f.principalPaisa / 100).toString(),
    interestRate: f.interestRate.toString(),
    compoundingFreq: (f.compoundingFreq ?? 'QUARTERLY') as FDCompoundingFreq,
    interestType: (f.interestType ?? 'CUMULATIVE') as FDInterestType,
    startDate: f.startDate,
    maturityDate: f.maturityDate,
    maturityRupees: f.maturityAmountPaisa
      ? (f.maturityAmountPaisa / 100).toString()
      : '',
    status: (f.status ?? 'ACTIVE') as FDStatus,
    isTaxSaver: !!f.isTaxSaver,
    autoRenew: !!f.autoRenew,
    jointHolderName: f.jointHolderName ?? '',
    notes: f.notes ?? '',
  };
}

export default function FixedDepositDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [fd, setFd] = useState<FixedDeposit | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/investments/fixed-deposits/${params.id}`).then((r) =>
        r.json(),
      );
      if (r.error) throw new Error(r.error);
      setFd(r.fixedDeposit);
      setForm(fdToForm(r.fixedDeposit));
    } catch (e) {
      console.error(e);
      toast.error('Failed to load FD');
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
        principal: Number(form.principalRupees) || 0,
        interestRate: Number(form.interestRate) || 0,
        compoundingFreq: form.compoundingFreq,
        interestType: form.interestType,
        startDate: form.startDate,
        maturityDate: form.maturityDate,
        status: form.status,
        isTaxSaver: form.isTaxSaver,
        autoRenew: form.autoRenew,
        jointHolderName: form.jointHolderName || null,
        notes: form.notes || null,
      };
      if (form.maturityRupees && Number(form.maturityRupees) > 0) {
        body.maturityAmount = Number(form.maturityRupees);
      }
      const r = await fetch(`/api/investments/fixed-deposits/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || 'save failed');
      setFd(data.fixedDeposit);
      setForm(fdToForm(data.fixedDeposit));
      setIsEditing(false);
      toast.success('FD updated');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  const cancelEdit = () => {
    if (fd) setForm(fdToForm(fd));
    setIsEditing(false);
  };

  const onDelete = async () => {
    if (!confirm('Delete this fixed deposit?')) return;
    setIsDeleting(true);
    try {
      const r = await fetch(`/api/investments/fixed-deposits/${params.id}`, {
        method: 'DELETE',
      });
      if (!r.ok) throw new Error('delete failed');
      toast.success('Removed');
      router.push('/investments/fixed-deposits');
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
  if (!fd) return null;

  const principal = fd.principalPaisa;
  const maturity = fd.maturityAmountPaisa ?? fd.principalPaisa;
  const interestEarned = maturity - principal;

  return (
    <div className="space-y-6">
      <Link
        href="/investments/fixed-deposits"
        className="inline-flex items-center gap-1 text-sm text-[var(--dxp-text-muted)] hover:text-[var(--dxp-text)]"
      >
        <ArrowLeft className="h-4 w-4" /> Back to fixed deposits
      </Link>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <PiggyBank className="h-7 w-7 text-[var(--dxp-brand)]" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
              {fd.bankName}
            </h1>
            <p className="text-sm text-[var(--dxp-text-secondary)]">
              {fd.accountNumber ? `${fd.accountNumber} · ` : ''}
              {fd.interestRate.toFixed(2)}% · matures {fmtDate(fd.maturityDate)}
            </p>
          </div>
          <Badge
            variant={
              fd.status === 'ACTIVE'
                ? 'success'
                : fd.status === 'MATURED'
                  ? 'info'
                  : 'warning'
            }
          >
            {fd.status}
          </Badge>
          {fd.isTaxSaver && <Badge variant="info">80C tax-saver</Badge>}
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
          { label: 'Principal', value: principal / 100, format: 'currency' },
          { label: 'Maturity value', value: maturity / 100, format: 'currency' },
          { label: 'Interest earned', value: interestEarned / 100, format: 'currency' },
          { label: 'Tenure', value: fd.tenureMonths ?? 0, format: 'number' },
        ]}
      />

      <Card>
        <CardHeader>
          <h3 className="text-base font-bold text-[var(--dxp-text)]">Details</h3>
        </CardHeader>
        <CardContent>
          {!isEditing ? <ViewMode fd={fd} /> : form && <EditMode form={form} setField={setField} />}
        </CardContent>
      </Card>
    </div>
  );
}

function ViewMode({ fd }: { fd: FixedDeposit }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
      <Pair label="Bank" value={fd.bankName} />
      <Pair label="Account / receipt" value={fd.accountNumber ?? '—'} />
      <Pair label="Principal" value={formatINR(fd.principalPaisa)} />
      <Pair label="Interest rate" value={`${fd.interestRate.toFixed(2)}% p.a.`} />
      <Pair label="Compounding" value={fd.compoundingFreq ?? '—'} />
      <Pair label="Interest type" value={fd.interestType ?? '—'} />
      <Pair label="Start date" value={fmtDate(fd.startDate)} />
      <Pair label="Maturity date" value={fmtDate(fd.maturityDate)} />
      <Pair label="Tenure" value={fd.tenureMonths ? `${fd.tenureMonths} months` : '—'} />
      <Pair
        label="Maturity amount"
        value={fd.maturityAmountPaisa ? formatINR(fd.maturityAmountPaisa) : '—'}
      />
      <Pair label="Joint holder" value={fd.jointHolderName ?? '—'} />
      <Pair label="Premature penalty" value={`${fd.prematureWithdrawalPenaltyPct ?? 0}%`} />
      <Pair label="Tax-saver (80C)" value={fd.isTaxSaver ? 'Yes' : 'No'} />
      <Pair label="Auto-renew" value={fd.autoRenew ? 'Yes' : 'No'} />
      {fd.notes && <Pair label="Notes" value={fd.notes} full />}
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
      <EditField label="Principal (₹)">
        <Input
          type="number"
          step="0.01"
          min="0"
          value={form.principalRupees}
          onChange={(e) => setField('principalRupees', e.target.value)}
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
      <EditField label="Compounding">
        <Select
          value={form.compoundingFreq}
          onChange={(v) => setField('compoundingFreq', v as FDCompoundingFreq)}
          options={COMPOUNDING_OPTIONS}
        />
      </EditField>
      <EditField label="Interest type">
        <Select
          value={form.interestType}
          onChange={(v) => setField('interestType', v as FDInterestType)}
          options={INTEREST_TYPE_OPTIONS}
        />
      </EditField>
      <EditField label="Start date">
        <Input
          type="date"
          value={form.startDate}
          onChange={(e) => setField('startDate', e.target.value)}
        />
      </EditField>
      <EditField label="Maturity date">
        <Input
          type="date"
          value={form.maturityDate}
          onChange={(e) => setField('maturityDate', e.target.value)}
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
          onChange={(v) => setField('status', v as FDStatus)}
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
            checked={form.isTaxSaver}
            onChange={(e) => setField('isTaxSaver', e.target.checked)}
            className="h-4 w-4"
          />
          Tax-saver (80C)
        </label>
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
