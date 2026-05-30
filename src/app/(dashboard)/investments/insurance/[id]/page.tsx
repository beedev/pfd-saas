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
import { ArrowLeft, Loader2, Umbrella, Trash2, Pencil, Save, X } from 'lucide-react';

type PolicyType =
  | 'TERM_LIFE'
  | 'WHOLE_LIFE'
  | 'ENDOWMENT'
  | 'ULIP'
  | 'HEALTH'
  | 'CRITICAL_ILLNESS'
  | 'DISABILITY'
  | 'ACCIDENT';

type PolicyStatus = 'ACTIVE' | 'LAPSED' | 'SURRENDERED' | 'MATURED' | 'CLAIMED';

interface Policy {
  id: number;
  policyNumber: string;
  policyType: PolicyType;
  status: PolicyStatus | null;
  policyHolder: string;
  insurer: string;
  sumAssured: number;
  premiumAmount: number;
  premiumFrequency: string | null;
  policyStartDate: string;
  maturityDate: string | null;
  policyTerm: number | null;
  investmentValue: number | null;
  maturityBenefit: number | null;
  annuityAmount: number | null;
  annuityFrequency: string | null;
  annuityStartDate: string | null;
  nomineeName: string | null;
  nomineeRelation: string | null;
  notes: string | null;
}

const POLICY_TYPE_OPTIONS: Array<{ label: string; value: PolicyType }> = [
  { label: 'Term life', value: 'TERM_LIFE' },
  { label: 'Whole life', value: 'WHOLE_LIFE' },
  { label: 'Endowment', value: 'ENDOWMENT' },
  { label: 'ULIP', value: 'ULIP' },
  { label: 'Health', value: 'HEALTH' },
  { label: 'Critical illness', value: 'CRITICAL_ILLNESS' },
  { label: 'Disability', value: 'DISABILITY' },
  { label: 'Accident', value: 'ACCIDENT' },
];

const STATUS_OPTIONS: Array<{ label: string; value: PolicyStatus }> = [
  { label: 'Active', value: 'ACTIVE' },
  { label: 'Lapsed', value: 'LAPSED' },
  { label: 'Surrendered', value: 'SURRENDERED' },
  { label: 'Matured', value: 'MATURED' },
  { label: 'Claimed', value: 'CLAIMED' },
];

const FREQUENCY_OPTIONS: Array<{ label: string; value: string }> = [
  { label: 'Monthly', value: 'MONTHLY' },
  { label: 'Quarterly', value: 'QUARTERLY' },
  { label: 'Half-yearly', value: 'HALF_YEARLY' },
  { label: 'Yearly', value: 'YEARLY' },
  { label: 'Single', value: 'SINGLE' },
];

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

interface FormState {
  policyType: PolicyType;
  status: PolicyStatus;
  policyHolder: string;
  insurer: string;
  sumAssuredRupees: string;
  premiumAmountRupees: string;
  premiumFrequency: string;
  policyStartDate: string;
  maturityDate: string;
  policyTerm: string;
  investmentValueRupees: string;
  maturityBenefitRupees: string;
  annuityAmountRupees: string;
  annuityFrequency: string;
  annuityStartDate: string;
  nomineeName: string;
  nomineeRelation: string;
  notes: string;
}

function policyToForm(p: Policy): FormState {
  return {
    policyType: p.policyType,
    status: p.status ?? 'ACTIVE',
    policyHolder: p.policyHolder,
    insurer: p.insurer,
    sumAssuredRupees: (p.sumAssured / 100).toString(),
    premiumAmountRupees: (p.premiumAmount / 100).toString(),
    premiumFrequency: p.premiumFrequency ?? 'YEARLY',
    policyStartDate: p.policyStartDate,
    maturityDate: p.maturityDate ?? '',
    policyTerm: p.policyTerm?.toString() ?? '',
    investmentValueRupees: ((p.investmentValue ?? 0) / 100).toString(),
    maturityBenefitRupees: ((p.maturityBenefit ?? 0) / 100).toString(),
    annuityAmountRupees: ((p.annuityAmount ?? 0) / 100).toString(),
    annuityFrequency: p.annuityFrequency ?? '',
    annuityStartDate: p.annuityStartDate ?? '',
    nomineeName: p.nomineeName ?? '',
    nomineeRelation: p.nomineeRelation ?? '',
    notes: p.notes ?? '',
  };
}

