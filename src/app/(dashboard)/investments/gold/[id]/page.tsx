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
import { ArrowLeft, Loader2, Coins, Trash2, Pencil, Save, X } from 'lucide-react';

type GoldType = 'GOLD_BOND' | 'ETF' | 'PHYSICAL' | 'DIGITAL';
type Purity = '999' | '995' | '916';

interface GoldHolding {
  id: number;
  type: GoldType;
  name: string | null;
  grams: number | null;
  purity: Purity | null;
  purchaseDate: string | null;
  purchasePricePerGram: number | null;
  currentRatePerGram: number | null;
  totalInvestment: number | null;
  currentValue: number | null;
  gainLoss: number | null;
  gainLossPercent: number | null;
  lastRateUpdate: string | null;
  etfSymbol: string | null;
  etfUnits: number | null;
  sgbSeries: string | null;
  sgbIssueDate: string | null;
  sgbMaturityDate: string | null;
  sgbInterestRate: number | null;
  notes: string | null;
}

const TYPE_OPTIONS: Array<{ label: string; value: GoldType }> = [
  { label: 'Sovereign Gold Bond', value: 'GOLD_BOND' },
  { label: 'ETF', value: 'ETF' },
  { label: 'Physical', value: 'PHYSICAL' },
  { label: 'Digital', value: 'DIGITAL' },
];

const PURITY_OPTIONS: Array<{ label: string; value: Purity }> = [
  { label: '24K (999)', value: '999' },
  { label: '99.5%', value: '995' },
  { label: '22K (916)', value: '916' },
];

const typeLabel: Record<GoldType, string> = {
  GOLD_BOND: 'SGB',
  ETF: 'ETF',
  PHYSICAL: 'Physical',
  DIGITAL: 'Digital',
};

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

interface FormState {
  name: string;
  grams: string;
  purity: Purity;
  purchasePricePerGramRupees: string;
  purchaseDate: string;
  sgbSeries: string;
  sgbIssueDate: string;
  sgbMaturityDate: string;
  sgbInterestRate: string;
  etfSymbol: string;
  etfUnits: string;
  notes: string;
}

function holdingToForm(h: GoldHolding): FormState {
  return {
    name: h.name ?? '',
    grams: h.grams?.toString() ?? '',
    purity: h.purity ?? '999',
    purchasePricePerGramRupees: h.purchasePricePerGram
      ? (h.purchasePricePerGram / 100).toString()
      : '',
    purchaseDate: h.purchaseDate ?? '',
    sgbSeries: h.sgbSeries ?? '',
    sgbIssueDate: h.sgbIssueDate ?? '',
    sgbMaturityDate: h.sgbMaturityDate ?? '',
    sgbInterestRate: h.sgbInterestRate?.toString() ?? '2.5',
    etfSymbol: h.etfSymbol ?? '',
    etfUnits: h.etfUnits?.toString() ?? '',
    notes: h.notes ?? '',
  };
}

interface GoldRate {
  ratePerGram24K: number;
  ratePerGram22K: number;
  asOfDate: string;
  source: string;
}

const purityFactor = (p: Purity | null): number =>
  p === '916' ? 0.916 : p === '995' ? 0.995 : 1;

