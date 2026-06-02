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
import { ArrowLeft, Loader2, PiggyBank, Trash2, Pencil, Save, X } from 'lucide-react';

type FundType = 'EQUITY' | 'DEBT' | 'HYBRID' | 'LIQUID' | 'GOLD';
type Category = 'EQUITY' | 'DEBT' | 'HYBRID' | 'UNKNOWN';

interface MutualFund {
  id: number;
  isin: string;
  schemeName: string;
  fundType: FundType;
  category: Category;
  folioNumber: string | null;
  units: number;
  nav: number; // paisa
  totalInvestment: number; // paisa
  currentValue: number; // paisa
  gainLoss: number; // paisa
  gainLossPercent: number;
  lastNavDate: string | null;
  investmentStartDate: string | null;
  notes: string | null;
}

const FUND_TYPE_OPTIONS: Array<{ label: string; value: FundType }> = [
  { label: 'Equity', value: 'EQUITY' },
  { label: 'Debt', value: 'DEBT' },
  { label: 'Hybrid', value: 'HYBRID' },
  { label: 'Liquid', value: 'LIQUID' },
  { label: 'Gold', value: 'GOLD' },
];

const CATEGORY_OPTIONS: Array<{ label: string; value: Category }> = [
  { label: 'Equity', value: 'EQUITY' },
  { label: 'Debt', value: 'DEBT' },
  { label: 'Hybrid', value: 'HYBRID' },
  { label: 'Unknown', value: 'UNKNOWN' },
];

const fundTypeVariant: Record<FundType, 'success' | 'info' | 'warning' | 'default' | 'danger'> = {
  EQUITY: 'success',
  DEBT: 'info',
  HYBRID: 'warning',
  LIQUID: 'default',
  GOLD: 'warning',
};

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

interface FormState {
  schemeName: string;
  amcName: string; // derived from schemeName prefix — not stored separately
  folioNumber: string;
  fundType: FundType;
  category: Category;
  units: string;
  averageNavRupees: string;
  totalInvestedRupees: string;
  investmentStartDate: string;
  notes: string;
}

function holdingToForm(h: MutualFund): FormState {
  return {
    schemeName: h.schemeName,
    amcName: '', // AMC not stored separately; user can edit scheme name
    folioNumber: h.folioNumber ?? '',
    fundType: h.fundType,
    category: h.category ?? 'UNKNOWN',
    units: h.units.toString(),
    averageNavRupees: (h.nav / 100).toString(),
    totalInvestedRupees: (h.totalInvestment / 100).toString(),
    investmentStartDate: h.investmentStartDate ?? '',
    notes: h.notes ?? '',
  };
}