export default function PolicyDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/investments/insurance/${params.id}`).then((r) => r.json());
      if (r.error) throw new Error(r.error);
      setPolicy(r.policy);
      setForm(policyToForm(r.policy));
    } catch (e) {
      console.error(e);
      toast.error('Failed to load policy');
    } finally {
      setIsLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  const onDelete = async () => {
    if (!confirm('Delete this policy?')) return;
    setIsDeleting(true);
    try {
      const r = await fetch(`/api/investments/insurance/${params.id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('delete failed');
      toast.success('Removed');
      router.push('/investments/insurance');
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
        policyType: form.policyType,
        status: form.status,
        policyHolder: form.policyHolder,
        insurer: form.insurer,
        sumAssuredRupees: Number(form.sumAssuredRupees) || 0,
        premiumAmountRupees: Number(form.premiumAmountRupees) || 0,
        premiumFrequency: form.premiumFrequency,
        policyStartDate: form.policyStartDate,
        maturityDate: form.maturityDate || null,
        policyTerm: form.policyTerm ? Number(form.policyTerm) : null,
        investmentValueRupees: Number(form.investmentValueRupees) || 0,
        maturityBenefitRupees: Number(form.maturityBenefitRupees) || 0,
        annuityAmountRupees: Number(form.annuityAmountRupees) || null,
        annuityFrequency: form.annuityFrequency || null,
        annuityStartDate: form.annuityStartDate || null,
        nomineeName: form.nomineeName || null,
        nomineeRelation: form.nomineeRelation || null,
        notes: form.notes || null,
      };
      const r = await fetch(`/api/investments/insurance/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || 'Save failed');
      setPolicy(data.policy);
      setForm(policyToForm(data.policy));
      setIsEditing(false);
      toast.success('Policy updated');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  };

  const cancelEdit = () => {
    if (policy) setForm(policyToForm(policy));
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
  if (!policy || !form) return <p>Not found</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Link
            href="/investments/insurance"
            className="inline-flex items-center text-sm text-[var(--dxp-text-secondary)] hover:text-[var(--dxp-brand)]"
          >
            <ArrowLeft className="mr-1 h-4 w-4" /> Back to insurance
          </Link>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
            {policy.policyNumber}
          </h1>
          <p className="text-[var(--dxp-text-secondary)]">
            {policy.insurer} · {policy.policyHolder}
          </p>
        </div>
        <div className="flex gap-2">
          <Badge variant="info">{policy.policyType.replace('_', ' ')}</Badge>
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
          { label: 'Sum Assured', value: policy.sumAssured / 100, format: 'currency' },
          { label: 'Premium', value: policy.premiumAmount / 100, format: 'currency' },
          { label: 'Surrender Value', value: (policy.investmentValue ?? 0) / 100, format: 'currency' },
          { label: 'Maturity Benefit', value: (policy.maturityBenefit ?? 0) / 100, format: 'currency' },
          ...(policy.annuityAmount
            ? [
                {
                  label: `Annuity (${(policy.annuityFrequency ?? 'YEARLY').toLowerCase().replace('_', '-')})`,
                  value: policy.annuityAmount / 100,
                  format: 'currency' as const,
                },
              ]
            : []),
        ]}
      />

      <Card>
        <CardHeader>
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <Umbrella className="h-5 w-5 text-[var(--dxp-brand)]" />
            Policy details
          </h3>
        </CardHeader>
        <CardContent>
          {!isEditing ? (
            <DetailView policy={policy} />
          ) : (
            <EditForm form={form} setField={setField} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ─── view mode ───────────────────────────────────────────────────────── */

function DetailView({ policy }: { policy: Policy }) {
  const fields: Array<[string, string]> = [
    ['Type', policy.policyType.replace('_', ' ')],
    ['Status', policy.status ?? 'ACTIVE'],
    ['Frequency', policy.premiumFrequency ?? '—'],
    ['Start date', policy.policyStartDate],
    ['Maturity', policy.maturityDate ?? '—'],
    ['Term', policy.policyTerm ? `${policy.policyTerm} years` : '—'],
    ['Nominee', policy.nomineeName ?? '—'],
    ['Nominee relation', policy.nomineeRelation ?? '—'],
    ...(policy.policyType === 'WHOLE_LIFE' || policy.annuityAmount
      ? [
          ['Annuity', policy.annuityAmount ? formatINR(policy.annuityAmount) : '—'] as [string, string],
          ['Annuity frequency', policy.annuityFrequency ?? '—'] as [string, string],
          ['Annuity start', policy.annuityStartDate ?? '—'] as [string, string],
        ]
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
      {policy.notes && (
        <p className="mt-4 text-sm text-[var(--dxp-text-secondary)]">{policy.notes}</p>
      )}
    </>
  );
}

/* ─── edit mode ───────────────────────────────────────────────────────── */

function EditForm({
  form,
  setField,
}: {
  form: FormState;
  setField: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="Policy type">
        <Select
          value={form.policyType}
          onChange={(v) => setField('policyType', v as FormState['policyType'])}
          options={POLICY_TYPE_OPTIONS}
        />
      </Field>

      <Field label="Status">
        <Select
          value={form.status}
          onChange={(v) => setField('status', v as FormState['status'])}
          options={STATUS_OPTIONS}
        />
      </Field>

      <Field label="Sum assured (₹)">
        <Input
          type="number"
          value={form.sumAssuredRupees}
          onChange={(e) => setField('sumAssuredRupees', e.target.value)}
          placeholder="0"
        />
      </Field>

      <Field label="Premium (₹)">
        <Input
          type="number"
          value={form.premiumAmountRupees}
          onChange={(e) => setField('premiumAmountRupees', e.target.value)}
        />
      </Field>

      <Field label="Premium frequency">
        <Select
          value={form.premiumFrequency}
          onChange={(v) => setField('premiumFrequency', v)}
          options={FREQUENCY_OPTIONS}
        />
      </Field>

      <Field label="Policy holder">
        <Input
          value={form.policyHolder}
          onChange={(e) => setField('policyHolder', e.target.value)}
        />
      </Field>

      <Field label="Insurer">
        <Input value={form.insurer} onChange={(e) => setField('insurer', e.target.value)} />
      </Field>

      <Field label="Start date">
        <Input
          type="date"
          value={form.policyStartDate}
          onChange={(e) => setField('policyStartDate', e.target.value)}
        />
      </Field>

      <Field label="Maturity date">
        <Input
          type="date"
          value={form.maturityDate}
          onChange={(e) => setField('maturityDate', e.target.value)}
        />
      </Field>

      <Field label="Policy term (years)">
        <Input
          type="number"
          value={form.policyTerm}
          onChange={(e) => setField('policyTerm', e.target.value)}
        />
      </Field>

      <Field label="Surrender / current value (₹)">
        <Input
          type="number"
          value={form.investmentValueRupees}
          onChange={(e) => setField('investmentValueRupees', e.target.value)}
        />
      </Field>

      <Field label="Maturity benefit (₹)">
        <Input
          type="number"
          value={form.maturityBenefitRupees}
          onChange={(e) => setField('maturityBenefitRupees', e.target.value)}
        />
      </Field>

      {(form.policyType === 'WHOLE_LIFE' || Number(form.annuityAmountRupees) > 0) && (
        <>
          <div className="sm:col-span-2">
            <p className="text-xs font-bold uppercase tracking-wider text-amber-700 mb-2">
              Annuity / pension payout
            </p>
          </div>
          <Field label="Annuity amount (₹)">
            <Input
              type="number"
              value={form.annuityAmountRupees}
              onChange={(e) => setField('annuityAmountRupees', e.target.value)}
              placeholder="per period"
            />
          </Field>
          <Field label="Annuity frequency">
            <Select
              value={form.annuityFrequency}
              onChange={(v) => setField('annuityFrequency', v)}
              options={[
                { label: 'Not set', value: '' },
                ...FREQUENCY_OPTIONS,
              ]}
            />
          </Field>
          <Field label="Annuity start date">
            <Input
              type="date"
              value={form.annuityStartDate}
              onChange={(e) => setField('annuityStartDate', e.target.value)}
            />
          </Field>
          <div />
        </>
      )}

      <Field label="Nominee name">
        <Input
          value={form.nomineeName}
          onChange={(e) => setField('nomineeName', e.target.value)}
        />
      </Field>

      <Field label="Nominee relation">
        <Input
          value={form.nomineeRelation}
          onChange={(e) => setField('nomineeRelation', e.target.value)}
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
