'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
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
  DataTable,
  type Column,
} from '@dxp/ui';
import {
  ArrowLeft,
  Loader2,
  HeartPulse,
  Trash2,
  Pencil,
  Save,
  X,
  Plus,
  Upload,
  IdCard,
  FileText,
  Repeat,
  Image as ImageIcon,
} from 'lucide-react';

type HealthPolicyType =
  | 'INDIVIDUAL'
  | 'FAMILY_FLOATER'
  | 'TOPUP'
  | 'SUPER_TOPUP'
  | 'CRITICAL_ILLNESS'
  | 'OPD_RIDER';

type HealthPolicyStatus = 'ACTIVE' | 'LAPSED' | 'CLAIMED' | 'PORTED_OUT' | 'CANCELLED';

type PremiumFrequency = 'ANNUAL' | 'SEMI_ANNUAL' | 'QUARTERLY' | 'MONTHLY';

type FamilyRelationship =
  | 'SELF'
  | 'SPOUSE'
  | 'SON'
  | 'DAUGHTER'
  | 'FATHER'
  | 'MOTHER'
  | 'FATHER_IN_LAW'
  | 'MOTHER_IN_LAW'
  | 'OTHER';

type ClaimStatus =
  | 'INTIMATED'
  | 'DOCUMENTS_PENDING'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'PARTIAL'
  | 'REJECTED'
  | 'SETTLED';

interface Policy {
  id: number;
  insurer: string;
  policyNumber: string;
  policyType: HealthPolicyType;
  status: HealthPolicyStatus | null;
  policyHolder: string;
  sumInsuredPaisa: number;
  cumulativeBonusPaisa: number | null;
  ncbPercent: number | null;
  premiumPaisa: number;
  premiumFrequency: PremiumFrequency | null;
  startDate: string;
  renewalDate: string | null;
  lastRenewedDate: string | null;
  waitingPeriodMonths: number | null;
  servedWaitingMonths: number | null;
  preExistingDiseases: string | null;
  cashlessAvailable: boolean | null;
  networkHospitalCount: number | null;
  notes: string | null;
}

interface CardRow {
  id: number;
  policyId: number;
  memberName: string;
  memberId: string | null;
  relationship: FamilyRelationship;
  dateOfBirth: string | null;
  gender: string | null;
  cardImagePath: string | null;
  eCardUrl: string | null;
  validUntil: string | null;
  notes: string | null;
}

interface ClaimRow {
  id: number;
  policyId: number;
  memberName: string;
  cardId: number | null;
  claimDate: string;
  hospital: string | null;
  diagnosis: string | null;
  claimAmountPaisa: number;
  approvedAmountPaisa: number | null;
  cashless: boolean | null;
  status: ClaimStatus;
  settlementDate: string | null;
  rejectionReason: string | null;
  notes: string | null;
}

interface PortabilityRow {
  id: number;
  policyId: number;
  previousInsurer: string;
  previousPolicyNumber: string | null;
  portedDate: string;
  portedSumInsuredPaisa: number | null;
  waitingPeriodUsedMonths: number;
  ncbCarriedPercent: number | null;
  notes: string | null;
}

const POLICY_TYPE_OPTIONS: Array<{ label: string; value: HealthPolicyType }> = [
  { label: 'Individual', value: 'INDIVIDUAL' },
  { label: 'Family floater', value: 'FAMILY_FLOATER' },
  { label: 'Top-up', value: 'TOPUP' },
  { label: 'Super top-up', value: 'SUPER_TOPUP' },
  { label: 'Critical illness', value: 'CRITICAL_ILLNESS' },
  { label: 'OPD rider', value: 'OPD_RIDER' },
];

const STATUS_OPTIONS: Array<{ label: string; value: HealthPolicyStatus }> = [
  { label: 'Active', value: 'ACTIVE' },
  { label: 'Lapsed', value: 'LAPSED' },
  { label: 'Claimed', value: 'CLAIMED' },
  { label: 'Ported out', value: 'PORTED_OUT' },
  { label: 'Cancelled', value: 'CANCELLED' },
];

const FREQUENCY_OPTIONS: Array<{ label: string; value: PremiumFrequency }> = [
  { label: 'Annual', value: 'ANNUAL' },
  { label: 'Semi-annual', value: 'SEMI_ANNUAL' },
  { label: 'Quarterly', value: 'QUARTERLY' },
  { label: 'Monthly', value: 'MONTHLY' },
];

const RELATIONSHIP_OPTIONS: Array<{ label: string; value: FamilyRelationship }> = [
  { label: 'Self', value: 'SELF' },
  { label: 'Spouse', value: 'SPOUSE' },
  { label: 'Son', value: 'SON' },
  { label: 'Daughter', value: 'DAUGHTER' },
  { label: 'Father', value: 'FATHER' },
  { label: 'Mother', value: 'MOTHER' },
  { label: 'Father-in-law', value: 'FATHER_IN_LAW' },
  { label: 'Mother-in-law', value: 'MOTHER_IN_LAW' },
  { label: 'Other', value: 'OTHER' },
];