export default function MutualFundDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [holding, setHolding] = useState<MutualFund | null>(null);
  const [liveNav, setLiveNav] = useState<number | null>(null); // rupees
  const [navDate, setNavDate] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  // Per-category MF growth rates fetched from /settings — used to show
  // the resolved rate in the inline-edit hint so the user can see the
  // immediate effect of changing the fund's category.
  const [mfRates, setMfRates] = useState<{
    MF_EQUITY: number;
    MF_DEBT: number;
    MF_HYBRID: number;
    MUTUAL_FUNDS: number;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/investments/mutual-funds/${params.id}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setHolding(data.mutualFund);
      setForm(holdingToForm(data.mutualFund));
      setLiveNav(data.currentNav ?? null); // rupees
      setNavDate(data.navDate ?? null);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load mutual fund');
    } finally {
      setIsLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  // Load MF rates once for the resolved-rate hint. Defaults (11/7/9/11)
  // are used if the fetch fails — keeps the hint usable offline.
  useEffect(() => {
    fetch('/api/settings/asset-class-returns')
      .then((r) => r.json())
      .then((d) => {
        const byClass = new Map<string, number>(
          (d.rates ?? []).map((r: { assetClass: string; returnPct: number }) => [r.assetClass, r.returnPct]),
        );
        setMfRates({
          MF_EQUITY: byClass.get('MF_EQUITY') ?? 11,
          MF_DEBT: byClass.get('MF_DEBT') ?? 7,
          MF_HYBRID: byClass.get('MF_HYBRID') ?? 9,
          MUTUAL_FUNDS: byClass.get('MUTUAL_FUNDS') ?? 11,
        });
      })
      .catch(() => {
        setMfRates({ MF_EQUITY: 11, MF_DEBT: 7, MF_HYBRID: 9, MUTUAL_FUNDS: 11 });
      });
  }, []);

  const resolvedRate = (category: Category): number => {
    if (!mfRates) return 11;
    switch (category) {
      case 'EQUITY':
        return mfRates.MF_EQUITY;
      case 'DEBT':
        return mfRates.MF_DEBT;
      case 'HYBRID':
        return mfRates.MF_HYBRID;
      case 'UNKNOWN':
      default:
        return mfRates.MF_EQUITY; // fallback consistent with getMfRate()
    }
  };

  const onDelete = async () => {
    if (!confirm('Delete this mutual fund holding?')) return;
    setIsDeleting(true);
    try {
      const r = await fetch(`/api/investments/mutual-funds/${params.id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('delete failed');
      toast.success('Removed');
      router.push('/investments/mutual-funds');
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
        schemeName: form.schemeName,
        fundType: form.fundType,
        category: form.category,
        folioNumber: form.folioNumber || null,
        units: form.units ? Number(form.units) : undefined,
        nav: form.averageNavRupees ? Number(form.averageNavRupees) : undefined, // API expects rupees, converts to paisa
        totalInvestment: form.totalInvestedRupees ? Number(form.totalInvestedRupees) : undefined,
        investmentStartDate: form.investmentStartDate || null,
        notes: form.notes || null,
      };
      const r = await fetch(`/api/investments/mutual-funds/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || 'Save failed');
      setHolding(data.mutualFund);
      setForm(holdingToForm(data.mutualFund));
      setIsEditing(false);
      toast.success('Mutual fund updated');
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

  // Compute current value from live NAV if available
  const liveNavPaisa = liveNav !== null ? Math.round(liveNav * 100) : null;
  const currentValue = liveNavPaisa !== null
    ? Math.round(holding.units * liveNavPaisa) // paisa
    : holding.currentValue;
  const invested = holding.totalInvestment;
  const gl = currentValue - invested;
  const glPct = invested > 0 ? (gl / invested) * 100 : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Link
            href="/investments/mutual-funds"
            className="inline-flex items-center text-sm text-[var(--dxp-text-secondary)] hover:text-[var(--dxp-brand)]"
          >
            <ArrowLeft className="mr-1 h-4 w-4" /> Back to mutual funds
          </Link>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
            {holding.schemeName}
          </h1>
          <p className="text-[var(--dxp-text-secondary)]">
            {holding.folioNumber ? `Folio: ${holding.folioNumber}` : 'No folio'}
            {holding.isin && holding.isin !== 'UNKNOWN' ? ` · ISIN: ${holding.isin}` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Badge variant={fundTypeVariant[holding.fundType]}>{holding.fundType}</Badge>
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
          { label: 'Current value', value: currentValue / 100, format: 'currency' },
          { label: 'Invested', value: invested / 100, format: 'currency' },
          {
            label: 'P&L',
            value: gl / 100,
            format: 'currency',
            delta: { value: Math.round(glPct * 100) / 100, label: 'total return' },
          },
          {
            label: 'Units',
            value: holding.units,
            format: 'number',
          },
        ]}
      />

      <Card>
        <CardHeader>
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <PiggyBank className="h-5 w-5 text-[var(--dxp-brand)]" />
            Holding details
          </h3>
        </CardHeader>
        <CardContent>
          {!isEditing ? (
            <DetailView
              holding={holding}
              liveNav={liveNav}
              navDate={navDate}
              resolvedRatePct={resolvedRate(holding.category ?? 'UNKNOWN')}
            />
          ) : (
            <EditForm
              form={form}
              setField={setField}
              resolvedRatePct={resolvedRate(form.category)}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* --- view mode ----------------------------------------------------------- */

function DetailView({
  holding,
  liveNav,
  navDate,
  resolvedRatePct,
}: {
  holding: MutualFund;
  liveNav: number | null;
  navDate: string | null;
  resolvedRatePct: number;
}) {
  const avgNavRupees = (holding.nav / 100).toFixed(2);
  const currentNavDisplay = liveNav !== null
    ? `₹${liveNav.toFixed(2)}`
    : `₹${(holding.nav / 100).toFixed(2)} (stored)`;

  const category = holding.category ?? 'UNKNOWN';
  const categoryLabel =
    category === 'UNKNOWN'
      ? 'Unknown (using fallback)'
      : `${category[0]}${category.slice(1).toLowerCase()} · ${resolvedRatePct}%/yr growth`;

  const fields: Array<[string, string]> = [
    ['Scheme name', holding.schemeName],
    ['Fund type', holding.fundType],
    ['Category (rate bucket)', categoryLabel],
    ['Folio number', holding.folioNumber ?? '---'],
    ['ISIN', holding.isin && holding.isin !== 'UNKNOWN' ? holding.isin : '---'],
    ['Units', holding.units.toFixed(3)],
    ['Avg NAV (purchase)', `₹${avgNavRupees}`],
    ['Current NAV (live)', currentNavDisplay],
    ['NAV date', navDate ?? holding.lastNavDate ?? '---'],
    ['Investment start', holding.investmentStartDate ?? '---'],
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
  resolvedRatePct,
}: {
  form: FormState;
  setField: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  resolvedRatePct: number;
}) {
  const computedInvestment =
    form.units && form.averageNavRupees
      ? Number(form.units) * Number(form.averageNavRupees)
      : null;

  const categoryHint =
    form.category === 'UNKNOWN'
      ? `Using fallback rate of ${resolvedRatePct}% per year (umbrella MF rate). Set a category to use the right MF subclass rate.`
      : `Using ${form.category[0]}${form.category.slice(1).toLowerCase()} growth rate of ${resolvedRatePct}% per year`;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="Scheme name">
        <Input value={form.schemeName} onChange={(e) => setField('schemeName', e.target.value)} />
      </Field>

      <Field label="Fund type">
        <Select
          value={form.fundType}
          onChange={(v) => setField('fundType', v as FundType)}
          options={FUND_TYPE_OPTIONS}
        />
      </Field>

      <div className="sm:col-span-2">
        <Field label="Category (rate bucket)">
          <Select
            value={form.category}
            onChange={(v) => setField('category', v as Category)}
            options={CATEGORY_OPTIONS}
          />
          <p className="mt-1 text-xs text-[var(--dxp-text-muted)]">{categoryHint}</p>
        </Field>
      </div>

      <Field label="Folio number">
        <Input
          value={form.folioNumber}
          onChange={(e) => setField('folioNumber', e.target.value)}
          placeholder="e.g. 12345678/90"
        />
      </Field>

      <Field label="Units">
        <Input
          type="number"
          value={form.units}
          onChange={(e) => setField('units', e.target.value)}
          placeholder="e.g. 150.234"
        />
      </Field>

      <Field label="Avg NAV (₹)">
        <Input
          type="number"
          value={form.averageNavRupees}
          onChange={(e) => setField('averageNavRupees', e.target.value)}
          placeholder="e.g. 45.32"
        />
      </Field>

      <Field label="Total invested (₹)">
        <Input
          type="number"
          value={form.totalInvestedRupees}
          onChange={(e) => setField('totalInvestedRupees', e.target.value)}
          placeholder="e.g. 50000"
        />
      </Field>

      {computedInvestment !== null && computedInvestment > 0 && (
        <div className="sm:col-span-2">
          <p className="text-xs text-[var(--dxp-text-muted)]">
            Computed invested (units x avg NAV):{' '}
            <span className="font-mono font-semibold text-[var(--dxp-text)]">
              {new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(computedInvestment)}
            </span>{' '}
            ({form.units} x ₹{Number(form.averageNavRupees).toLocaleString('en-IN')})
          </p>
        </div>
      )}

      <Field label="Investment start date">
        <Input
          type="date"
          value={form.investmentStartDate}
          onChange={(e) => setField('investmentStartDate', e.target.value)}
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
