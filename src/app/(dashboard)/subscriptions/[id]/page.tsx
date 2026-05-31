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
import {
  ArrowLeft,
  Loader2,
  Repeat2,
  Trash2,
  Pencil,
  Save,
  X,
  Ban,
  ExternalLink,
} from 'lucide-react';

type Category =
  | 'STREAMING'
  | 'SOFTWARE'
  | 'CLOUD'
  | 'FITNESS'
  | 'NEWS'
  | 'GAMING'
  | 'AI'
  | 'EDUCATION'
  | 'PRODUCTIVITY'
  | 'OTHER';

type BillingFrequency = 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUAL' | 'ANNUAL' | 'LIFETIME';
type Status = 'ACTIVE' | 'PAUSED' | 'CANCELLED';

interface Subscription {
  id: number;
  name: string;
  provider: string;
  category: Category;
  planName: string | null;
  amountPaisa: number;
  billingFrequency: BillingFrequency;
  startDate: string;
  nextRenewalDate: string | null;
  paymentMethod: string | null;
  autoRenew: boolean;
  url: string | null;
  status: Status;
  cancellationDate: string | null;
  notes: string | null;
}

const CATEGORY_LABEL: Record<Category, string> = {
  STREAMING: 'Streaming',
  SOFTWARE: 'Software',
  CLOUD: 'Cloud',
  FITNESS: 'Fitness',
  NEWS: 'News',
  GAMING: 'Gaming',
  AI: 'AI',
  EDUCATION: 'Education',
  PRODUCTIVITY: 'Productivity',
  OTHER: 'Other',
};

const CATEGORY_OPTIONS = (Object.keys(CATEGORY_LABEL) as Category[]).map((c) => ({
  value: c,
  label: CATEGORY_LABEL[c],
}));

const FREQ_LABEL: Record<BillingFrequency, string> = {
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  SEMI_ANNUAL: 'Semi-annual',
  ANNUAL: 'Annual',
  LIFETIME: 'Lifetime',
};

const FREQ_OPTIONS = (Object.keys(FREQ_LABEL) as BillingFrequency[]).map((f) => ({
  value: f,
  label: FREQ_LABEL[f],
}));

const STATUS_OPTIONS: Array<{ value: Status; label: string }> = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'PAUSED', label: 'Paused' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

function monthlyDragPaisa(s: Subscription): number {
  if (s.status !== 'ACTIVE') return 0;
  switch (s.billingFrequency) {
    case 'MONTHLY':
      return s.amountPaisa;
    case 'QUARTERLY':
      return s.amountPaisa / 3;
    case 'SEMI_ANNUAL':
      return s.amountPaisa / 6;
    case 'ANNUAL':
      return s.amountPaisa / 12;
    case 'LIFETIME':
      return 0;
  }
}

interface FormState {
  name: string;
  provider: string;
  category: Category;
  planName: string;
  amountRupees: string;
  billingFrequency: BillingFrequency;
  startDate: string;
  nextRenewalDate: string;
  paymentMethod: string;
  autoRenew: boolean;
  url: string;
  status: Status;
  notes: string;
}

function toForm(s: Subscription): FormState {
  return {
    name: s.name,
    provider: s.provider,
    category: s.category,
    planName: s.planName ?? '',
    amountRupees: (s.amountPaisa / 100).toString(),
    billingFrequency: s.billingFrequency,
    startDate: s.startDate,
    nextRenewalDate: s.nextRenewalDate ?? '',
    paymentMethod: s.paymentMethod ?? '',
    autoRenew: s.autoRenew,
    url: s.url ?? '',
    status: s.status,
    notes: s.notes ?? '',
  };
}

