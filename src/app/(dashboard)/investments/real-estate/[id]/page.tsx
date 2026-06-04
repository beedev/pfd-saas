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
import { ArrowLeft, Loader2, Home, Trash2, Pencil, Save, X, Plus, CalendarDays } from 'lucide-react';

type PropertyType = 'RESIDENTIAL' | 'COMMERCIAL' | 'LAND' | 'PLOT';
type PropertyStatus = 'OWNED' | 'MORTGAGED' | 'UNDER_CONSTRUCTION' | 'RENTED';
type RetirementTreatment = 'sell' | 'rental_only' | 'self_occupied';

interface Property {
  id: number;
  propertyName: string;
  type: PropertyType;
  status: string | null;
  address: string;
  city: string;
  state: string;
  pincode: string | null;
  area: number;
  builtUpArea: number | null;
  purchasePrice: number;
  purchaseDate: string;
  currentValuation: number;
  valuationDate: string | null;
  gainLoss: number;
  gainLossPercent: number;
  mortgageAmount: number | null;
  mortgageLender: string | null;
  monthlyRent: number | null;
  notes: string | null;
  // Sprint 5.1a — housing loan + 80EEA fields
  isSelfOccupied?: boolean;
  homeLoanInterestPaidPaisa?: number | null;
  homeLoanDisbursedDate?: string | null;
  isFirstHome?: boolean;
  stampValuePaisa?: number | null;
  carpetAreaSqft?: number | null;
  // Sprint 5.12 — retirement intent (strategic, independent of isSelfOccupied)
  retirementTreatment?: RetirementTreatment | null;
}

const TYPE_OPTIONS: Array<{ label: string; value: PropertyType }> = [
  { label: 'Residential', value: 'RESIDENTIAL' },
  { label: 'Commercial', value: 'COMMERCIAL' },
  { label: 'Land', value: 'LAND' },
  { label: 'Plot', value: 'PLOT' },
];

const STATUS_OPTIONS: Array<{ label: string; value: PropertyStatus }> = [
  { label: 'Owned', value: 'OWNED' },
  { label: 'Mortgaged', value: 'MORTGAGED' },
  { label: 'Under construction', value: 'UNDER_CONSTRUCTION' },
  { label: 'Rented', value: 'RENTED' },
];

const RETIREMENT_TREATMENT_OPTIONS: Array<{ label: string; value: RetirementTreatment }> = [
  { label: 'Sell at retirement', value: 'sell' },
  { label: 'Rental — keep forever', value: 'rental_only' },
  { label: 'Self-occupied — keep forever', value: 'self_occupied' },
];

const TREATMENT_LABEL: Record<RetirementTreatment, string> = {
  sell: 'Sell at retirement',
  rental_only: 'Rental — keep forever',
  self_occupied: 'Self-occupied — keep forever',
};

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

interface FormState {
  propertyName: string;
  type: PropertyType;
  status: PropertyStatus;
  address: string;
  city: string;
  state: string;
  pincode: string;
  purchasePriceRupees: string;
  currentValuationRupees: string;
  valuationDate: string;
  monthlyRentRupees: string;
  mortgageAmountRupees: string;
  mortgageLender: string;
  notes: string;
  // Sprint 5.1a — housing loan + 80EEA
  isSelfOccupied: boolean;
  homeLoanInterestPaidRupees: string;
  homeLoanDisbursedDate: string;
  isFirstHome: boolean;
  stampValueRupees: string;
  carpetAreaSqft: string;
  // Sprint 5.12 — retirement intent
  retirementTreatment: RetirementTreatment;
}

