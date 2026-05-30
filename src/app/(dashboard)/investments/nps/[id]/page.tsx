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
  Select,
} from '@dxp/ui';
import { ArrowLeft, Loader2, Landmark, Trash2, Pencil, Save, X } from 'lucide-react';

type Tier = 'TIER1' | 'TIER2';
type NPSStatus = 'ACTIVE' | 'INACTIVE' | 'MATURED';

interface NPSAccount {
  id: number;
  accountNumber: string;
  accountHolder: string;
  pan: string;
  tier: Tier;
  status: string | null;
  equityFundValue: number | null;
  debtFundValue: number | null;
  alternativeFundValue: number | null;
  totalValue: number;
  totalContributed: number;
  employerContribution: number | null;
  gainLoss: number | null;
  openingDate: string;
  expectedMaturityDate: string | null;
  notes: string | null;
}

const TIER_OPTIONS: Array<{ label: string; value: Tier }> = [
  { label: 'Tier I', value: 'TIER1' },
  { label: 'Tier II', value: 'TIER2' },
];

const STATUS_OPTIONS: Array<{ label: string; value: NPSStatus }> = [
  { label: 'Active', value: 'ACTIVE' },
  { label: 'Inactive', value: 'INACTIVE' },
  { label: 'Matured', value: 'MATURED' },
];

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

interface FormState {
  accountHolder: string;
  pan: string;
  tier: Tier;
  status: NPSStatus;
  totalValueRupees: string;
  totalContributedRupees: string;
  employerContributionRupees: string;
  equityValueRupees: string;
  debtValueRupees: string;
  alternativeValueRupees: string;
  expectedMaturityDate: string;
  notes: string;
}

function accountToForm(a: NPSAccount): FormState {
  return {
    accountHolder: a.accountHolder,
    pan: a.pan,
    tier: a.tier,
    status: (a.status as NPSStatus) ?? 'ACTIVE',
    totalValueRupees: (a.totalValue / 100).toString(),
    totalContributedRupees: (a.totalContributed / 100).toString(),
    employerContributionRupees: ((a.employerContribution ?? 0) / 100).toString(),
    equityValueRupees: ((a.equityFundValue ?? 0) / 100).toString(),
    debtValueRupees: ((a.debtFundValue ?? 0) / 100).toString(),
    alternativeValueRupees: ((a.alternativeFundValue ?? 0) / 100).toString(),
    expectedMaturityDate: a.expectedMaturityDate ?? '',
    notes: a.notes ?? '',
  };
}

