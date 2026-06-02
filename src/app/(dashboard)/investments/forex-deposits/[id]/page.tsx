'use client';

/**
 * Forex deposit — detail page with inline edit (Sprint 5.10d).
 *
 * Mirrors the inline-edit pattern used by NPS/EPF detail pages: Edit/
 * Save/Cancel pair toggling an `isEditing` flag, partial PATCH body
 * carrying only the fields the user touched.
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
  StatsDisplay,
  Input,
  Select,
} from '@dxp/ui';
import { ArrowLeft, Loader2, Banknote, Trash2, Pencil, Save, X } from 'lucide-react';

type Status = 'ACTIVE' | 'MATURED' | 'CLOSED';

interface ForexDeposit {
  id: number;
  bankName: string;
  accountNumber: string | null;
  currencyCode: string;
  amountInCurrency: number;
  interestRate: number | null;
  openingDate: string;
  maturityDate: string | null;
  status: Status;
  fxRate: number | null;
  inrValuePaisa: number | null;
  notes: string | null;
}

const STATUS_OPTIONS: Array<{ label: string; value: Status }> = [
  { label: 'Active', value: 'ACTIVE' },
  { label: 'Matured', value: 'MATURED' },
  { label: 'Closed', value: 'CLOSED' },
];

const statusVariant: Record<Status, 'success' | 'default' | 'warning'> = {
  ACTIVE: 'success',
  MATURED: 'warning',
  CLOSED: 'default',
};

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

interface FormState {
  bankName: string;
  accountNumber: string;
  currencyCode: string;
  amountInCurrency: string;
  interestRate: string;
  openingDate: string;
  maturityDate: string;
  status: Status;
  notes: string;
}

function depositToForm(d: ForexDeposit): FormState {
  return {
    bankName: d.bankName,
    accountNumber: d.accountNumber ?? '',
    currencyCode: d.currencyCode,
    amountInCurrency: d.amountInCurrency.toString(),
    interestRate: d.interestRate?.toString() ?? '',
    openingDate: d.openingDate,
    maturityDate: d.maturityDate ?? '',
    status: d.status,
    notes: d.notes ?? '',
  };
}

export default function ForexDepositDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [deposit, setDeposit] = useState<ForexDeposit | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/investments/forex-deposits/${params.id}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setDeposit(data.forexDeposit);
      setForm(depositToForm(data.forexDeposit));
      setAsOf(data.inrValueAsOf ?? null);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load forex deposit');
    } finally {
      setIsLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  const onDelete = async () => {
    if (!confirm('Delete this forex deposit?')) return;
    setIsDeleting(true);
    try {
      const r = await fetch(`/api/investments/forex-deposits/${params.id}`, {
        method: 'DELETE',
      });
      if (!r.ok) throw new Error('delete failed');
      toast.success('Removed');
      router.push('/investments/forex-deposits');
    } catch (e) {
      console.error(e);
      toast.error('Failed to delete');
      setIsDeleting(false);
    }
  };

  const onSave = async () => {
    if (!form) return;
    setIsSaving(true);
    try {
      const body: Record<string, unknown> = {
        bankName: form.bankName,
        accountNumber: form.accountNumber || null,
        currencyCode: form.currencyCode.toUpperCase(),
        amountInCurrency: form.amountInCurrency ? Number(form.amountInCurrency) : undefined,
        interestRate: form.interestRate ? Number(form.interestRate) : null,
        openingDate: form.openingDate,
        maturityDate: form.maturityDate || null,
        status: form.status,
        notes: form.notes || null,
      };
      const r = await fetch(`/api/investments/forex-deposits/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || 'Save failed');
      setDeposit(data.forexDeposit);
      setForm(depositToForm(data.forexDeposit));
      setIsEditing(false);
      toast.success('Forex deposit updated');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  const cancelEdit = () => {
    if (deposit) setForm(depositToForm(deposit));
    setIsEditing(false);
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
  if (!deposit || !form) return <p>Not found</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Link
            href="/investments/forex-deposits"
            className="inline-flex items-center text-sm text-[var(--dxp-text-secondary)] hover:text-[var(--dxp-brand)]"
          >
            <ArrowLeft className="mr-1 h-4 w-4" /> Back to forex deposits
          </Link>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
            {deposit.bankName}
          </h1>
          <p className="text-[var(--dxp-text-secondary)]">
            {deposit.currencyCode}{' '}
            {deposit.amountInCurrency.toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 4,
            })}
            {deposit.accountNumber ? ` · ${deposit.accountNumber}` : ''}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <Badge variant={statusVariant[deposit.status]}>{deposit.status}</Badge>
          {!isEditing ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => setIsEditing(true)}>
                <Pencil className="mr-2 h-4 w-4" /> Edit
              </Button>
              <Button variant="danger" size="sm" onClick={onDelete} disabled={isDeleting}>
                <Trash2 className="mr-2 h-4 w-4" /> Delete
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
        columns={3}
        stats={[
          {
            label: 'INR value',
            value: deposit.inrValuePaisa !== null ? deposit.inrValuePaisa / 100 : 0,
            format: 'currency',
            delta: deposit.fxRate
              ? { value: deposit.fxRate, label: `${deposit.currencyCode} → INR` }
              : undefined,
          },
          {
            label: 'Foreign amount',
            value: deposit.amountInCurrency,
            format: 'number',
          },
          {
            label: 'Interest rate',
            value: deposit.interestRate ?? 0,
            format: 'number',
            delta: { value: deposit.interestRate ?? 0, label: '% per year' },
          },
        ]}
      />
      {asOf && (
        <p className="text-xs text-[var(--dxp-text-muted)]">
          INR value at live rate as of {new Date(asOf).toLocaleString('en-IN')}
        </p>
      )}

      <Card>
        <CardHeader>
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <Banknote className="h-5 w-5 text-[var(--dxp-brand)]" />
            Deposit details
          </h3>
        </CardHeader>
        <CardContent>
          {!isEditing ? (
            <DetailView deposit={deposit} />
          ) : (
            <EditForm form={form} setField={setField} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DetailView({ deposit }: { deposit: ForexDeposit }) {
  const fields: Array<[string, string]> = [
    ['Bank', deposit.bankName],
    ['Account', deposit.accountNumber ?? '---'],
    ['Currency', deposit.currencyCode],
    [
      'Amount',
      `${deposit.amountInCurrency.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      })} ${deposit.currencyCode}`,
    ],
    [
      'INR equivalent (live)',
      deposit.inrValuePaisa !== null
        ? `${formatINR(deposit.inrValuePaisa)} at ₹${deposit.fxRate?.toFixed(4)}/${deposit.currencyCode}`
        : 'live rate unavailable',
    ],
    ['Interest rate', deposit.interestRate !== null ? `${deposit.interestRate}% per year` : '---'],
    ['Opening date', deposit.openingDate],
    ['Maturity', deposit.maturityDate ?? 'ongoing'],
    ['Status', deposit.status],
  ];

  return (
    <>
      <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
        {fields.map(([label, value]) => (
          <div
            key={label}
            className="flex justify-between border-b border-[var(--dxp-border)] pb-2"
          >
            <dt className="text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
              {label}
            </dt>
            <dd className="text-sm text-[var(--dxp-text)]">{value}</dd>
          </div>
        ))}
      </dl>
      {deposit.notes && (
        <p className="mt-4 text-sm text-[var(--dxp-text-secondary)]">{deposit.notes}</p>
      )}
    </>
  );
}

function EditForm({
  form,
  setField,
}: {
  form: FormState;
  setField: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="Bank">
        <Input value={form.bankName} onChange={(e) => setField('bankName', e.target.value)} />
      </Field>
      <Field label="Account">
        <Input
          value={form.accountNumber}
          onChange={(e) => setField('accountNumber', e.target.value)}
        />
      </Field>
      <Field label="Currency (3-letter ISO)">
        <Input
          value={form.currencyCode}
          onChange={(e) => setField('currencyCode', e.target.value.toUpperCase())}
          maxLength={3}
        />
      </Field>
      <Field label="Amount (foreign)">
        <Input
          type="number"
          step="0.0001"
          value={form.amountInCurrency}
          onChange={(e) => setField('amountInCurrency', e.target.value)}
        />
      </Field>
      <Field label="Interest rate (%)">
        <Input
          type="number"
          step="0.01"
          value={form.interestRate}
          onChange={(e) => setField('interestRate', e.target.value)}
        />
      </Field>
      <Field label="Status">
        <Select
          value={form.status}
          onChange={(v) => setField('status', v as Status)}
          options={STATUS_OPTIONS}
        />
      </Field>
      <Field label="Opening date">
        <Input
          type="date"
          value={form.openingDate}
          onChange={(e) => setField('openingDate', e.target.value)}
        />
      </Field>
      <Field label="Maturity date">
        <Input
          type="date"
          value={form.maturityDate}
          onChange={(e) => setField('maturityDate', e.target.value)}
        />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Notes">
          <textarea
            value={form.notes}
            onChange={(e) => setField('notes', e.target.value)}
            rows={3}
            className="w-full rounded border border-[var(--dxp-border)] bg-[var(--dxp-surface)] p-2 text-sm text-[var(--dxp-text)] focus:border-[var(--dxp-brand)] focus:outline-none"
          />
        </Field>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
        {label}
      </label>
      {children}
    </div>
  );
}
