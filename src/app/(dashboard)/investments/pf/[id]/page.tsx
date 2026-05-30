'use client';

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
} from '@dxp/ui';
import { ArrowLeft, Loader2, ShieldCheck, Trash2, Pencil, Save, X } from 'lucide-react';

type PFType = 'EPF' | 'PPF' | 'VPF';

interface PFAccount {
  id: number;
  accountType: PFType;
  accountNumber: string | null;
  accountHolder: string;
  universalAccountNumber: string | null;
  employeeBalance: number | null;
  employerBalance: number | null;
  interestBalance: number | null;
  totalBalance: number;
  totalContributed: number;
  interestEarned: number | null;
  ppfMaturityDate: string | null;
  openingDate: string;
  notes: string | null;
}

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

interface FormState {
  accountHolder: string;
  accountNumber: string;
  universalAccountNumber: string;
  employeeBalanceRupees: string;
  employerBalanceRupees: string;
  interestBalanceRupees: string;
  totalBalanceRupees: string;
  ppfMaturityDate: string;
  notes: string;
}

function accountToForm(a: PFAccount): FormState {
  return {
    accountHolder: a.accountHolder,
    accountNumber: a.accountNumber ?? '',
    universalAccountNumber: a.universalAccountNumber ?? '',
    employeeBalanceRupees: ((a.employeeBalance ?? 0) / 100).toString(),
    employerBalanceRupees: ((a.employerBalance ?? 0) / 100).toString(),
    interestBalanceRupees: ((a.interestBalance ?? 0) / 100).toString(),
    totalBalanceRupees: (a.totalBalance / 100).toString(),
    ppfMaturityDate: a.ppfMaturityDate ?? '',
    notes: a.notes ?? '',
  };
}

export default function PFDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [account, setAccount] = useState<PFAccount | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/investments/pf/${params.id}`).then((r) => r.json());
      if (r.error) throw new Error(r.error);
      setAccount(r.account);
      setForm(accountToForm(r.account));
    } catch (e) {
      console.error(e);
      toast.error('Failed to load PF account');
    } finally {
      setIsLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  const onDelete = async () => {
    if (!confirm('Delete this PF account?')) return;
    setIsDeleting(true);
    try {
      const r = await fetch(`/api/investments/pf/${params.id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('delete failed');
      toast.success('Removed');
      router.push('/investments/pf');
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
      const body = {
        accountHolder: form.accountHolder,
        accountNumber: form.accountNumber || null,
        universalAccountNumber: form.universalAccountNumber || null,
        employeeBalanceRupees: Number(form.employeeBalanceRupees) || 0,
        employerBalanceRupees: Number(form.employerBalanceRupees) || 0,
        interestBalanceRupees: Number(form.interestBalanceRupees) || 0,
        totalBalanceRupees: Number(form.totalBalanceRupees) || 0,
        ppfMaturityDate: form.ppfMaturityDate || null,
        notes: form.notes || null,
      };
      const r = await fetch(`/api/investments/pf/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || 'Save failed');
      setAccount(data.account);
      setForm(accountToForm(data.account));
      setIsEditing(false);
      toast.success('PF account updated');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  };

  const cancelEdit = () => {
    if (account) setForm(accountToForm(account));
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
  if (!account || !form) return <p>Not found</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Link
            href="/investments/pf"
            className="inline-flex items-center text-sm text-[var(--dxp-text-secondary)] hover:text-[var(--dxp-brand)]"
          >
            <ArrowLeft className="mr-1 h-4 w-4" /> Back to PF
          </Link>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
            {account.accountType} · {account.accountHolder}
          </h1>
          <p className="text-[var(--dxp-text-secondary)]">
            {account.universalAccountNumber || account.accountNumber || '---'}
          </p>
        </div>
        <div className="flex gap-2">
          <Badge variant="info">{account.accountType}</Badge>
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
        columns={4}
        stats={[
          { label: 'Total balance', value: account.totalBalance / 100, format: 'currency' },
          { label: 'Employee', value: (account.employeeBalance ?? 0) / 100, format: 'currency' },
          { label: 'Employer', value: (account.employerBalance ?? 0) / 100, format: 'currency' },
          { label: 'Interest accrued', value: (account.interestBalance ?? 0) / 100, format: 'currency' },
        ]}
      />

      <Card>
        <CardHeader>
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <ShieldCheck className="h-5 w-5 text-[var(--dxp-brand)]" />
            Account information
          </h3>
        </CardHeader>
        <CardContent>
          {!isEditing ? (
            <DetailView account={account} />
          ) : (
            <EditForm form={form} setField={setField} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* --- view mode ----------------------------------------------------------- */

function DetailView({ account }: { account: PFAccount }) {
  const fields: Array<[string, string]> = [
    ['Account holder', account.accountHolder],
    ['Account type', account.accountType],
    ['Account number', account.accountNumber ?? '---'],
    ['UAN', account.universalAccountNumber ?? '---'],
    ['Opened', account.openingDate],
    ['Interest earned', formatINR(account.interestEarned ?? 0)],
    ...(account.ppfMaturityDate
      ? [['PPF maturity', account.ppfMaturityDate] as [string, string]]
      : []),
  ];
  return (
    <>
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
      {account.notes && (
        <p className="mt-4 text-sm text-[var(--dxp-text-secondary)]">{account.notes}</p>
      )}
    </>
  );
}

/* --- edit mode ----------------------------------------------------------- */

function EditForm({
  form,
  setField,
}: {
  form: FormState;
  setField: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="Account holder">
        <Input
          value={form.accountHolder}
          onChange={(e) => setField('accountHolder', e.target.value)}
        />
      </Field>

      <Field label="Account number">
        <Input
          value={form.accountNumber}
          onChange={(e) => setField('accountNumber', e.target.value)}
        />
      </Field>

      <Field label="UAN">
        <Input
          value={form.universalAccountNumber}
          onChange={(e) => setField('universalAccountNumber', e.target.value)}
        />
      </Field>

      <Field label="Total balance (₹)">
        <Input
          type="number"
          value={form.totalBalanceRupees}
          onChange={(e) => setField('totalBalanceRupees', e.target.value)}
        />
      </Field>

      <Field label="Employee balance (₹)">
        <Input
          type="number"
          value={form.employeeBalanceRupees}
          onChange={(e) => setField('employeeBalanceRupees', e.target.value)}
        />
      </Field>

      <Field label="Employer balance (₹)">
        <Input
          type="number"
          value={form.employerBalanceRupees}
          onChange={(e) => setField('employerBalanceRupees', e.target.value)}
        />
      </Field>

      <Field label="Interest balance (₹)">
        <Input
          type="number"
          value={form.interestBalanceRupees}
          onChange={(e) => setField('interestBalanceRupees', e.target.value)}
        />
      </Field>

      <Field label="PPF maturity date">
        <Input
          type="date"
          value={form.ppfMaturityDate}
          onChange={(e) => setField('ppfMaturityDate', e.target.value)}
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