export default function SubscriptionDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [item, setItem] = useState<Subscription | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/subscriptions/${params.id}`).then((r) => r.json());
      if (r.error) throw new Error(r.error);
      setItem(r.subscription);
      setForm(toForm(r.subscription));
    } catch (e) {
      console.error(e);
      toast.error('Failed to load subscription');
    } finally {
      setIsLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  const onCancelSubscription = async () => {
    if (!item) return;
    if (!confirm(`Cancel ${item.name}? Status will move to CANCELLED.`)) return;
    setIsCancelling(true);
    try {
      const r = await fetch(`/api/subscriptions/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'CANCELLED' }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || 'Cancel failed');
      setItem(data.subscription);
      setForm(toForm(data.subscription));
      toast.success('Subscription cancelled');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Cancel failed';
      toast.error(msg);
    } finally {
      setIsCancelling(false);
    }
  };

  const onDelete = async () => {
    if (!confirm('Delete this subscription permanently?')) return;
    setIsDeleting(true);
    try {
      const r = await fetch(`/api/subscriptions/${params.id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('delete failed');
      toast.success('Removed');
      router.push('/subscriptions');
    } catch (e) {
      console.error(e);
      toast.error('Failed to delete');
      setIsDeleting(false);
    }
  };

  const onSave = async () => {
    if (!form) return;
    if (form.billingFrequency !== 'LIFETIME' && !form.nextRenewalDate) {
      toast.error('Next renewal date is required for non-Lifetime plans');
      return;
    }
    setIsSaving(true);
    try {
      const body = {
        name: form.name,
        provider: form.provider,
        category: form.category,
        planName: form.planName || null,
        amountRupees: Number(form.amountRupees) || 0,
        billingFrequency: form.billingFrequency,
        startDate: form.startDate,
        nextRenewalDate:
          form.billingFrequency === 'LIFETIME' ? null : form.nextRenewalDate || null,
        paymentMethod: form.paymentMethod || null,
        autoRenew: form.autoRenew,
        url: form.url || null,
        status: form.status,
        notes: form.notes || null,
      };
      const r = await fetch(`/api/subscriptions/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || 'Save failed');
      setItem(data.subscription);
      setForm(toForm(data.subscription));
      setIsEditing(false);
      toast.success('Subscription updated');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  };

  const cancelEdit = () => {
    if (item) setForm(toForm(item));
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
  if (!item || !form) {
    return <p className="text-[var(--dxp-text-muted)]">Subscription not found.</p>;
  }

  const monthlyDrag = monthlyDragPaisa(item);
  const annualRunRate = monthlyDrag * 12;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Link
            href="/subscriptions"
            className="inline-flex items-center text-sm text-[var(--dxp-text-secondary)] hover:text-[var(--dxp-brand)]"
          >
            <ArrowLeft className="mr-1 h-4 w-4" /> Back to subscriptions
          </Link>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
            {item.name}
          </h1>
          <p className="text-[var(--dxp-text-secondary)]">
            {item.provider} · {CATEGORY_LABEL[item.category]}
            {item.planName ? ` · ${item.planName}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          {item.status === 'ACTIVE' && <Badge variant="success">Active</Badge>}
          {item.status === 'PAUSED' && <Badge variant="warning">Paused</Badge>}
          {item.status === 'CANCELLED' && <Badge variant="default">Cancelled</Badge>}
          {!isEditing ? (
            <>
              {item.status !== 'CANCELLED' && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onCancelSubscription}
                  disabled={isCancelling}
                >
                  {isCancelling ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Ban className="mr-2 h-4 w-4" />
                  )}
                  Cancel subscription
                </Button>
              )}
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
          { label: 'Amount per cycle', value: item.amountPaisa / 100, format: 'currency' },
          { label: 'Cycles per year', value: annualRunRate > 0 ? annualRunRate / item.amountPaisa : 0, format: 'number' },
          { label: 'Monthly drag', value: monthlyDrag / 100, format: 'currency' },
          { label: 'Annual run rate', value: annualRunRate / 100, format: 'currency' },
        ]}
      />

      <Card>
        <CardHeader>
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <Repeat2 className="h-5 w-5 text-[var(--dxp-brand)]" />
            Subscription details
          </h3>
        </CardHeader>
        <CardContent>
          {!isEditing ? (
            <DetailView item={item} />
          ) : (
            <EditForm form={form} setField={setField} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* --- view mode ----------------------------------------------------------- */

function DetailView({ item }: { item: Subscription }) {
  const fields: Array<[string, React.ReactNode]> = [
    ['Provider', item.provider],
    ['Category', CATEGORY_LABEL[item.category]],
    ['Plan', item.planName ?? '—'],
    ['Amount', formatINR(item.amountPaisa)],
    ['Billing frequency', FREQ_LABEL[item.billingFrequency]],
    ['Start date', item.startDate],
    ['Next renewal', item.nextRenewalDate ?? '—'],
    ['Payment method', item.paymentMethod ?? '—'],
    ['Auto-renew', item.autoRenew ? 'Yes' : 'No'],
    ['Status', item.status],
    [
      'Cancelled on',
      item.cancellationDate ?? (item.status === 'CANCELLED' ? '—' : 'Not cancelled'),
    ],
    [
      'URL',
      item.url ? (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[var(--dxp-brand)] hover:underline"
        >
          {item.url} <ExternalLink className="h-3 w-3" />
        </a>
      ) : (
        '—'
      ),
    ],
  ];
  return (
    <>
      <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
        {fields.map(([label, value]) => (
          <div
            key={label}
            className="flex justify-between gap-3 border-b border-[var(--dxp-border)] pb-2"
          >
            <dt className="text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
              {label}
            </dt>
            <dd className="text-right text-sm text-[var(--dxp-text)] break-all">{value}</dd>
          </div>
        ))}
      </dl>
      {item.notes && (
        <p className="mt-4 whitespace-pre-wrap text-sm text-[var(--dxp-text-secondary)]">
          {item.notes}
        </p>
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
  const isLifetime = form.billingFrequency === 'LIFETIME';
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="Name">
        <Input value={form.name} onChange={(e) => setField('name', e.target.value)} />
      </Field>

      <Field label="Provider">
        <Input value={form.provider} onChange={(e) => setField('provider', e.target.value)} />
      </Field>

      <Field label="Category">
        <Select
          value={form.category}
          onChange={(v) => setField('category', v as Category)}
          options={CATEGORY_OPTIONS}
        />
      </Field>

      <Field label="Plan name">
        <Input value={form.planName} onChange={(e) => setField('planName', e.target.value)} />
      </Field>

      <Field label="Amount (₹)">
        <Input
          type="number"
          step="0.01"
          value={form.amountRupees}
          onChange={(e) => setField('amountRupees', e.target.value)}
        />
      </Field>

      <Field label="Billing frequency">
        <Select
          value={form.billingFrequency}
          onChange={(v) => setField('billingFrequency', v as BillingFrequency)}
          options={FREQ_OPTIONS}
        />
      </Field>

      <Field label="Start date">
        <Input
          type="date"
          value={form.startDate}
          onChange={(e) => setField('startDate', e.target.value)}
        />
      </Field>

      <Field label="Next renewal date">
        <Input
          type="date"
          value={form.nextRenewalDate}
          onChange={(e) => setField('nextRenewalDate', e.target.value)}
          disabled={isLifetime}
        />
        {isLifetime && (
          <p className="mt-1 text-xs text-[var(--dxp-text-muted)]">
            Not needed for Lifetime plans.
          </p>
        )}
      </Field>

      <Field label="Payment method">
        <Input
          value={form.paymentMethod}
          onChange={(e) => setField('paymentMethod', e.target.value)}
        />
      </Field>

      <Field label="Status">
        <Select
          value={form.status}
          onChange={(v) => setField('status', v as Status)}
          options={STATUS_OPTIONS}
        />
        <p className="mt-1 text-xs text-[var(--dxp-text-muted)]">
          Switching to Cancelled stamps today’s date.
        </p>
      </Field>

      <Field label="URL">
        <Input type="url" value={form.url} onChange={(e) => setField('url', e.target.value)} />
      </Field>

      <div className="flex items-end">
        <label className="flex items-center gap-2 text-sm text-[var(--dxp-text)]">
          <input
            type="checkbox"
            checked={form.autoRenew}
            onChange={(e) => setField('autoRenew', e.target.checked)}
            className="h-4 w-4 rounded border-[var(--dxp-border)]"
          />
          Auto-renew on next billing date
        </label>
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