function propertyToForm(p: Property): FormState {
  return {
    propertyName: p.propertyName,
    type: p.type,
    status: (p.status as PropertyStatus) ?? 'OWNED',
    address: p.address,
    city: p.city,
    state: p.state,
    pincode: p.pincode ?? '',
    purchasePriceRupees: (p.purchasePrice / 100).toString(),
    currentValuationRupees: (p.currentValuation / 100).toString(),
    valuationDate: p.valuationDate ?? new Date().toISOString().slice(0, 10),
    monthlyRentRupees: ((p.monthlyRent ?? 0) / 100).toString(),
    mortgageAmountRupees: ((p.mortgageAmount ?? 0) / 100).toString(),
    mortgageLender: p.mortgageLender ?? '',
    notes: p.notes ?? '',
    isSelfOccupied: p.isSelfOccupied ?? false,
    homeLoanInterestPaidRupees: ((p.homeLoanInterestPaidPaisa ?? 0) / 100).toString(),
    homeLoanDisbursedDate: p.homeLoanDisbursedDate ?? '',
    isFirstHome: p.isFirstHome ?? false,
    stampValueRupees: p.stampValuePaisa != null ? (p.stampValuePaisa / 100).toString() : '',
    carpetAreaSqft: p.carpetAreaSqft != null ? p.carpetAreaSqft.toString() : '',
    retirementTreatment: (p.retirementTreatment ?? 'sell') as RetirementTreatment,
  };
}