export default function GoldDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [holding, setHolding] = useState<GoldHolding | null>(null);
  const [rate, setRate] = useState<GoldRate | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);

  const load = useCallback(async () => {
    try {
      const [goldRes, rateRes] = await Promise.all([
        fetch(`/api/investments/gold/${params.id}`).then((r) => r.json()),
        fetch('/api/investments/gold/current-rate').then((r) => r.json()),
      ]);
      if (goldRes.error) throw new Error(goldRes.error);
      setHolding(goldRes.gold);
      setForm(holdingToForm(goldRes.gold));
      setRate(rateRes);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load gold holding');
    } finally {
      setIsLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  const onDelete = async () => {
    if (!confirm('Delete this gold holding?')) return;
    setIsDeleting(true);
    try {
      const r = await fetch(`/api/investments/gold/${params.id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('delete failed');
      toast.success('Removed');
      router.push('/investments/gold');
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
        name: form.name,
        grams: form.grams ? Number(form.grams) : undefined,
        purity: form.purity,
        purchasePricePerGramRupees: form.purchasePricePerGramRupees
          ? Number(form.purchasePricePerGramRupees)
          : undefined,
        purchaseDate: form.purchaseDate || null,
        sgbSeries: form.sgbSeries || null,
        sgbIssueDate: form.sgbIssueDate || null,
        sgbMaturityDate: form.sgbMaturityDate || null,
        sgbInterestRate: form.sgbInterestRate ? Number(form.sgbInterestRate) : undefined,
        etfSymbol: form.etfSymbol || null,
        etfUnits: form.etfUnits ? Number(form.etfUnits) : undefined,
        notes: form.notes || null,
      };
      const r = await fetch(`/api/investments/gold/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || 'Save failed');
      setHolding(data.gold);
      setForm(holdingToForm(data.gold));
      setIsEditing(false);
      toast.success('Gold holding updated');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  };

  const cancelEdit = () => {
    if (holding) setForm(holdingToForm(holding));
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
  if (!holding || !form) return <p>Not found</p>;

  // Compute everything from live rate — single source of truth (same as gold list page)
  const grams = holding.grams ?? 0;
  const liveRate24K = rate?.ratePerGram24K ?? null;
  const liveRateForPurity = liveRate24K !== null ? liveRate24K * purityFactor(holding.purity) : null;
  const current = liveRateForPurity !== null
    ? Math.round(grams * liveRateForPurity * 100)  // paisa
    : (holding.currentValue ?? 0);
  const invested = holding.totalInvestment ?? 0;
  const gl = current - invested;
  const glPct = invested > 0 ? (gl / invested) * 100 : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Link
            href="/investments/gold"
            className="inline-flex items-center text-sm text-[var(--dxp-text-secondary)] hover:text-[var(--dxp-brand)]"
          >
            <ArrowLeft className="mr-1 h-4 w-4" /> Back to gold
          </Link>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
            {holding.name ?? 'Gold holding'}
          </h1>
          <p className="text-[var(--dxp-text-secondary)]">
            {typeLabel[holding.type]}
            {holding.sgbSeries ? ` · ${holding.sgbSeries}` : ''}
            {holding.etfSymbol ? ` · ${holding.etfSymbol}` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Badge variant={holding.type === 'GOLD_BOND' ? 'success' : holding.type === 'ETF' ? 'info' : 'warning'}>
            {typeLabel[holding.type]}
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
          { label: 'Current value', value: current / 100, format: 'currency' },
          { label: 'Invested', value: invested / 100, format: 'currency' },
          {
            label: 'P&L',
            value: gl / 100,
            format: 'currency',
            delta: { value: Math.round(glPct * 100) / 100, label: 'total return' },
          },
          {
            label: 'Grams',
            value: grams,
            format: 'number',
          },
        ]}
      />

      <Card>
        <CardHeader>
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <Coins className="h-5 w-5 text-amber-600" />
            Holding details
          </h3>
        </CardHeader>
        <CardContent>
          {!isEditing ? (
            <DetailView holding={holding} liveRatePerGram={liveRateForPurity} />
          ) : (
            <EditForm form={form} setField={setField} holdingType={holding.type} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* --- view mode ----------------------------------------------------------- */

function DetailView({ holding, liveRatePerGram }: { holding: GoldHolding; liveRatePerGram: number | null }) {
  const currentRate = liveRatePerGram !== null
    ? `₹${liveRatePerGram.toFixed(2)}/g`
    : holding.currentRatePerGram !== null
    ? `₹${(holding.currentRatePerGram / 100).toFixed(2)}/g`
    : '---';

  const fields: Array<[string, string]> = [
    ['Type', typeLabel[holding.type]],
    ['Purity', holding.purity ? `${holding.purity === '916' ? '22K' : holding.purity === '995' ? '99.5%' : '24K'} (${holding.purity})` : '---'],
    ['Grams', holding.grams !== null ? holding.grams.toFixed(3) : '---'],
    ['Purchase date', holding.purchaseDate ?? '---'],
    ['Buy rate', holding.purchasePricePerGram !== null ? `₹${(holding.purchasePricePerGram / 100).toFixed(2)}/g` : '---'],
    ['Current rate (live)', currentRate],
    ['Last rate update', holding.lastRateUpdate ?? '---'],
  ];

  if (holding.type === 'GOLD_BOND') {
    if (holding.sgbSeries) fields.push(['SGB series', holding.sgbSeries]);
    if (holding.sgbIssueDate) fields.push(['Issue date', holding.sgbIssueDate]);
    if (holding.sgbMaturityDate) fields.push(['Maturity date', holding.sgbMaturityDate]);
    if (holding.sgbInterestRate !== null) fields.push(['Interest rate', `${holding.sgbInterestRate}%`]);
  }
  if (holding.type === 'ETF') {
    if (holding.etfSymbol) fields.push(['ETF symbol', holding.etfSymbol]);
    if (holding.etfUnits !== null) fields.push(['Units', holding.etfUnits.toString()]);
  }

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
      {holding.notes && (
        <p className="mt-4 text-sm text-[var(--dxp-text-secondary)]">{holding.notes}</p>
      )}
    </>
  );
}

/* --- edit mode ----------------------------------------------------------- */

function EditForm({
  form,
  setField,
  holdingType,
}: {
  form: FormState;
  setField: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  holdingType: GoldType;
}) {
  const computedInvestment =
    form.grams && form.purchasePricePerGramRupees
      ? Number(form.grams) * Number(form.purchasePricePerGramRupees)
      : null;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="Name">
        <Input value={form.name} onChange={(e) => setField('name', e.target.value)} />
      </Field>

      <Field label="Purity">
        <Select
          value={form.purity}
          onChange={(v) => setField('purity', v as Purity)}
          options={PURITY_OPTIONS}
        />
      </Field>

      <Field label="Grams">
        <Input
          type="number"
          value={form.grams}
          onChange={(e) => setField('grams', e.target.value)}
          placeholder="e.g. 120"
        />
      </Field>

      <Field label="Buy price per gram (₹) — incl. GST & wastage">
        <Input
          type="number"
          value={form.purchasePricePerGramRupees}
          onChange={(e) => setField('purchasePricePerGramRupees', e.target.value)}
          placeholder="e.g. 12436.26"
        />
      </Field>

      {computedInvestment !== null && computedInvestment > 0 && (
        <div className="sm:col-span-2">
          <p className="text-xs text-[var(--dxp-text-muted)]">
            Computed invested: <span className="font-mono font-semibold text-[var(--dxp-text)]">
              {new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(computedInvestment)}
            </span>{' '}
            ({form.grams}g × ₹{Number(form.purchasePricePerGramRupees).toLocaleString('en-IN')}/g)
          </p>
        </div>
      )}

      <Field label="Purchase date">
        <Input
          type="date"
          value={form.purchaseDate}
          onChange={(e) => setField('purchaseDate', e.target.value)}
        />
      </Field>

      {holdingType === 'GOLD_BOND' && (
        <>
          <Field label="SGB series">
            <Input
              value={form.sgbSeries}
              onChange={(e) => setField('sgbSeries', e.target.value)}
              placeholder="e.g. 2024-25 Series IV"
            />
          </Field>
          <Field label="Issue date">
            <Input
              type="date"
              value={form.sgbIssueDate}
              onChange={(e) => setField('sgbIssueDate', e.target.value)}
            />
          </Field>
          <Field label="Maturity date">
            <Input
              type="date"
              value={form.sgbMaturityDate}
              onChange={(e) => setField('sgbMaturityDate', e.target.value)}
            />
          </Field>
          <Field label="Interest rate (%)">
            <Input
              type="number"
              value={form.sgbInterestRate}
              onChange={(e) => setField('sgbInterestRate', e.target.value)}
              placeholder="2.5"
            />
          </Field>
        </>
      )}

      {holdingType === 'ETF' && (
        <>
          <Field label="ETF symbol">
            <Input
              value={form.etfSymbol}
              onChange={(e) => setField('etfSymbol', e.target.value)}
              placeholder="e.g. GOLDBEES"
            />
          </Field>
          <Field label="ETF units">
            <Input
              type="number"
              value={form.etfUnits}
              onChange={(e) => setField('etfUnits', e.target.value)}
            />
          </Field>
        </>
      )}

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