const CLAIM_STATUS_OPTIONS: Array<{ label: string; value: ClaimStatus }> = [
  { label: 'Intimated', value: 'INTIMATED' },
  { label: 'Documents pending', value: 'DOCUMENTS_PENDING' },
  { label: 'Under review', value: 'UNDER_REVIEW' },
  { label: 'Approved', value: 'APPROVED' },
  { label: 'Partial', value: 'PARTIAL' },
  { label: 'Rejected', value: 'REJECTED' },
  { label: 'Settled', value: 'SETTLED' },
];

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

interface FormState {
  policyType: HealthPolicyType;
  status: HealthPolicyStatus;
  policyHolder: string;
  insurer: string;
  policyNumber: string;
  sumInsuredRupees: string;
  premiumRupees: string;
  premiumFrequency: PremiumFrequency;
  startDate: string;
  renewalDate: string;
  lastRenewedDate: string;
  waitingPeriodMonths: string;
  servedWaitingMonths: string;
  preExistingDiseases: string;
  cashlessAvailable: boolean;
  networkHospitalCount: string;
  ncbPercent: string;
  notes: string;
}

function policyToForm(p: Policy): FormState {
  return {
    policyType: p.policyType,
    status: p.status ?? 'ACTIVE',
    policyHolder: p.policyHolder,
    insurer: p.insurer,
    policyNumber: p.policyNumber,
    sumInsuredRupees: (p.sumInsuredPaisa / 100).toString(),
    premiumRupees: (p.premiumPaisa / 100).toString(),
    premiumFrequency: p.premiumFrequency ?? 'ANNUAL',
    startDate: p.startDate,
    renewalDate: p.renewalDate ?? '',
    lastRenewedDate: p.lastRenewedDate ?? '',
    waitingPeriodMonths: p.waitingPeriodMonths?.toString() ?? '',
    servedWaitingMonths: p.servedWaitingMonths?.toString() ?? '',
    preExistingDiseases: p.preExistingDiseases ?? '',
    cashlessAvailable: p.cashlessAvailable ?? true,
    networkHospitalCount: p.networkHospitalCount?.toString() ?? '',
    ncbPercent: p.ncbPercent?.toString() ?? '',
    notes: p.notes ?? '',
  };
}

export default function HealthPolicyDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [policy, setPolicy] = useState<Policy | null>(null);
  const [cards, setCards] = useState<CardRow[]>([]);
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [portability, setPortability] = useState<PortabilityRow | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);

  const policyId = params.id;

  const load = useCallback(async () => {
    try {
      const [bundleRes, claimsRes, portRes] = await Promise.all([
        fetch(`/api/investments/health-insurance/${policyId}`).then((r) => r.json()),
        fetch(`/api/investments/health-insurance/${policyId}/claims`)
          .then((r) => (r.ok ? r.json() : { claims: [] }))
          .catch(() => ({ claims: [] })),
        fetch(`/api/investments/health-insurance/${policyId}/portability`)
          .then((r) => (r.ok ? r.json() : { portability: null }))
          .catch(() => ({ portability: null })),
      ]);

      if (bundleRes.error) throw new Error(bundleRes.error);

      setPolicy(bundleRes.policy);
      setCards(bundleRes.cards || []);
      setForm(policyToForm(bundleRes.policy));
      setClaims(claimsRes.claims || []);
      setPortability(portRes.portability ?? null);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load policy');
    } finally {
      setIsLoading(false);
    }
  }, [policyId]);

  useEffect(() => {
    load();
  }, [load]);

  const onDelete = async () => {
    if (!confirm('Delete this policy along with all cards, claims and portability records?'))
      return;
    setIsDeleting(true);
    try {
      const r = await fetch(`/api/investments/health-insurance/${policyId}`, {
        method: 'DELETE',
      });
      if (!r.ok) throw new Error('delete failed');
      toast.success('Removed');
      router.push('/investments/health-insurance');
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
        policyNumber: form.policyNumber,
        sumInsuredRupees: Number(form.sumInsuredRupees) || 0,
        premiumRupees: Number(form.premiumRupees) || 0,
        premiumFrequency: form.premiumFrequency,
        startDate: form.startDate,
        renewalDate: form.renewalDate || null,
        lastRenewedDate: form.lastRenewedDate || null,
        waitingPeriodMonths: form.waitingPeriodMonths ? Number(form.waitingPeriodMonths) : null,
        servedWaitingMonths: form.servedWaitingMonths ? Number(form.servedWaitingMonths) : null,
        preExistingDiseases: form.preExistingDiseases || null,
        cashlessAvailable: form.cashlessAvailable,
        networkHospitalCount: form.networkHospitalCount ? Number(form.networkHospitalCount) : null,
        ncbPercent: form.ncbPercent ? Number(form.ncbPercent) : null,
        notes: form.notes || null,
      };
      const r = await fetch(`/api/investments/health-insurance/${policyId}`, {
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
            href="/investments/health-insurance"
            className="inline-flex items-center text-sm text-[var(--dxp-text-secondary)] hover:text-[var(--dxp-brand)]"
          >
            <ArrowLeft className="mr-1 h-4 w-4" /> Back to health insurance
          </Link>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
            {policy.insurer}
          </h1>
          <p className="font-mono text-[var(--dxp-text-secondary)]">{policy.policyNumber}</p>
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
          { label: 'Sum insured', value: policy.sumInsuredPaisa / 100, format: 'currency' },
          {
            label: 'Cumulative bonus',
            value: (policy.cumulativeBonusPaisa ?? 0) / 100,
            format: 'currency',
          },
          { label: 'Premium', value: policy.premiumPaisa / 100, format: 'currency' },
          { label: 'Cards', value: cards.length, format: 'number' },
        ]}
      />

      <Card>
        <CardHeader>
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <HeartPulse className="h-5 w-5 text-[var(--dxp-brand)]" />
            Policy details
          </h3>
        </CardHeader>
        <CardContent>
          {!isEditing ? (
            <PolicyDetailView policy={policy} />
          ) : (
            <PolicyEditForm form={form} setField={setField} />
          )}
        </CardContent>
      </Card>

      <CardsSection policyId={policy.id} cards={cards} onChanged={load} />

      <ClaimsSection
        policyId={policy.id}
        claims={claims}
        cards={cards}
        onChanged={load}
      />

      <PortabilitySection policyId={policy.id} portability={portability} onChanged={load} />
    </div>
  );
}