export default function PropertyDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [property, setProperty] = useState<Property | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/investments/real-estate/${params.id}`).then((r) => r.json());
      if (r.error) throw new Error(r.error);
      setProperty(r.property);
      setForm(propertyToForm(r.property));
    } catch (e) {
      console.error(e);
      toast.error('Failed to load property');
    } finally {
      setIsLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  const onDelete = async () => {
    if (!confirm('Delete this property?')) return;
    setIsDeleting(true);
    try {
      const r = await fetch(`/api/investments/real-estate/${params.id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('delete failed');
      toast.success('Removed');
      router.push('/investments/real-estate');
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
        propertyName: form.propertyName,
        type: form.type,
        status: form.status,
        address: form.address,
        city: form.city,
        state: form.state,
        pincode: form.pincode || null,
        purchasePriceRupees: Number(form.purchasePriceRupees) || 0,
        currentValuationRupees: Number(form.currentValuationRupees) || 0,
        valuationDate: form.valuationDate || null,
        monthlyRentRupees: Number(form.monthlyRentRupees) || 0,
        mortgageAmountRupees: Number(form.mortgageAmountRupees) || 0,
        mortgageLender: form.mortgageLender || null,
        notes: form.notes || null,
        // Sprint 5.1a — housing loan + 80EEA fields
        isSelfOccupied: form.isSelfOccupied,
        homeLoanInterestPaidRupees: Number(form.homeLoanInterestPaidRupees) || 0,
        homeLoanDisbursedDate: form.homeLoanDisbursedDate || null,
        isFirstHome: form.isFirstHome,
        stampValueRupees: form.stampValueRupees === '' ? 0 : Number(form.stampValueRupees),
        carpetAreaSqft: form.carpetAreaSqft === '' ? 0 : Number(form.carpetAreaSqft),
        // Sprint 5.12 — retirement intent (validated server-side)
        retirementTreatment: form.retirementTreatment,
      };
      const r = await fetch(`/api/investments/real-estate/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || 'Save failed');
      setProperty(data.property);
      setForm(propertyToForm(data.property));
      setIsEditing(false);
      toast.success('Property updated');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  };

  const cancelEdit = () => {
    if (property) setForm(propertyToForm(property));
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
  if (!property || !form) return <p>Not found</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Link
            href="/investments/real-estate"
            className="inline-flex items-center text-sm text-[var(--dxp-text-secondary)] hover:text-[var(--dxp-brand)]"
          >
            <ArrowLeft className="mr-1 h-4 w-4" /> Back to properties
          </Link>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
            {property.propertyName}
          </h1>
          <p className="text-[var(--dxp-text-secondary)]">
            {property.address}, {property.city}, {property.state} {property.pincode || ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Badge variant="info">{property.type}</Badge>
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
          { label: 'Notional value', value: property.currentValuation / 100, format: 'currency' },
          { label: 'Purchase price', value: property.purchasePrice / 100, format: 'currency' },
          {
            label: 'Gain / Loss',
            value: property.gainLoss / 100,
            format: 'currency',
            delta: { value: property.gainLossPercent, label: 'total return' },
          },
          {
            label: 'Loan outstanding',
            value: (property.mortgageAmount ?? 0) / 100,
            format: 'currency',
          },
        ]}
      />

      <Card>
        <CardHeader>
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <Home className="h-5 w-5 text-[var(--dxp-brand)]" />
            Property information
          </h3>
        </CardHeader>
        <CardContent>
          {!isEditing ? (
            <DetailView property={property} />
          ) : (
            <EditForm form={form} setField={setField} />
          )}
        </CardContent>
      </Card>

      {/* Sprint 5.3 — historical rental track. Self-occupied properties
          earn no rent by definition (sec 24 NIL annual value), so we hide
          the section there instead of confusing users with an inert table. */}
      {!property.isSelfOccupied && (
        <RentalHistorySection propertyId={property.id} />
      )}
    </div>
  );
}

/* --- view mode ----------------------------------------------------------- */

function DetailView({ property }: { property: Property }) {
  const treatment = (property.retirementTreatment ?? 'sell') as RetirementTreatment;
  const fields: Array<[string, string]> = [
    ['Type', property.type],
    ['Status', property.status ?? 'OWNED'],
    ['Address', property.address],
    ['City', property.city],
    ['State', property.state],
    ['Pincode', property.pincode ?? '---'],
    ['Area', `${property.area} sqft`],
    ...(property.builtUpArea ? [['Built-up area', `${property.builtUpArea} sqft`] as [string, string]] : []),
    ['Purchased', property.purchaseDate],
    ...(property.valuationDate ? [['Last valued', property.valuationDate] as [string, string]] : []),
    ...(property.monthlyRent ? [['Monthly rent', formatINR(property.monthlyRent)] as [string, string]] : []),
    ...(property.mortgageLender ? [['Lender', property.mortgageLender] as [string, string]] : []),
    ['Retirement intent', TREATMENT_LABEL[treatment]],
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
      {property.notes && (
        <p className="mt-4 text-sm text-[var(--dxp-text-secondary)]">{property.notes}</p>
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
      <Field label="Property name">
        <Input
          value={form.propertyName}
          onChange={(e) => setField('propertyName', e.target.value)}
        />
      </Field>

      <Field label="Type">
        <Select
          value={form.type}
          onChange={(v) => setField('type', v as PropertyType)}
          options={TYPE_OPTIONS}
        />
      </Field>

      <Field label="Status">
        <Select
          value={form.status}
          onChange={(v) => setField('status', v as PropertyStatus)}
          options={STATUS_OPTIONS}
        />
      </Field>

      <Field label="Address">
        <Input value={form.address} onChange={(e) => setField('address', e.target.value)} />
      </Field>

      <Field label="City">
        <Input value={form.city} onChange={(e) => setField('city', e.target.value)} />
      </Field>

      <Field label="State">
        <Input value={form.state} onChange={(e) => setField('state', e.target.value)} />
      </Field>

      <Field label="Pincode">
        <Input value={form.pincode} onChange={(e) => setField('pincode', e.target.value)} />
      </Field>

      <Field label="Purchase price (₹)">
        <Input
          type="number"
          value={form.purchasePriceRupees}
          onChange={(e) => setField('purchasePriceRupees', e.target.value)}
        />
      </Field>

      <Field label="Current valuation (₹)">
        <Input
          type="number"
          value={form.currentValuationRupees}
          onChange={(e) => setField('currentValuationRupees', e.target.value)}
        />
      </Field>

      <Field label="Valuation date">
        <Input
          type="date"
          value={form.valuationDate}
          onChange={(e) => setField('valuationDate', e.target.value)}
        />
      </Field>

      <Field label="Monthly rent (₹)">
        <Input
          type="number"
          value={form.monthlyRentRupees}
          onChange={(e) => setField('monthlyRentRupees', e.target.value)}
          placeholder="0"
        />
      </Field>

      <Field label="Mortgage outstanding (₹)">
        <Input
          type="number"
          value={form.mortgageAmountRupees}
          onChange={(e) => setField('mortgageAmountRupees', e.target.value)}
          placeholder="0"
        />
      </Field>

      <Field label="Mortgage lender">
        <Input
          value={form.mortgageLender}
          onChange={(e) => setField('mortgageLender', e.target.value)}
        />
      </Field>

      {/* ─── Sprint 5.1a — Housing loan + 80EEA ─────────────────────── */}
      <div className="sm:col-span-2 mt-2 rounded border border-amber-200 bg-amber-50/30 p-3">
        <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-amber-900">
          Housing loan / Self-occupation (tax)
        </h4>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Self-occupied?">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isSelfOccupied}
                onChange={(e) => setField('isSelfOccupied', e.target.checked)}
                className="h-4 w-4"
              />
              <span>Yes — sec 24(b) capped at ₹2L (post-1999 loan) or ₹30k (pre-1999). Let-out = uncapped but ₹2L cross-head offset.</span>
            </label>
          </Field>
          <Field label="Home loan interest paid this FY (₹)">
            <Input
              type="number"
              value={form.homeLoanInterestPaidRupees}
              onChange={(e) => setField('homeLoanInterestPaidRupees', e.target.value)}
              placeholder="0"
            />
          </Field>
          <Field label="Loan disbursed date">
            <Input
              type="date"
              value={form.homeLoanDisbursedDate}
              onChange={(e) => setField('homeLoanDisbursedDate', e.target.value)}
            />
          </Field>
          <Field label="First home?">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isFirstHome}
                onChange={(e) => setField('isFirstHome', e.target.checked)}
                className="h-4 w-4"
              />
              <span>Yes — first residential property owned (gate for 80EEA).</span>
            </label>
          </Field>
          <Field label="Stamp duty value at purchase (₹)">
            <Input
              type="number"
              value={form.stampValueRupees}
              onChange={(e) => setField('stampValueRupees', e.target.value)}
              placeholder="e.g. 4500000 (must be ≤ ₹45L for 80EEA)"
            />
          </Field>
          <Field label="Carpet area (sqft)">
            <Input
              type="number"
              value={form.carpetAreaSqft}
              onChange={(e) => setField('carpetAreaSqft', e.target.value)}
              placeholder="≤ 968 sqft for 80EEA"
            />
          </Field>
        </div>
        <p className="mt-2 text-[10px] text-amber-800">
          80EEA additional ₹1.5L benefit needs ALL of: first home + stamp ≤ ₹45L + carpet ≤ 968 sqft + loan disbursed
          Apr-2019 to Mar-2022. OLD regime only — NEW regime disallows these deductions.
        </p>
      </div>

      {/* ─── Sprint 5.12 — Retirement intent (strategic, not tax) ───── */}
      <div className="sm:col-span-2">
        <Field label="Retirement intent">
          <Select
            value={form.retirementTreatment}
            onChange={(v) => setField('retirementTreatment', v as RetirementTreatment)}
            options={RETIREMENT_TREATMENT_OPTIONS}
          />
          <p className="mt-1 text-xs text-[var(--dxp-text-muted)]">
            Drives how this property feeds the retirement projection.
            &ldquo;Sell&rdquo; — appreciated value enters the corpus, rental
            stops at retirement. &ldquo;Rental&rdquo; — excluded from corpus,
            rental flows post-retirement. &ldquo;Self-occupied&rdquo; —
            excluded from corpus, no rental stream. Independent of the
            &ldquo;Self-occupied?&rdquo; tax flag above (which caps sec
            24(b) interest deduction).
          </p>
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

/* ─── Sprint 5.3 — Rental history (per FY × property) ─────────────────── */

interface RentalHistoryRow {
  id: number;
  realEstateId: number;
  propertyName?: string;
  fy: string;
  rentReceivedPaisa: number;
  monthsLet: number;
  notes: string | null;
}

interface RentalRowFormState {
  fy: string;
  rentReceivedRupees: string;
  monthsLet: string;
  notes: string;
}

/** Default suggested FY for the "+ Add FY" form. Uses the previous FY
 *  since users typically backfill (current FY is usually still in flight). */
function defaultPriorFy(): string {
  const d = new Date();
  const startYear = d.getMonth() + 1 >= 4 ? d.getFullYear() - 1 : d.getFullYear() - 2;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

function RentalHistorySection({ propertyId }: { propertyId: number }) {
  const [rows, setRows] = useState<RentalHistoryRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [draft, setDraft] = useState<RentalRowFormState>({
    fy: defaultPriorFy(),
    rentReceivedRupees: '',
    monthsLet: '12',
    notes: '',
  });

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const r = await fetch(`/api/finance/rental-history?propertyId=${propertyId}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || 'Failed to load rental history');
      setRows(j.rows ?? []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load rental history';
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    load();
  }, [load]);

  const resetDraft = () => {
    setDraft({
      fy: defaultPriorFy(),
      rentReceivedRupees: '',
      monthsLet: '12',
      notes: '',
    });
  };

  const startEdit = (row: RentalHistoryRow) => {
    setEditingId(row.id);
    setIsAdding(false);
    setDraft({
      fy: row.fy,
      rentReceivedRupees: (row.rentReceivedPaisa / 100).toString(),
      monthsLet: String(row.monthsLet),
      notes: row.notes ?? '',
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setIsAdding(false);
    resetDraft();
  };

  const onAddSave = async () => {
    if (!/^\d{4}-\d{2}$/.test(draft.fy)) {
      toast.error('FY must be YYYY-YY (e.g. 2024-25)');
      return;
    }
    const months = Number(draft.monthsLet);
    if (!Number.isInteger(months) || months < 1 || months > 12) {
      toast.error('Months let must be 1..12');
      return;
    }
    const rupees = Number(draft.rentReceivedRupees);
    if (!Number.isFinite(rupees) || rupees < 0) {
      toast.error('Rent received must be a non-negative number');
      return;
    }
    setIsSaving(true);
    try {
      const r = await fetch('/api/finance/rental-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          realEstateId: propertyId,
          fy: draft.fy,
          rentReceivedRupees: rupees,
          monthsLet: months,
          notes: draft.notes || null,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || 'Failed to add');
      toast.success('Rental year added');
      setIsAdding(false);
      resetDraft();
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to add';
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  };

  const onEditSave = async () => {
    if (editingId === null) return;
    const months = Number(draft.monthsLet);
    if (!Number.isInteger(months) || months < 1 || months > 12) {
      toast.error('Months let must be 1..12');
      return;
    }
    const rupees = Number(draft.rentReceivedRupees);
    if (!Number.isFinite(rupees) || rupees < 0) {
      toast.error('Rent received must be a non-negative number');
      return;
    }
    setIsSaving(true);
    try {
      const r = await fetch(`/api/finance/rental-history/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rentReceivedRupees: rupees,
          monthsLet: months,
          notes: draft.notes || null,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || 'Failed to update');
      toast.success('Rental year updated');
      cancelEdit();
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to update';
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  };

  const onDelete = async (row: RentalHistoryRow) => {
    if (!confirm(`Delete rental entry for FY ${row.fy}?`)) return;
    try {
      const r = await fetch(`/api/finance/rental-history/${row.id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('Delete failed');
      toast.success('Removed');
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Delete failed';
      toast.error(msg);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <CalendarDays className="h-5 w-5 text-[var(--dxp-brand)]" />
            Rental history
          </h3>
          {!isAdding && editingId === null && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setIsAdding(true);
                setEditingId(null);
                resetDraft();
              }}
            >
              <Plus className="mr-1 h-4 w-4" /> Add FY
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-[var(--dxp-text-muted)]">Loading rental history…</p>
        ) : (
          <>
            {rows.length === 0 && !isAdding && (
              <p className="text-sm text-[var(--dxp-text-muted)]">
                No rental history yet — add prior-year entries to populate the YoY
                breakdown on /income.
              </p>
            )}

            {(rows.length > 0 || isAdding) && (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-[var(--dxp-border-light)] text-xs uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                    <tr>
                      <th className="px-3 py-2 text-left">FY</th>
                      <th className="px-3 py-2 text-right">Rent received</th>
                      <th className="px-3 py-2 text-right">Months let</th>
                      <th className="px-3 py-2 text-left">Notes</th>
                      <th className="px-3 py-2 text-right w-32">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--dxp-border-light)]">
                    {rows.map((row) =>
                      editingId === row.id ? (
                        <tr key={row.id} className="bg-amber-50/40">
                          <td className="px-3 py-2">
                            <span className="font-medium text-[var(--dxp-text)]">{row.fy}</span>
                            <span className="ml-2 text-[10px] text-[var(--dxp-text-muted)]">(immutable)</span>
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              type="number"
                              value={draft.rentReceivedRupees}
                              onChange={(e) => setDraft((d) => ({ ...d, rentReceivedRupees: e.target.value }))}
                            />
                          </td>
                          <td className="px-3 py-2 w-24">
                            <Input
                              type="number"
                              value={draft.monthsLet}
                              onChange={(e) => setDraft((d) => ({ ...d, monthsLet: e.target.value }))}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              value={draft.notes}
                              onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                            />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex justify-end gap-1">
                              <Button variant="secondary" size="sm" onClick={cancelEdit} disabled={isSaving}>
                                <X className="h-3.5 w-3.5" />
                              </Button>
                              <Button variant="primary" size="sm" onClick={onEditSave} disabled={isSaving}>
                                {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        <tr key={row.id}>
                          <td className="px-3 py-2 font-medium text-[var(--dxp-text)]">{row.fy}</td>
                          <td className="px-3 py-2 text-right font-mono">{formatINR(row.rentReceivedPaisa)}</td>
                          <td className="px-3 py-2 text-right">{row.monthsLet}</td>
                          <td className="px-3 py-2 text-[var(--dxp-text-secondary)]">{row.notes || '—'}</td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex justify-end gap-1">
                              <Button variant="secondary" size="sm" onClick={() => startEdit(row)} disabled={isAdding || editingId !== null}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button variant="danger" size="sm" onClick={() => onDelete(row)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ),
                    )}

                    {isAdding && (
                      <tr className="bg-emerald-50/40">
                        <td className="px-3 py-2 w-32">
                          <Input
                            value={draft.fy}
                            onChange={(e) => setDraft((d) => ({ ...d, fy: e.target.value }))}
                            placeholder="2024-25"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            value={draft.rentReceivedRupees}
                            onChange={(e) => setDraft((d) => ({ ...d, rentReceivedRupees: e.target.value }))}
                            placeholder="240000"
                          />
                        </td>
                        <td className="px-3 py-2 w-24">
                          <Input
                            type="number"
                            value={draft.monthsLet}
                            onChange={(e) => setDraft((d) => ({ ...d, monthsLet: e.target.value }))}
                            placeholder="12"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            value={draft.notes}
                            onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                            placeholder="optional"
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="secondary" size="sm" onClick={cancelEdit} disabled={isSaving}>
                              <X className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="primary" size="sm" onClick={onAddSave} disabled={isSaving}>
                              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