export default function NPSDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [account, setAccount] = useState<NPSAccount | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/investments/nps/${params.id}`).then((r) => r.json());
      if (r.error) throw new Error(r.error);
      setAccount(r.account);
      setForm(accountToForm(r.account));
    } catch (e) {
      console.error(e);
      toast.error('Failed to load NPS account');
    } finally {
      setIsLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  const onDelete = async () => {
    if (!confirm('Delete this NPS account?')) return;
    setIsDeleting(true);
    try {
      const r = await fetch(`/api/investments/nps/${params.id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('delete failed');
      toast.success('Removed');
      router.push('/investments/nps');
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
        pan: form.pan,
        tier: form.tier,
        status: form.status,
        totalValueRupees: Number(form.totalValueRupees) || 0,
        totalContributedRupees: Number(form.totalContributedRupees) || 0,
        employerContributionRupees: Number(form.employerContributionRupees) || 0,
        equityValueRupees: Number(form.equityValueRupees) || 0,
        debtValueRupees: Number(form.debtValueRupees) || 0,
        alternativeValueRupees: Number(form.alternativeValueRupees) || 0,
        expectedMaturityDate: form.expectedMaturityDate || null,
        notes: form.notes || null,
      };
      const r = await fetch(`/api/investments/nps/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || 'Save failed');
      setAccount(data.account);
      setForm(accountToForm(data.account));
      setIsEditing(false);
      toast.success('NPS account updated');
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
  if (!account || !form) {
    return <p className="text-[var(--dxp-text-muted)]">Account not found.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Link
            href="/investments/nps"
            className="inline-flex items-center text-sm text-[var(--dxp-text-secondary)] hover:text-[var(--dxp-brand)]"
          >
            <ArrowLeft className="mr-1 h-4 w-4" /> Back to NPS
          </Link>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
            {account.accountNumber}
          </h1>
          <p className="text-[var(--dxp-text-secondary)]">{account.accountHolder} · PAN {account.pan}</p>
        </div>
        <div className="flex gap-2">
          <Badge variant={account.tier === 'TIER1' ? 'success' : 'info'}>
            {account.tier === 'TIER1' ? 'Tier I' : 'Tier II'}
          </Badge>
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
          { label: 'Current Value', value: account.totalValue / 100, format: 'currency' },
          { label: 'Total Contributed', value: account.totalContributed / 100, format: 'currency' },
          { label: 'Employer', value: (account.employerContribution ?? 0) / 100, format: 'currency' },
          { label: 'Gain/Loss', value: (account.gainLoss ?? 0) / 100, format: 'currency' },
        ]}
      />

      <Card>
        <CardHeader>
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <Landmark className="h-5 w-5 text-[var(--dxp-brand)]" />
            Account details
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

function DetailView({ account }: { account: NPSAccount }) {
  const fields: Array<[string, string]> = [
    ['Account holder', account.accountHolder],
    ['PAN', account.pan],
    ['Tier', account.tier === 'TIER1' ? 'Tier I' : 'Tier II'],
    ['Status', account.status ?? 'ACTIVE'],
    ['Opened', account.openingDate],
    ['Expected maturity', account.expectedMaturityDate ?? '---'],
    ['Equity', formatINR(account.equityFundValue ?? 0)],
    ['Debt', formatINR(account.debtFundValue ?? 0)],
    ['Alternative', formatINR(account.alternativeFundValue ?? 0)],
    ['Employer contribution', formatINR(account.employerContribution ?? 0)],
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

      <Field label="PAN">
        <Input value={form.pan} onChange={(e) => setField('pan', e.target.value)} />
      </Field>

      <Field label="Tier">
        <Select
          value={form.tier}
          onChange={(v) => setField('tier', v as Tier)}
          options={TIER_OPTIONS}
        />
      </Field>

      <Field label="Status">
        <Select
          value={form.status}
          onChange={(v) => setField('status', v as NPSStatus)}
          options={STATUS_OPTIONS}
        />
      </Field>

      <Field label="Total value (₹)">
        <Input
          type="number"
          value={form.totalValueRupees}
          onChange={(e) => setField('totalValueRupees', e.target.value)}
        />
      </Field>

      <Field label="Total contributed (₹)">
        <Input
          type="number"
          value={form.totalContributedRupees}
          onChange={(e) => setField('totalContributedRupees', e.target.value)}
        />
      </Field>

      <Field label="Employer contribution (₹)">
        <Input
          type="number"
          value={form.employerContributionRupees}
          onChange={(e) => setField('employerContributionRupees', e.target.value)}
        />
      </Field>

      <Field label="Equity value (₹)">
        <Input
          type="number"
          value={form.equityValueRupees}
          onChange={(e) => setField('equityValueRupees', e.target.value)}
        />
      </Field>

      <Field label="Debt value (₹)">
        <Input
          type="number"
          value={form.debtValueRupees}
          onChange={(e) => setField('debtValueRupees', e.target.value)}
        />
      </Field>

      <Field label="Alternative value (₹)">
        <Input
          type="number"
          value={form.alternativeValueRupees}
          onChange={(e) => setField('alternativeValueRupees', e.target.value)}
        />
      </Field>

      <Field label="Expected maturity date">
        <Input
          type="date"
          value={form.expectedMaturityDate}
          onChange={(e) => setField('expectedMaturityDate', e.target.value)}
        />
      </Field>

      <div />

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