/* ─── view mode ───────────────────────────────────────────────────────── */

function PolicyDetailView({ policy }: { policy: Policy }) {
  const fields: Array<[string, string]> = [
    ['Type', policy.policyType.replace('_', ' ')],
    ['Status', policy.status ?? 'ACTIVE'],
    ['Policy holder', policy.policyHolder],
    ['Frequency', policy.premiumFrequency ?? '—'],
    ['Start date', policy.startDate],
    ['Renewal', policy.renewalDate ?? '—'],
    ['Last renewed', policy.lastRenewedDate ?? '—'],
    [
      'Waiting period',
      policy.waitingPeriodMonths != null ? `${policy.waitingPeriodMonths} months` : '—',
    ],
    [
      'Served waiting',
      policy.servedWaitingMonths != null ? `${policy.servedWaitingMonths} months` : '—',
    ],
    ['NCB earned', policy.ncbPercent != null ? `${policy.ncbPercent}%` : '—'],
    ['Cashless', policy.cashlessAvailable ? 'Yes' : 'No'],
    ['Network hospitals', policy.networkHospitalCount?.toString() ?? '—'],
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
      {policy.preExistingDiseases && (
        <div className="mt-4">
          <p className="text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)] mb-1">
            Pre-existing diseases
          </p>
          <p className="text-sm text-[var(--dxp-text)] whitespace-pre-wrap">
            {policy.preExistingDiseases}
          </p>
        </div>
      )}
      {policy.notes && (
        <p className="mt-4 text-sm text-[var(--dxp-text-secondary)] whitespace-pre-wrap">
          {policy.notes}
        </p>
      )}
    </>
  );
}

/* ─── edit mode ───────────────────────────────────────────────────────── */

function PolicyEditForm({
  form,
  setField,
}: {
  form: FormState;
  setField: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="Insurer">
        <Input value={form.insurer} onChange={(e) => setField('insurer', e.target.value)} />
      </Field>
      <Field label="Policy number">
        <Input
          value={form.policyNumber}
          onChange={(e) => setField('policyNumber', e.target.value)}
        />
      </Field>
      <Field label="Policy type">
        <Select
          value={form.policyType}
          onChange={(v) => setField('policyType', v as HealthPolicyType)}
          options={POLICY_TYPE_OPTIONS}
        />
      </Field>
      <Field label="Status">
        <Select
          value={form.status}
          onChange={(v) => setField('status', v as HealthPolicyStatus)}
          options={STATUS_OPTIONS}
        />
      </Field>
      <Field label="Policy holder">
        <Input
          value={form.policyHolder}
          onChange={(e) => setField('policyHolder', e.target.value)}
        />
      </Field>
      <Field label="Sum insured (₹)">
        <Input
          type="number"
          value={form.sumInsuredRupees}
          onChange={(e) => setField('sumInsuredRupees', e.target.value)}
        />
      </Field>
      <Field label="Premium (₹)">
        <Input
          type="number"
          value={form.premiumRupees}
          onChange={(e) => setField('premiumRupees', e.target.value)}
        />
      </Field>
      <Field label="Premium frequency">
        <Select
          value={form.premiumFrequency}
          onChange={(v) => setField('premiumFrequency', v as PremiumFrequency)}
          options={FREQUENCY_OPTIONS}
        />
      </Field>
      <Field label="Start date">
        <Input
          type="date"
          value={form.startDate}
          onChange={(e) => setField('startDate', e.target.value)}
        />
      </Field>
      <Field label="Renewal date">
        <Input
          type="date"
          value={form.renewalDate}
          onChange={(e) => setField('renewalDate', e.target.value)}
        />
      </Field>
      <Field label="Last renewed">
        <Input
          type="date"
          value={form.lastRenewedDate}
          onChange={(e) => setField('lastRenewedDate', e.target.value)}
        />
      </Field>
      <Field label="Waiting period (months)">
        <Input
          type="number"
          value={form.waitingPeriodMonths}
          onChange={(e) => setField('waitingPeriodMonths', e.target.value)}
        />
      </Field>
      <Field label="Served waiting (months)">
        <Input
          type="number"
          value={form.servedWaitingMonths}
          onChange={(e) => setField('servedWaitingMonths', e.target.value)}
        />
      </Field>
      <Field label="NCB earned (%)">
        <Input
          type="number"
          step="0.01"
          value={form.ncbPercent}
          onChange={(e) => setField('ncbPercent', e.target.value)}
        />
      </Field>
      <Field label="Network hospital count">
        <Input
          type="number"
          value={form.networkHospitalCount}
          onChange={(e) => setField('networkHospitalCount', e.target.value)}
        />
      </Field>
      <div className="flex items-center pt-6">
        <label className="flex items-center gap-2 text-sm text-[var(--dxp-text)]">
          <input
            type="checkbox"
            checked={form.cashlessAvailable}
            onChange={(e) => setField('cashlessAvailable', e.target.checked)}
            className="h-4 w-4 rounded border-[var(--dxp-border)]"
          />
          Cashless available
        </label>
      </div>
      <div className="sm:col-span-2">
        <Field label="Pre-existing diseases">
          <textarea
            value={form.preExistingDiseases}
            onChange={(e) => setField('preExistingDiseases', e.target.value)}
            rows={2}
            className="w-full rounded border border-[var(--dxp-border)] bg-[var(--dxp-surface)] p-2 text-sm text-[var(--dxp-text)] focus:border-[var(--dxp-brand)] focus:outline-none"
          />
        </Field>
      </div>
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

/* ─── cards section ───────────────────────────────────────────────────── */

interface CardFormState {
  memberName: string;
  memberId: string;
  relationship: FamilyRelationship;
  dateOfBirth: string;
  gender: string;
  eCardUrl: string;
  validUntil: string;
}

const emptyCardForm: CardFormState = {
  memberName: '',
  memberId: '',
  relationship: 'SELF',
  dateOfBirth: '',
  gender: '',
  eCardUrl: '',
  validUntil: '',
};

function CardsSection({
  policyId,
  cards,
  onChanged,
}: {
  policyId: number;
  cards: CardRow[];
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<CardFormState>(emptyCardForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadingId, setUploadingId] = useState<number | null>(null);
  const fileInputs = useRef<Record<number, HTMLInputElement | null>>({});

  const startAdd = () => {
    setForm(emptyCardForm);
    setEditingId(null);
    setAdding(true);
  };
  const startEdit = (c: CardRow) => {
    setForm({
      memberName: c.memberName,
      memberId: c.memberId ?? '',
      relationship: c.relationship,
      dateOfBirth: c.dateOfBirth ?? '',
      gender: c.gender ?? '',
      eCardUrl: c.eCardUrl ?? '',
      validUntil: c.validUntil ?? '',
    });
    setEditingId(c.id);
    setAdding(true);
  };
  const cancel = () => {
    setAdding(false);
    setEditingId(null);
    setForm(emptyCardForm);
  };

  const submit = async () => {
    if (!form.memberName.trim()) {
      toast.error('Member name is required');
      return;
    }
    setIsSubmitting(true);
    try {
      const body = {
        memberName: form.memberName.trim(),
        memberId: form.memberId.trim() || null,
        relationship: form.relationship,
        dateOfBirth: form.dateOfBirth || null,
        gender: form.gender || null,
        eCardUrl: form.eCardUrl.trim() || null,
        validUntil: form.validUntil || null,
      };
      const url = editingId
        ? `/api/investments/health-insurance/cards/${editingId}`
        : `/api/investments/health-insurance/${policyId}/cards`;
      const r = await fetch(url, {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || 'Save failed');
      }
      toast.success(editingId ? 'Card updated' : 'Card added');
      cancel();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const remove = async (id: number) => {
    if (!confirm('Delete this card?')) return;
    try {
      const r = await fetch(`/api/investments/health-insurance/cards/${id}`, {
        method: 'DELETE',
      });
      if (!r.ok) throw new Error('delete failed');
      toast.success('Card removed');
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const upload = async (cardId: number, file: File) => {
    setUploadingId(cardId);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch(`/api/investments/health-insurance/cards/${cardId}/upload`, {
        method: 'POST',
        body: fd,
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || 'Upload failed');
      }
      toast.success('Card image uploaded');
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploadingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <IdCard className="h-5 w-5 text-[var(--dxp-brand)]" />
            Cards ({cards.length})
          </h3>
          {!adding && (
            <Button variant="secondary" size="sm" onClick={startAdd}>
              <Plus className="mr-1 h-3 w-3" /> Add card
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {adding && (
          <div className="mb-4 rounded-lg border border-[var(--dxp-border)] bg-[var(--dxp-surface-alt)] p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Member name">
                <Input
                  value={form.memberName}
                  onChange={(e) => setForm((f) => ({ ...f, memberName: e.target.value }))}
                />
              </Field>
              <Field label="Member ID">
                <Input
                  value={form.memberId}
                  onChange={(e) => setForm((f) => ({ ...f, memberId: e.target.value }))}
                  placeholder="e.g. SH123456789"
                />
              </Field>
              <Field label="Relationship">
                <Select
                  value={form.relationship}
                  onChange={(v) =>
                    setForm((f) => ({ ...f, relationship: v as FamilyRelationship }))
                  }
                  options={RELATIONSHIP_OPTIONS}
                />
              </Field>
              <Field label="Gender">
                <Select
                  value={form.gender}
                  onChange={(v) => setForm((f) => ({ ...f, gender: v }))}
                  options={[
                    { label: 'Not set', value: '' },
                    { label: 'Male', value: 'MALE' },
                    { label: 'Female', value: 'FEMALE' },
                    { label: 'Other', value: 'OTHER' },
                  ]}
                />
              </Field>
              <Field label="Date of birth">
                <Input
                  type="date"
                  value={form.dateOfBirth}
                  onChange={(e) => setForm((f) => ({ ...f, dateOfBirth: e.target.value }))}
                />
              </Field>
              <Field label="Valid until">
                <Input
                  type="date"
                  value={form.validUntil}
                  onChange={(e) => setForm((f) => ({ ...f, validUntil: e.target.value }))}
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="E-card URL">
                  <Input
                    value={form.eCardUrl}
                    onChange={(e) => setForm((f) => ({ ...f, eCardUrl: e.target.value }))}
                    placeholder="https://..."
                  />
                </Field>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={cancel} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={submit} disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                {editingId ? 'Update card' : 'Add card'}
              </Button>
            </div>
          </div>
        )}

        {cards.length === 0 && !adding ? (
          <p className="py-4 text-center text-sm text-[var(--dxp-text-muted)]">
            No cards yet. Add one for each insured member.
          </p>
        ) : (
          <div className="space-y-3">
            {cards.map((c) => (
              <div
                key={c.id}
                className="flex flex-col gap-3 rounded-lg border border-[var(--dxp-border-light)] p-3 sm:flex-row sm:items-start"
              >
                <div className="flex-shrink-0">
                  {c.cardImagePath ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/investments/health-insurance/cards/${c.id}/download`}
                      alt={`${c.memberName} card`}
                      className="h-24 w-40 rounded border border-[var(--dxp-border)] object-cover"
                    />
                  ) : (
                    <div className="flex h-24 w-40 items-center justify-center rounded border border-dashed border-[var(--dxp-border)] bg-[var(--dxp-surface-alt)] text-[var(--dxp-text-muted)]">
                      <ImageIcon className="h-6 w-6" />
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-[var(--dxp-text)]">{c.memberName}</p>
                      <p className="text-xs text-[var(--dxp-text-muted)]">
                        {c.relationship.replace('_', ' ').toLowerCase()}
                        {c.memberId ? ` · ${c.memberId}` : ''}
                      </p>
                      {c.dateOfBirth && (
                        <p className="text-xs text-[var(--dxp-text-muted)]">DOB: {c.dateOfBirth}</p>
                      )}
                      {c.validUntil && (
                        <p className="text-xs text-[var(--dxp-text-muted)]">
                          Valid until: {c.validUntil}
                        </p>
                      )}
                      {c.eCardUrl && (
                        <a
                          href={c.eCardUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-[var(--dxp-brand)] hover:underline"
                        >
                          E-card portal ↗
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      ref={(el) => {
                        fileInputs.current[c.id] = el;
                      }}
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) upload(c.id, f);
                        e.target.value = '';
                      }}
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => fileInputs.current[c.id]?.click()}
                      disabled={uploadingId === c.id}
                    >
                      {uploadingId === c.id ? (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      ) : (
                        <Upload className="mr-1 h-3 w-3" />
                      )}
                      {c.cardImagePath ? 'Replace image' : 'Upload image'}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => startEdit(c)}>
                      <Pencil className="mr-1 h-3 w-3" /> Edit
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => remove(c.id)}>
                      <Trash2 className="mr-1 h-3 w-3 text-rose-500" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ─── claims section ──────────────────────────────────────────────────── */

interface ClaimFormState {
  memberName: string;
  cardId: string;
  claimDate: string;
  hospital: string;
  diagnosis: string;
  claimAmountRupees: string;
  approvedAmountRupees: string;
  cashless: boolean;
  status: ClaimStatus;
  settlementDate: string;
  rejectionReason: string;
  notes: string;
}

const emptyClaimForm: ClaimFormState = {
  memberName: '',
  cardId: '',
  claimDate: '',
  hospital: '',
  diagnosis: '',
  claimAmountRupees: '',
  approvedAmountRupees: '',
  cashless: true,
  status: 'INTIMATED',
  settlementDate: '',
  rejectionReason: '',
  notes: '',
};

function claimToForm(c: ClaimRow): ClaimFormState {
  return {
    memberName: c.memberName,
    cardId: c.cardId?.toString() ?? '',
    claimDate: c.claimDate,
    hospital: c.hospital ?? '',
    diagnosis: c.diagnosis ?? '',
    claimAmountRupees: (c.claimAmountPaisa / 100).toString(),
    approvedAmountRupees:
      c.approvedAmountPaisa != null ? (c.approvedAmountPaisa / 100).toString() : '',
    cashless: c.cashless ?? true,
    status: c.status,
    settlementDate: c.settlementDate ?? '',
    rejectionReason: c.rejectionReason ?? '',
    notes: c.notes ?? '',
  };
}

function ClaimsSection({
  policyId,
  claims,
  cards,
  onChanged,
}: {
  policyId: number;
  claims: ClaimRow[];
  cards: CardRow[];
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ClaimFormState>(emptyClaimForm);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const startAdd = () => {
    setForm(emptyClaimForm);
    setEditingId(null);
    setAdding(true);
  };
  const startEdit = (c: ClaimRow) => {
    setForm(claimToForm(c));
    setEditingId(c.id);
    setAdding(true);
  };
  const cancel = () => {
    setAdding(false);
    setEditingId(null);
    setForm(emptyClaimForm);
  };

  const submit = async () => {
    if (!form.memberName.trim() || !form.claimDate || !form.claimAmountRupees) {
      toast.error('Member, claim date and amount are required');
      return;
    }
    setIsSubmitting(true);
    try {
      const body = {
        memberName: form.memberName.trim(),
        cardId: form.cardId ? Number(form.cardId) : null,
        claimDate: form.claimDate,
        hospital: form.hospital.trim() || null,
        diagnosis: form.diagnosis.trim() || null,
        claimAmountRupees: Number(form.claimAmountRupees) || 0,
        approvedAmountRupees: form.approvedAmountRupees
          ? Number(form.approvedAmountRupees)
          : null,
        cashless: form.cashless,
        status: form.status,
        settlementDate: form.settlementDate || null,
        rejectionReason: form.rejectionReason.trim() || null,
        notes: form.notes.trim() || null,
      };
      const url = editingId
        ? `/api/investments/health-insurance/claims/${editingId}`
        : `/api/investments/health-insurance/${policyId}/claims`;
      const r = await fetch(url, {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || 'Save failed');
      }
      toast.success(editingId ? 'Claim updated' : 'Claim recorded');
      cancel();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const remove = async (id: number) => {
    if (!confirm('Delete this claim?')) return;
    try {
      const r = await fetch(`/api/investments/health-insurance/claims/${id}`, {
        method: 'DELETE',
      });
      if (!r.ok) throw new Error('delete failed');
      toast.success('Claim removed');
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const columns: Column<ClaimRow>[] = [
    {
      key: 'claimDate',
      header: 'Date',
      render: (_v, c) => <span className="text-sm">{c.claimDate}</span>,
    },
    {
      key: 'memberName',
      header: 'Member',
      render: (_v, c) => (
        <div className="flex flex-col">
          <span className="font-semibold text-[var(--dxp-text)]">{c.memberName}</span>
          {c.hospital && (
            <span className="text-xs text-[var(--dxp-text-muted)]">{c.hospital}</span>
          )}
        </div>
      ),
    },
    {
      key: 'claimAmountPaisa',
      header: 'Claimed',
      render: (_v, c) => (
        <span className="font-mono text-[var(--dxp-text)]">{formatINR(c.claimAmountPaisa)}</span>
      ),
    },
    {
      key: 'approvedAmountPaisa',
      header: 'Approved',
      render: (_v, c) => (
        <span className="font-mono text-[var(--dxp-text-secondary)]">
          {c.approvedAmountPaisa != null ? formatINR(c.approvedAmountPaisa) : '—'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (_v, c) => <Badge variant="info">{c.status.replace('_', ' ')}</Badge>,
    },
    {
      key: 'id',
      header: '',
      render: (_v, c) => (
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              startEdit(c);
            }}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              remove(c.id);
            }}
          >
            <Trash2 className="h-4 w-4 text-rose-500" />
          </Button>
        </div>
      ),
    },
  ];

  const memberOptions: Array<{ label: string; value: string }> = [
    { label: '— No card linked —', value: '' },
    ...cards.map((c) => ({ label: `${c.memberName} (${c.relationship.toLowerCase()})`, value: c.id.toString() })),
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <FileText className="h-5 w-5 text-[var(--dxp-brand)]" />
            Claims ({claims.length})
          </h3>
          {!adding && (
            <Button variant="secondary" size="sm" onClick={startAdd}>
              <Plus className="mr-1 h-3 w-3" /> Record claim
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {adding && (
          <div className="mb-4 rounded-lg border border-[var(--dxp-border)] bg-[var(--dxp-surface-alt)] p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Linked card / member">
                <Select
                  value={form.cardId}
                  onChange={(v) => {
                    const card = cards.find((c) => c.id.toString() === v);
                    setForm((f) => ({
                      ...f,
                      cardId: v,
                      memberName: card ? card.memberName : f.memberName,
                    }));
                  }}
                  options={memberOptions}
                />
              </Field>
              <Field label="Member name">
                <Input
                  value={form.memberName}
                  onChange={(e) => setForm((f) => ({ ...f, memberName: e.target.value }))}
                />
              </Field>
              <Field label="Claim date">
                <Input
                  type="date"
                  value={form.claimDate}
                  onChange={(e) => setForm((f) => ({ ...f, claimDate: e.target.value }))}
                />
              </Field>
              <Field label="Hospital">
                <Input
                  value={form.hospital}
                  onChange={(e) => setForm((f) => ({ ...f, hospital: e.target.value }))}
                />
              </Field>
              <Field label="Diagnosis">
                <Input
                  value={form.diagnosis}
                  onChange={(e) => setForm((f) => ({ ...f, diagnosis: e.target.value }))}
                />
              </Field>
              <Field label="Status">
                <Select
                  value={form.status}
                  onChange={(v) => setForm((f) => ({ ...f, status: v as ClaimStatus }))}
                  options={CLAIM_STATUS_OPTIONS}
                />
              </Field>
              <Field label="Claim amount (₹)">
                <Input
                  type="number"
                  value={form.claimAmountRupees}
                  onChange={(e) => setForm((f) => ({ ...f, claimAmountRupees: e.target.value }))}
                />
              </Field>
              <Field label="Approved amount (₹)">
                <Input
                  type="number"
                  value={form.approvedAmountRupees}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, approvedAmountRupees: e.target.value }))
                  }
                />
              </Field>
              <Field label="Settlement date">
                <Input
                  type="date"
                  value={form.settlementDate}
                  onChange={(e) => setForm((f) => ({ ...f, settlementDate: e.target.value }))}
                />
              </Field>
              <div className="flex items-center pt-6">
                <label className="flex items-center gap-2 text-sm text-[var(--dxp-text)]">
                  <input
                    type="checkbox"
                    checked={form.cashless}
                    onChange={(e) => setForm((f) => ({ ...f, cashless: e.target.checked }))}
                    className="h-4 w-4 rounded border-[var(--dxp-border)]"
                  />
                  Cashless
                </label>
              </div>
              <div className="sm:col-span-2">
                <Field label="Rejection reason">
                  <Input
                    value={form.rejectionReason}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, rejectionReason: e.target.value }))
                    }
                  />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Notes">
                  <textarea
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    rows={2}
                    className="w-full rounded border border-[var(--dxp-border)] bg-[var(--dxp-surface)] p-2 text-sm text-[var(--dxp-text)] focus:border-[var(--dxp-brand)] focus:outline-none"
                  />
                </Field>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={cancel} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={submit} disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                {editingId ? 'Update claim' : 'Record claim'}
              </Button>
            </div>
          </div>
        )}

        {claims.length === 0 && !adding ? (
          <p className="py-4 text-center text-sm text-[var(--dxp-text-muted)]">
            No claims on file.
          </p>
        ) : (
          <DataTable<ClaimRow> columns={columns} data={claims} emptyMessage="No claims" />
        )}
      </CardContent>
    </Card>
  );
}

/* ─── portability section ─────────────────────────────────────────────── */

interface PortabilityFormState {
  previousInsurer: string;
  previousPolicyNumber: string;
  portedDate: string;
  portedSumInsuredRupees: string;
  waitingPeriodUsedMonths: string;
  ncbCarriedPercent: string;
  notes: string;
}

function portToForm(p: PortabilityRow | null): PortabilityFormState {
  return {
    previousInsurer: p?.previousInsurer ?? '',
    previousPolicyNumber: p?.previousPolicyNumber ?? '',
    portedDate: p?.portedDate ?? '',
    portedSumInsuredRupees:
      p?.portedSumInsuredPaisa != null ? (p.portedSumInsuredPaisa / 100).toString() : '',
    waitingPeriodUsedMonths: p?.waitingPeriodUsedMonths?.toString() ?? '0',
    ncbCarriedPercent: p?.ncbCarriedPercent?.toString() ?? '0',
    notes: p?.notes ?? '',
  };
}

function PortabilitySection({
  policyId,
  portability,
  onChanged,
}: {
  policyId: number;
  portability: PortabilityRow | null;
  onChanged: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<PortabilityFormState>(portToForm(portability));
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setForm(portToForm(portability));
  }, [portability]);

  const save = async () => {
    if (!form.previousInsurer.trim() || !form.portedDate) {
      toast.error('Previous insurer and ported date are required');
      return;
    }
    setIsSaving(true);
    try {
      const body = {
        previousInsurer: form.previousInsurer.trim(),
        previousPolicyNumber: form.previousPolicyNumber.trim() || null,
        portedDate: form.portedDate,
        portedSumInsuredRupees: form.portedSumInsuredRupees
          ? Number(form.portedSumInsuredRupees)
          : null,
        waitingPeriodUsedMonths: form.waitingPeriodUsedMonths
          ? Number(form.waitingPeriodUsedMonths)
          : 0,
        ncbCarriedPercent: form.ncbCarriedPercent ? Number(form.ncbCarriedPercent) : 0,
        notes: form.notes.trim() || null,
      };
      const r = await fetch(`/api/investments/health-insurance/${policyId}/portability`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || 'Save failed');
      }
      toast.success('Portability saved');
      setIsEditing(false);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <Repeat className="h-5 w-5 text-[var(--dxp-brand)]" />
            Portability
          </h3>
          {!isEditing && (
            <Button variant="secondary" size="sm" onClick={() => setIsEditing(true)}>
              <Pencil className="mr-1 h-3 w-3" />
              {portability ? 'Edit' : 'Add'}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {!isEditing ? (
          portability ? (
            <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
              {(
                [
                  ['Previous insurer', portability.previousInsurer],
                  ['Previous policy #', portability.previousPolicyNumber ?? '—'],
                  ['Ported on', portability.portedDate],
                  [
                    'Sum insured ported',
                    portability.portedSumInsuredPaisa != null
                      ? formatINR(portability.portedSumInsuredPaisa)
                      : '—',
                  ],
                  ['Waiting served', `${portability.waitingPeriodUsedMonths} months`],
                  ['NCB carried', `${portability.ncbCarriedPercent ?? 0}%`],
                ] as Array<[string, string]>
              ).map(([label, value]) => (
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
              {portability.notes && (
                <p className="text-sm text-[var(--dxp-text-secondary)] sm:col-span-2">
                  {portability.notes}
                </p>
              )}
            </dl>
          ) : (
            <p className="py-4 text-center text-sm text-[var(--dxp-text-muted)]">
              No portability record. Add one if this policy was ported from another insurer.
            </p>
          )
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Previous insurer">
                <Input
                  value={form.previousInsurer}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, previousInsurer: e.target.value }))
                  }
                />
              </Field>
              <Field label="Previous policy #">
                <Input
                  value={form.previousPolicyNumber}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, previousPolicyNumber: e.target.value }))
                  }
                />
              </Field>
              <Field label="Ported date">
                <Input
                  type="date"
                  value={form.portedDate}
                  onChange={(e) => setForm((f) => ({ ...f, portedDate: e.target.value }))}
                />
              </Field>
              <Field label="Sum insured ported (₹)">
                <Input
                  type="number"
                  value={form.portedSumInsuredRupees}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, portedSumInsuredRupees: e.target.value }))
                  }
                />
              </Field>
              <Field label="Waiting period served (months)">
                <Input
                  type="number"
                  value={form.waitingPeriodUsedMonths}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, waitingPeriodUsedMonths: e.target.value }))
                  }
                />
              </Field>
              <Field label="NCB carried (%)">
                <Input
                  type="number"
                  step="0.01"
                  value={form.ncbCarriedPercent}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, ncbCarriedPercent: e.target.value }))
                  }
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Notes">
                  <textarea
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    rows={2}
                    className="w-full rounded border border-[var(--dxp-border)] bg-[var(--dxp-surface)] p-2 text-sm text-[var(--dxp-text)] focus:border-[var(--dxp-brand)] focus:outline-none"
                  />
                </Field>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setForm(portToForm(portability));
                  setIsEditing(false);
                }}
                disabled={isSaving}
              >
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={save} disabled={isSaving}>
                {isSaving && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                Save
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
