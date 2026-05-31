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
  DataTable,
  type Column,
} from '@dxp/ui';
import {
  ArrowLeft,
  Loader2,
  Car,
  Trash2,
  Pencil,
  Save,
  X,
  Plus,
  ShieldAlert,
  FileCheck,
  Wrench,
  Wallet,
} from 'lucide-react';

/* ─── types ───────────────────────────────────────────────────────────── */

type VehicleFuelType = 'PETROL' | 'DIESEL' | 'CNG' | 'LPG' | 'ELECTRIC' | 'HYBRID';
type VehicleStatus = 'ACTIVE' | 'SOLD' | 'SCRAPPED' | 'TRANSFERRED';
type VehicleInsuranceType = 'COMPREHENSIVE' | 'THIRD_PARTY_ONLY' | 'OWN_DAMAGE_ONLY';
type VehicleInsuranceStatus = 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'CLAIMED';
type PremiumFrequency = 'ANNUAL' | 'SEMI_ANNUAL' | 'QUARTERLY' | 'MONTHLY';
type ServiceType =
  | 'REGULAR'
  | 'REPAIR'
  | 'ACCIDENT'
  | 'BREAKDOWN'
  | 'TYRE_CHANGE'
  | 'BATTERY'
  | 'OTHER';

type AddonKey =
  | 'ZERO_DEP'
  | 'ENGINE_PROTECT'
  | 'RSA'
  | 'RTI'
  | 'CONSUMABLES'
  | 'TYRE_PROTECT'
  | 'KEY_REPLACEMENT'
  | 'NCB_PROTECT';

interface Vehicle {
  id: number;
  registrationNumber: string;
  make: string;
  model: string;
  variant: string | null;
  year: number;
  fuelType: VehicleFuelType;
  transmission: string | null;
  color: string | null;
  bodyType: string | null;
  purchaseDate: string;
  purchasePricePaisa: number;
  currentIdvPaisa: number | null;
  odometerKm: number | null;
  status: VehicleStatus | null;
  soldDate: string | null;
  salePricePaisa: number | null;
  notes: string | null;
}

interface InsurancePolicy {
  id: number;
  vehicleId: number;
  insurer: string;
  policyNumber: string;
  insuranceType: VehicleInsuranceType;
  idvPaisa: number;
  premiumPaisa: number;
  ownDamagePremiumPaisa: number | null;
  thirdPartyPremiumPaisa: number | null;
  ncbPercent: number | null;
  addons: string | null;
  premiumFrequency: PremiumFrequency | null;
  startDate: string;
  renewalDate: string;
  status: VehicleInsuranceStatus | null;
  notes: string | null;
}

interface PucRow {
  id: number;
  vehicleId: number;
  certificateNumber: string;
  issuedDate: string;
  validUntil: string;
  issuingAuthority: string | null;
  costPaisa: number | null;
  notes: string | null;
}

interface ServiceRow {
  id: number;
  vehicleId: number;
  serviceDate: string;
  odometerKm: number | null;
  serviceType: ServiceType;
  garageName: string | null;
  costPaisa: number;
  description: string | null;
  nextServiceDueDate: string | null;
  nextServiceDueKm: number | null;
  notes: string | null;
}

/* ─── option sets ─────────────────────────────────────────────────────── */

const FUEL_OPTIONS: Array<{ value: VehicleFuelType; label: string }> = [
  { value: 'PETROL', label: 'Petrol' },
  { value: 'DIESEL', label: 'Diesel' },
  { value: 'CNG', label: 'CNG' },
  { value: 'LPG', label: 'LPG' },
  { value: 'ELECTRIC', label: 'Electric' },
  { value: 'HYBRID', label: 'Hybrid' },
];

const TRANSMISSION_OPTIONS = [
  { value: '', label: 'Not set' },
  { value: 'MANUAL', label: 'Manual' },
  { value: 'AUTOMATIC', label: 'Automatic' },
  { value: 'AMT', label: 'AMT' },
  { value: 'CVT', label: 'CVT' },
];

const BODY_TYPE_OPTIONS = [
  { value: '', label: 'Not set' },
  { value: 'HATCHBACK', label: 'Hatchback' },
  { value: 'SEDAN', label: 'Sedan' },
  { value: 'SUV', label: 'SUV' },
  { value: 'MUV', label: 'MUV' },
  { value: 'BIKE', label: 'Bike' },
  { value: 'SCOOTER', label: 'Scooter' },
  { value: 'OTHER', label: 'Other' },
];

const STATUS_OPTIONS: Array<{ value: VehicleStatus; label: string }> = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'SOLD', label: 'Sold' },
  { value: 'SCRAPPED', label: 'Scrapped' },
  { value: 'TRANSFERRED', label: 'Transferred' },
];

const INSURANCE_TYPE_OPTIONS: Array<{ value: VehicleInsuranceType; label: string }> = [
  { value: 'COMPREHENSIVE', label: 'Comprehensive' },
  { value: 'THIRD_PARTY_ONLY', label: 'Third-party only' },
  { value: 'OWN_DAMAGE_ONLY', label: 'Own damage only' },
];

const INSURANCE_STATUS_OPTIONS: Array<{ value: VehicleInsuranceStatus; label: string }> = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'CLAIMED', label: 'Claimed' },
];

const FREQUENCY_OPTIONS: Array<{ value: PremiumFrequency; label: string }> = [
  { value: 'ANNUAL', label: 'Annual' },
  { value: 'SEMI_ANNUAL', label: 'Semi-annual' },
  { value: 'QUARTERLY', label: 'Quarterly' },
  { value: 'MONTHLY', label: 'Monthly' },
];

const SERVICE_TYPE_OPTIONS: Array<{ value: ServiceType; label: string }> = [
  { value: 'REGULAR', label: 'Regular' },
  { value: 'REPAIR', label: 'Repair' },
  { value: 'ACCIDENT', label: 'Accident' },
  { value: 'BREAKDOWN', label: 'Breakdown' },
  { value: 'TYRE_CHANGE', label: 'Tyre change' },
  { value: 'BATTERY', label: 'Battery' },
  { value: 'OTHER', label: 'Other' },
];

const ADDON_OPTIONS: Array<{ key: AddonKey; label: string }> = [
  { key: 'ZERO_DEP', label: 'Zero dep' },
  { key: 'ENGINE_PROTECT', label: 'Engine protect' },
  { key: 'RSA', label: 'RSA' },
  { key: 'RTI', label: 'Return to invoice' },
  { key: 'CONSUMABLES', label: 'Consumables' },
  { key: 'TYRE_PROTECT', label: 'Tyre protect' },
  { key: 'KEY_REPLACEMENT', label: 'Key replacement' },
  { key: 'NCB_PROTECT', label: 'NCB protect' },
];

/* ─── helpers ─────────────────────────────────────────────────────────── */

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Math.round(paisa) / 100);

function daysUntil(date: string | null | undefined): number | null {
  if (!date) return null;
  const target = new Date(date);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function parseAddons(json: string | null): AddonKey[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) return parsed.filter((s): s is AddonKey => typeof s === 'string');
  } catch {
    /* ignore */
  }
  return [];
}

function indianFY(date: Date): { start: Date; end: Date } {
  const y = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return { start: new Date(y, 3, 1), end: new Date(y + 1, 2, 31, 23, 59, 59) };
}

function annualisePremium(paisa: number, freq: PremiumFrequency | null): number {
  switch ((freq || 'ANNUAL').toUpperCase()) {
    case 'MONTHLY':
      return paisa * 12;
    case 'QUARTERLY':
      return paisa * 4;
    case 'SEMI_ANNUAL':
      return paisa * 2;
    case 'ANNUAL':
    default:
      return paisa;
  }
}

/* ─── vehicle form state ──────────────────────────────────────────────── */

interface VehicleFormState {
  registrationNumber: string;
  make: string;
  model: string;
  variant: string;
  year: string;
  fuelType: VehicleFuelType;
  transmission: string;
  color: string;
  bodyType: string;
  purchaseDate: string;
  purchasePriceRupees: string;
  currentIdvRupees: string;
  odometerKm: string;
  status: VehicleStatus;
  soldDate: string;
  salePriceRupees: string;
  notes: string;
}

function vehicleToForm(v: Vehicle): VehicleFormState {
  return {
    registrationNumber: v.registrationNumber,
    make: v.make,
    model: v.model,
    variant: v.variant ?? '',
    year: v.year.toString(),
    fuelType: v.fuelType,
    transmission: v.transmission ?? '',
    color: v.color ?? '',
    bodyType: v.bodyType ?? '',
    purchaseDate: v.purchaseDate,
    purchasePriceRupees: (v.purchasePricePaisa / 100).toString(),
    currentIdvRupees: v.currentIdvPaisa != null ? (v.currentIdvPaisa / 100).toString() : '',
    odometerKm: v.odometerKm?.toString() ?? '0',
    status: v.status ?? 'ACTIVE',
    soldDate: v.soldDate ?? '',
    salePriceRupees: v.salePricePaisa != null ? (v.salePricePaisa / 100).toString() : '',
    notes: v.notes ?? '',
  };
}

/* ─── page ────────────────────────────────────────────────────────────── */

export default function VehicleDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const vehicleId = params.id;

  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [policies, setPolicies] = useState<InsurancePolicy[]>([]);
  const [pucs, setPucs] = useState<PucRow[]>([]);
  const [services, setServices] = useState<ServiceRow[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState<VehicleFormState | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/investments/vehicles/${vehicleId}`).then((r) => r.json());
      if (r.error) throw new Error(r.error);
      setVehicle(r.vehicle);
      setForm(vehicleToForm(r.vehicle));
      setPolicies(r.insurance || []);
      setPucs(r.puc || []);
      setServices(r.service || []);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load vehicle');
    } finally {
      setIsLoading(false);
    }
  }, [vehicleId]);

  useEffect(() => {
    load();
  }, [load]);

  const onDelete = async () => {
    if (
      !confirm(
        'Delete this vehicle along with all insurance, PUC and service records? This cannot be undone.'
      )
    )
      return;
    setIsDeleting(true);
    try {
      const r = await fetch(`/api/investments/vehicles/${vehicleId}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('delete failed');
      toast.success('Vehicle removed');
      router.push('/investments/vehicles');
    } catch (e) {
      console.error(e);
      toast.error('Failed to delete');
      setIsDeleting(false);
    }
  };

  const onSave = async () => {
    if (!form) return;
    if (!form.registrationNumber.trim() || !form.make.trim() || !form.model.trim()) {
      toast.error('Registration, make and model are required');
      return;
    }
    setIsSaving(true);
    try {
      const body = {
        registrationNumber: form.registrationNumber.trim().toUpperCase(),
        make: form.make.trim(),
        model: form.model.trim(),
        variant: form.variant.trim() || null,
        year: Number(form.year) || vehicle?.year,
        fuelType: form.fuelType,
        transmission: form.transmission || null,
        color: form.color.trim() || null,
        bodyType: form.bodyType || null,
        purchaseDate: form.purchaseDate,
        purchasePriceRupees: Number(form.purchasePriceRupees) || 0,
        currentIdvRupees: form.currentIdvRupees ? Number(form.currentIdvRupees) : null,
        odometerKm: form.odometerKm ? Number(form.odometerKm) : 0,
        status: form.status,
        soldDate: form.soldDate || null,
        salePriceRupees: form.salePriceRupees ? Number(form.salePriceRupees) : null,
        notes: form.notes || null,
      };
      const r = await fetch(`/api/investments/vehicles/${vehicleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || 'Save failed');
      setVehicle(data.vehicle);
      setForm(vehicleToForm(data.vehicle));
      setIsEditing(false);
      toast.success('Vehicle updated');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  };

  const cancelEdit = () => {
    if (vehicle) setForm(vehicleToForm(vehicle));
    setIsEditing(false);
  };

  const setField = <K extends keyof VehicleFormState>(key: K, value: VehicleFormState[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--dxp-text-muted)]" />
      </div>
    );
  }
  if (!vehicle || !form) return <p>Not found</p>;

  const activePolicy = policies.find((p) => (p.status ?? 'ACTIVE') === 'ACTIVE') ?? policies[0];
  const insuranceRenewalDays = daysUntil(activePolicy?.renewalDate);
  const latestPuc =
    pucs.length > 0
      ? [...pucs].sort((a, b) => b.validUntil.localeCompare(a.validUntil))[0]
      : null;
  const pucDays = daysUntil(latestPuc?.validUntil);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Link
            href="/investments/vehicles"
            className="inline-flex items-center text-sm text-[var(--dxp-text-secondary)] hover:text-[var(--dxp-brand)]"
          >
            <ArrowLeft className="mr-1 h-4 w-4" /> Back to vehicles
          </Link>
          <h1 className="mt-2 text-3xl font-bold tracking-tight font-mono text-[var(--dxp-text)]">
            {vehicle.registrationNumber}
          </h1>
          <p className="text-[var(--dxp-text-secondary)]">
            {vehicle.make} {vehicle.model}
            {vehicle.variant ? ` · ${vehicle.variant}` : ''} · {vehicle.year}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant={
              (vehicle.status ?? 'ACTIVE') === 'ACTIVE'
                ? 'success'
                : vehicle.status === 'SCRAPPED'
                  ? 'danger'
                  : 'default'
            }
          >
            {vehicle.status ?? 'ACTIVE'}
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
          {
            label: 'Current IDV',
            value: (vehicle.currentIdvPaisa ?? 0) / 100,
            format: 'currency',
          },
          {
            label: 'Active premium',
            value: activePolicy ? activePolicy.premiumPaisa / 100 : 0,
            format: 'currency',
          },
          {
            label: 'Renewal in',
            value: insuranceRenewalDays ?? 0,
            format: 'number',
          },
          {
            label: 'PUC valid for',
            value: pucDays ?? 0,
            format: 'number',
          },
        ]}
      />

      {/* ─── 1. Vehicle details ───────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <Car className="h-5 w-5 text-[var(--dxp-brand)]" />
            Vehicle details
          </h3>
        </CardHeader>
        <CardContent>
          {!isEditing ? (
            <VehicleDetailView vehicle={vehicle} />
          ) : (
            <VehicleEditForm form={form} setField={setField} />
          )}
        </CardContent>
      </Card>

      {/* ─── 2. Insurance ─────────────────────────────────────────────── */}
      <InsuranceSection
        vehicleId={vehicle.id}
        policies={policies}
        onChanged={load}
      />

      {/* ─── 3. PUC ───────────────────────────────────────────────────── */}
      <PucSection vehicleId={vehicle.id} pucs={pucs} onChanged={load} />

      {/* ─── 4. Service log ───────────────────────────────────────────── */}
      <ServiceSection vehicleId={vehicle.id} entries={services} onChanged={load} />

      {/* ─── 5. Cost of ownership ────────────────────────────────────── */}
      <CostOfOwnershipCard
        policies={policies}
        pucs={pucs}
        services={services}
        purchaseDate={vehicle.purchaseDate}
      />
    </div>
  );
}

/* ─── vehicle detail view / edit form ─────────────────────────────────── */

function VehicleDetailView({ vehicle }: { vehicle: Vehicle }) {
  const fields: Array<[string, string]> = [
    ['Make / Model', `${vehicle.make} ${vehicle.model}`],
    ['Variant', vehicle.variant ?? '—'],
    ['Year', vehicle.year.toString()],
    ['Fuel', vehicle.fuelType],
    ['Transmission', vehicle.transmission ?? '—'],
    ['Body type', vehicle.bodyType ?? '—'],
    ['Color', vehicle.color ?? '—'],
    ['Odometer', vehicle.odometerKm != null ? `${vehicle.odometerKm.toLocaleString('en-IN')} km` : '—'],
    ['Purchase date', vehicle.purchaseDate],
    ['Purchase price', formatINR(vehicle.purchasePricePaisa)],
    ['Current IDV', vehicle.currentIdvPaisa != null ? formatINR(vehicle.currentIdvPaisa) : '—'],
    ['Status', vehicle.status ?? 'ACTIVE'],
  ];
  if (vehicle.status === 'SOLD' || vehicle.status === 'TRANSFERRED') {
    fields.push(
      ['Sold / transferred on', vehicle.soldDate ?? '—'],
      ['Sale price', vehicle.salePricePaisa != null ? formatINR(vehicle.salePricePaisa) : '—']
    );
  }

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
      {vehicle.notes && (
        <p className="mt-4 text-sm text-[var(--dxp-text-secondary)] whitespace-pre-wrap">
          {vehicle.notes}
        </p>
      )}
    </>
  );
}

function VehicleEditForm({
  form,
  setField,
}: {
  form: VehicleFormState;
  setField: <K extends keyof VehicleFormState>(key: K, value: VehicleFormState[K]) => void;
}) {
  const isSoldOrTransferred = form.status === 'SOLD' || form.status === 'TRANSFERRED';
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="Registration">
        <Input
          value={form.registrationNumber}
          onChange={(e) => setField('registrationNumber', e.target.value.toUpperCase())}
          className="font-mono"
        />
      </Field>
      <Field label="Status">
        <Select
          value={form.status}
          onChange={(v) => setField('status', v as VehicleStatus)}
          options={STATUS_OPTIONS}
        />
      </Field>
      <Field label="Make">
        <Input value={form.make} onChange={(e) => setField('make', e.target.value)} />
      </Field>
      <Field label="Model">
        <Input value={form.model} onChange={(e) => setField('model', e.target.value)} />
      </Field>
      <Field label="Variant">
        <Input value={form.variant} onChange={(e) => setField('variant', e.target.value)} />
      </Field>
      <Field label="Year">
        <Input type="number" value={form.year} onChange={(e) => setField('year', e.target.value)} />
      </Field>
      <Field label="Fuel type">
        <Select
          value={form.fuelType}
          onChange={(v) => setField('fuelType', v as VehicleFuelType)}
          options={FUEL_OPTIONS}
        />
      </Field>
      <Field label="Transmission">
        <Select
          value={form.transmission}
          onChange={(v) => setField('transmission', v)}
          options={TRANSMISSION_OPTIONS}
        />
      </Field>
      <Field label="Body type">
        <Select
          value={form.bodyType}
          onChange={(v) => setField('bodyType', v)}
          options={BODY_TYPE_OPTIONS}
        />
      </Field>
      <Field label="Color">
        <Input value={form.color} onChange={(e) => setField('color', e.target.value)} />
      </Field>
      <Field label="Purchase date">
        <Input
          type="date"
          value={form.purchaseDate}
          onChange={(e) => setField('purchaseDate', e.target.value)}
        />
      </Field>
      <Field label="Purchase price (₹)">
        <Input
          type="number"
          step="0.01"
          value={form.purchasePriceRupees}
          onChange={(e) => setField('purchasePriceRupees', e.target.value)}
        />
      </Field>
      <Field label="Current IDV (₹)">
        <Input
          type="number"
          step="0.01"
          value={form.currentIdvRupees}
          onChange={(e) => setField('currentIdvRupees', e.target.value)}
        />
      </Field>
      <Field label="Odometer (km)">
        <Input
          type="number"
          value={form.odometerKm}
          onChange={(e) => setField('odometerKm', e.target.value)}
        />
      </Field>
      {isSoldOrTransferred && (
        <>
          <Field label="Sold / transferred date">
            <Input
              type="date"
              value={form.soldDate}
              onChange={(e) => setField('soldDate', e.target.value)}
            />
          </Field>
          <Field label="Sale price (₹)">
            <Input
              type="number"
              step="0.01"
              value={form.salePriceRupees}
              onChange={(e) => setField('salePriceRupees', e.target.value)}
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

/* ─── insurance section ───────────────────────────────────────────────── */

interface InsuranceFormState {
  insurer: string;
  policyNumber: string;
  insuranceType: VehicleInsuranceType;
  idvRupees: string;
  premiumRupees: string;
  ownDamagePremiumRupees: string;
  thirdPartyPremiumRupees: string;
  ncbPercent: string;
  addons: AddonKey[];
  premiumFrequency: PremiumFrequency;
  startDate: string;
  renewalDate: string;
  status: VehicleInsuranceStatus;
  notes: string;
}

const emptyInsuranceForm: InsuranceFormState = {
  insurer: '',
  policyNumber: '',
  insuranceType: 'COMPREHENSIVE',
  idvRupees: '',
  premiumRupees: '',
  ownDamagePremiumRupees: '',
  thirdPartyPremiumRupees: '',
  ncbPercent: '0',
  addons: [],
  premiumFrequency: 'ANNUAL',
  startDate: '',
  renewalDate: '',
  status: 'ACTIVE',
  notes: '',
};

function policyToForm(p: InsurancePolicy): InsuranceFormState {
  return {
    insurer: p.insurer,
    policyNumber: p.policyNumber,
    insuranceType: p.insuranceType,
    idvRupees: (p.idvPaisa / 100).toString(),
    premiumRupees: (p.premiumPaisa / 100).toString(),
    ownDamagePremiumRupees:
      p.ownDamagePremiumPaisa != null ? (p.ownDamagePremiumPaisa / 100).toString() : '',
    thirdPartyPremiumRupees:
      p.thirdPartyPremiumPaisa != null ? (p.thirdPartyPremiumPaisa / 100).toString() : '',
    ncbPercent: p.ncbPercent?.toString() ?? '0',
    addons: parseAddons(p.addons),
    premiumFrequency: p.premiumFrequency ?? 'ANNUAL',
    startDate: p.startDate,
    renewalDate: p.renewalDate,
    status: p.status ?? 'ACTIVE',
    notes: p.notes ?? '',
  };
}

function InsuranceSection({
  vehicleId,
  policies,
  onChanged,
}: {
  vehicleId: number;
  policies: InsurancePolicy[];
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<InsuranceFormState>(emptyInsuranceForm);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const startAdd = () => {
    setForm(emptyInsuranceForm);
    setEditingId(null);
    setAdding(true);
  };
  const startEdit = (p: InsurancePolicy) => {
    setForm(policyToForm(p));
    setEditingId(p.id);
    setAdding(true);
  };
  const cancel = () => {
    setAdding(false);
    setEditingId(null);
    setForm(emptyInsuranceForm);
  };

  const toggleAddon = (key: AddonKey) =>
    setForm((f) => ({
      ...f,
      addons: f.addons.includes(key) ? f.addons.filter((k) => k !== key) : [...f.addons, key],
    }));

  const submit = async () => {
    if (
      !form.insurer.trim() ||
      !form.policyNumber.trim() ||
      !form.startDate ||
      !form.renewalDate ||
      !form.idvRupees ||
      !form.premiumRupees
    ) {
      toast.error('Insurer, policy #, IDV, premium, start and renewal dates are required');
      return;
    }
    setIsSubmitting(true);
    try {
      const body = {
        insurer: form.insurer.trim(),
        policyNumber: form.policyNumber.trim(),
        insuranceType: form.insuranceType,
        idvRupees: Number(form.idvRupees) || 0,
        premiumRupees: Number(form.premiumRupees) || 0,
        ownDamagePremiumRupees: form.ownDamagePremiumRupees
          ? Number(form.ownDamagePremiumRupees)
          : null,
        thirdPartyPremiumRupees: form.thirdPartyPremiumRupees
          ? Number(form.thirdPartyPremiumRupees)
          : null,
        ncbPercent: form.ncbPercent ? Number(form.ncbPercent) : 0,
        addons: form.addons.length ? JSON.stringify(form.addons) : null,
        premiumFrequency: form.premiumFrequency,
        startDate: form.startDate,
        renewalDate: form.renewalDate,
        status: form.status,
        notes: form.notes.trim() || null,
      };
      const url = editingId
        ? `/api/investments/vehicles/insurance/${editingId}`
        : `/api/investments/vehicles/${vehicleId}/insurance`;
      const r = await fetch(url, {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || 'Save failed');
      }
      toast.success(editingId ? 'Policy updated' : 'Policy added');
      cancel();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const remove = async (id: number) => {
    if (!confirm('Delete this insurance policy?')) return;
    try {
      const r = await fetch(`/api/investments/vehicles/insurance/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('delete failed');
      toast.success('Policy removed');
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const columns: Column<InsurancePolicy>[] = [
    {
      key: 'insurer',
      header: 'Insurer / policy #',
      render: (_v, p) => {
        const isActive = (p.status ?? 'ACTIVE') === 'ACTIVE';
        return (
          <div className="flex flex-col">
            <span
              className={`font-semibold ${
                isActive ? 'text-[var(--dxp-brand)]' : 'text-[var(--dxp-text)]'
              }`}
            >
              {p.insurer}
            </span>
            <span className="font-mono text-xs text-[var(--dxp-text-muted)]">
              {p.policyNumber}
            </span>
          </div>
        );
      },
    },
    {
      key: 'insuranceType',
      header: 'Type',
      render: (_v, p) => (
        <Badge variant={p.insuranceType === 'COMPREHENSIVE' ? 'brand' : 'info'}>
          {p.insuranceType.replace('_', ' ')}
        </Badge>
      ),
    },
    {
      key: 'idvPaisa',
      header: 'IDV',
      render: (_v, p) => (
        <span className="font-mono text-[var(--dxp-text)]">{formatINR(p.idvPaisa)}</span>
      ),
    },
    {
      key: 'premiumPaisa',
      header: 'Premium',
      render: (_v, p) => (
        <span className="font-mono text-[var(--dxp-text-secondary)]">
          {formatINR(p.premiumPaisa)}
        </span>
      ),
    },
    {
      key: 'renewalDate',
      header: 'Renewal',
      render: (_v, p) => {
        const days = daysUntil(p.renewalDate);
        const tone =
          days === null
            ? 'text-[var(--dxp-text-secondary)]'
            : days < 0
              ? 'text-rose-600'
              : days <= 30
                ? 'text-amber-600'
                : 'text-[var(--dxp-text-secondary)]';
        return (
          <div className="flex flex-col">
            <span className={`text-sm ${tone}`}>{p.renewalDate}</span>
            {days !== null && (
              <span className={`text-xs ${tone}`}>
                {days < 0 ? `${Math.abs(days)}d overdue` : `in ${days}d`}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (_v, p) => {
        const s = p.status ?? 'ACTIVE';
        const variant: 'success' | 'warning' | 'danger' | 'default' =
          s === 'ACTIVE' ? 'success' : s === 'EXPIRED' ? 'warning' : s === 'CANCELLED' ? 'danger' : 'default';
        return <Badge variant={variant}>{s}</Badge>;
      },
    },
    {
      key: 'id',
      header: '',
      render: (_v, p) => (
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              startEdit(p);
            }}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              remove(p.id);
            }}
          >
            <Trash2 className="h-4 w-4 text-rose-500" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <ShieldAlert className="h-5 w-5 text-[var(--dxp-brand)]" />
            Insurance ({policies.length})
          </h3>
          {!adding && (
            <Button variant="secondary" size="sm" onClick={startAdd}>
              <Plus className="mr-1 h-3 w-3" /> Add insurance policy
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {adding && (
          <div className="mb-4 rounded-lg border border-[var(--dxp-border)] bg-[var(--dxp-surface-alt)] p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Insurer">
                <Input
                  value={form.insurer}
                  onChange={(e) => setForm((f) => ({ ...f, insurer: e.target.value }))}
                  placeholder="e.g. HDFC Ergo"
                />
              </Field>
              <Field label="Policy number">
                <Input
                  value={form.policyNumber}
                  onChange={(e) => setForm((f) => ({ ...f, policyNumber: e.target.value }))}
                />
              </Field>
              <Field label="Type">
                <Select
                  value={form.insuranceType}
                  onChange={(v) =>
                    setForm((f) => ({ ...f, insuranceType: v as VehicleInsuranceType }))
                  }
                  options={INSURANCE_TYPE_OPTIONS}
                />
              </Field>
              <Field label="Status">
                <Select
                  value={form.status}
                  onChange={(v) =>
                    setForm((f) => ({ ...f, status: v as VehicleInsuranceStatus }))
                  }
                  options={INSURANCE_STATUS_OPTIONS}
                />
              </Field>
              <Field label="IDV (₹)">
                <Input
                  type="number"
                  value={form.idvRupees}
                  onChange={(e) => setForm((f) => ({ ...f, idvRupees: e.target.value }))}
                />
              </Field>
              <Field label="Premium (₹)">
                <Input
                  type="number"
                  value={form.premiumRupees}
                  onChange={(e) => setForm((f) => ({ ...f, premiumRupees: e.target.value }))}
                />
              </Field>
              <Field label="Own damage premium (₹)">
                <Input
                  type="number"
                  value={form.ownDamagePremiumRupees}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, ownDamagePremiumRupees: e.target.value }))
                  }
                />
              </Field>
              <Field label="Third-party premium (₹)">
                <Input
                  type="number"
                  value={form.thirdPartyPremiumRupees}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, thirdPartyPremiumRupees: e.target.value }))
                  }
                />
              </Field>
              <Field label="NCB (%)">
                <Input
                  type="number"
                  step="0.01"
                  value={form.ncbPercent}
                  onChange={(e) => setForm((f) => ({ ...f, ncbPercent: e.target.value }))}
                />
              </Field>
              <Field label="Premium frequency">
                <Select
                  value={form.premiumFrequency}
                  onChange={(v) =>
                    setForm((f) => ({ ...f, premiumFrequency: v as PremiumFrequency }))
                  }
                  options={FREQUENCY_OPTIONS}
                />
              </Field>
              <Field label="Start date">
                <Input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                />
              </Field>
              <Field label="Renewal date">
                <Input
                  type="date"
                  value={form.renewalDate}
                  onChange={(e) => setForm((f) => ({ ...f, renewalDate: e.target.value }))}
                />
              </Field>
            </div>

            <div className="mt-4">
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                Add-ons
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {ADDON_OPTIONS.map((a) => (
                  <label
                    key={a.key}
                    className="flex items-center gap-2 text-sm text-[var(--dxp-text)]"
                  >
                    <input
                      type="checkbox"
                      checked={form.addons.includes(a.key)}
                      onChange={() => toggleAddon(a.key)}
                      className="h-4 w-4 rounded border-[var(--dxp-border)]"
                    />
                    {a.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="mt-4">
              <Field label="Notes">
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  className="w-full rounded border border-[var(--dxp-border)] bg-[var(--dxp-surface)] p-2 text-sm text-[var(--dxp-text)] focus:border-[var(--dxp-brand)] focus:outline-none"
                />
              </Field>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={cancel} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={submit} disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                {editingId ? 'Update policy' : 'Add policy'}
              </Button>
            </div>
          </div>
        )}

        {policies.length === 0 && !adding ? (
          <p className="py-4 text-center text-sm text-[var(--dxp-text-muted)]">
            No insurance recorded. Add the current term to track renewal and premium.
          </p>
        ) : (
          <DataTable<InsurancePolicy>
            columns={columns}
            data={policies}
            emptyMessage="No policies"
          />
        )}
      </CardContent>
    </Card>
  );
}

/* ─── PUC section ─────────────────────────────────────────────────────── */

interface PucFormState {
  certificateNumber: string;
  issuedDate: string;
  validUntil: string;
  issuingAuthority: string;
  costRupees: string;
  notes: string;
}

const emptyPucForm: PucFormState = {
  certificateNumber: '',
  issuedDate: '',
  validUntil: '',
  issuingAuthority: '',
  costRupees: '',
  notes: '',
};

function pucToForm(p: PucRow): PucFormState {
  return {
    certificateNumber: p.certificateNumber,
    issuedDate: p.issuedDate,
    validUntil: p.validUntil,
    issuingAuthority: p.issuingAuthority ?? '',
    costRupees: p.costPaisa != null ? (p.costPaisa / 100).toString() : '',
    notes: p.notes ?? '',
  };
}

function PucSection({
  vehicleId,
  pucs,
  onChanged,
}: {
  vehicleId: number;
  pucs: PucRow[];
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<PucFormState>(emptyPucForm);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const startAdd = () => {
    setForm(emptyPucForm);
    setEditingId(null);
    setAdding(true);
  };
  const startEdit = (p: PucRow) => {
    setForm(pucToForm(p));
    setEditingId(p.id);
    setAdding(true);
  };
  const cancel = () => {
    setAdding(false);
    setEditingId(null);
    setForm(emptyPucForm);
  };

  const submit = async () => {
    if (!form.certificateNumber.trim() || !form.issuedDate || !form.validUntil) {
      toast.error('Certificate #, issued date and valid-until are required');
      return;
    }
    setIsSubmitting(true);
    try {
      const body = {
        certificateNumber: form.certificateNumber.trim(),
        issuedDate: form.issuedDate,
        validUntil: form.validUntil,
        issuingAuthority: form.issuingAuthority.trim() || null,
        costRupees: form.costRupees ? Number(form.costRupees) : 0,
        notes: form.notes.trim() || null,
      };
      const url = editingId
        ? `/api/investments/vehicles/puc/${editingId}`
        : `/api/investments/vehicles/${vehicleId}/puc`;
      const r = await fetch(url, {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || 'Save failed');
      }
      toast.success(editingId ? 'PUC updated' : 'PUC added');
      cancel();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const remove = async (id: number) => {
    if (!confirm('Delete this PUC certificate?')) return;
    try {
      const r = await fetch(`/api/investments/vehicles/puc/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('delete failed');
      toast.success('PUC removed');
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const columns: Column<PucRow>[] = [
    {
      key: 'certificateNumber',
      header: 'Certificate #',
      render: (_v, p) => (
        <span className="font-mono text-sm text-[var(--dxp-text)]">{p.certificateNumber}</span>
      ),
    },
    {
      key: 'issuedDate',
      header: 'Issued',
      render: (_v, p) => <span className="text-sm">{p.issuedDate}</span>,
    },
    {
      key: 'validUntil',
      header: 'Valid until',
      render: (_v, p) => {
        const days = daysUntil(p.validUntil);
        const variant: 'success' | 'warning' | 'danger' | 'default' =
          days === null
            ? 'default'
            : days < 0
              ? 'danger'
              : days <= 30
                ? 'warning'
                : 'success';
        const label =
          days === null ? p.validUntil : days < 0 ? 'Expired' : days <= 30 ? `${days}d left` : 'Valid';
        return (
          <div className="flex items-center gap-2">
            <span className="text-sm">{p.validUntil}</span>
            <Badge variant={variant} className="text-xs">
              {label}
            </Badge>
          </div>
        );
      },
    },
    {
      key: 'issuingAuthority',
      header: 'Authority',
      render: (_v, p) => (
        <span className="text-sm text-[var(--dxp-text-secondary)]">
          {p.issuingAuthority ?? '—'}
        </span>
      ),
    },
    {
      key: 'costPaisa',
      header: 'Cost',
      render: (_v, p) => (
        <span className="font-mono text-sm text-[var(--dxp-text-secondary)]">
          {p.costPaisa ? formatINR(p.costPaisa) : '—'}
        </span>
      ),
    },
    {
      key: 'id',
      header: '',
      render: (_v, p) => (
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              startEdit(p);
            }}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              remove(p.id);
            }}
          >
            <Trash2 className="h-4 w-4 text-rose-500" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <FileCheck className="h-5 w-5 text-[var(--dxp-brand)]" />
            PUC certificates ({pucs.length})
          </h3>
          {!adding && (
            <Button variant="secondary" size="sm" onClick={startAdd}>
              <Plus className="mr-1 h-3 w-3" /> Add PUC
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {adding && (
          <div className="mb-4 rounded-lg border border-[var(--dxp-border)] bg-[var(--dxp-surface-alt)] p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Certificate #">
                <Input
                  value={form.certificateNumber}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, certificateNumber: e.target.value }))
                  }
                />
              </Field>
              <Field label="Issuing authority">
                <Input
                  value={form.issuingAuthority}
                  onChange={(e) => setForm((f) => ({ ...f, issuingAuthority: e.target.value }))}
                  placeholder="e.g. RTO PUC Centre"
                />
              </Field>
              <Field label="Issued date">
                <Input
                  type="date"
                  value={form.issuedDate}
                  onChange={(e) => setForm((f) => ({ ...f, issuedDate: e.target.value }))}
                />
              </Field>
              <Field label="Valid until">
                <Input
                  type="date"
                  value={form.validUntil}
                  onChange={(e) => setForm((f) => ({ ...f, validUntil: e.target.value }))}
                />
              </Field>
              <Field label="Cost (₹)">
                <Input
                  type="number"
                  value={form.costRupees}
                  onChange={(e) => setForm((f) => ({ ...f, costRupees: e.target.value }))}
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
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={cancel} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={submit} disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                {editingId ? 'Update PUC' : 'Add PUC'}
              </Button>
            </div>
          </div>
        )}
        {pucs.length === 0 && !adding ? (
          <p className="py-4 text-center text-sm text-[var(--dxp-text-muted)]">
            No PUC certificates on file. Indian law requires a valid certificate at all times.
          </p>
        ) : (
          <DataTable<PucRow> columns={columns} data={pucs} emptyMessage="No certificates" />
        )}
      </CardContent>
    </Card>
  );
}

/* ─── service log section ─────────────────────────────────────────────── */

interface ServiceFormState {
  serviceDate: string;
  serviceType: ServiceType;
  garageName: string;
  costRupees: string;
  odometerKm: string;
  description: string;
  nextServiceDueDate: string;
  nextServiceDueKm: string;
  notes: string;
}

const emptyServiceForm: ServiceFormState = {
  serviceDate: '',
  serviceType: 'REGULAR',
  garageName: '',
  costRupees: '',
  odometerKm: '',
  description: '',
  nextServiceDueDate: '',
  nextServiceDueKm: '',
  notes: '',
};

function serviceToForm(s: ServiceRow): ServiceFormState {
  return {
    serviceDate: s.serviceDate,
    serviceType: s.serviceType,
    garageName: s.garageName ?? '',
    costRupees: (s.costPaisa / 100).toString(),
    odometerKm: s.odometerKm?.toString() ?? '',
    description: s.description ?? '',
    nextServiceDueDate: s.nextServiceDueDate ?? '',
    nextServiceDueKm: s.nextServiceDueKm?.toString() ?? '',
    notes: s.notes ?? '',
  };
}

function ServiceSection({
  vehicleId,
  entries,
  onChanged,
}: {
  vehicleId: number;
  entries: ServiceRow[];
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ServiceFormState>(emptyServiceForm);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const startAdd = () => {
    setForm(emptyServiceForm);
    setEditingId(null);
    setAdding(true);
  };
  const startEdit = (s: ServiceRow) => {
    setForm(serviceToForm(s));
    setEditingId(s.id);
    setAdding(true);
  };
  const cancel = () => {
    setAdding(false);
    setEditingId(null);
    setForm(emptyServiceForm);
  };

  const submit = async () => {
    if (!form.serviceDate) {
      toast.error('Service date is required');
      return;
    }
    setIsSubmitting(true);
    try {
      const body = {
        serviceDate: form.serviceDate,
        serviceType: form.serviceType,
        garageName: form.garageName.trim() || null,
        costRupees: form.costRupees ? Number(form.costRupees) : 0,
        odometerKm: form.odometerKm ? Number(form.odometerKm) : null,
        description: form.description.trim() || null,
        nextServiceDueDate: form.nextServiceDueDate || null,
        nextServiceDueKm: form.nextServiceDueKm ? Number(form.nextServiceDueKm) : null,
        notes: form.notes.trim() || null,
      };
      const url = editingId
        ? `/api/investments/vehicles/service/${editingId}`
        : `/api/investments/vehicles/${vehicleId}/service`;
      const r = await fetch(url, {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || 'Save failed');
      }
      toast.success(editingId ? 'Service updated' : 'Service recorded');
      cancel();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const remove = async (id: number) => {
    if (!confirm('Delete this service entry?')) return;
    try {
      const r = await fetch(`/api/investments/vehicles/service/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('delete failed');
      toast.success('Entry removed');
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const columns: Column<ServiceRow>[] = [
    {
      key: 'serviceDate',
      header: 'Date',
      render: (_v, s) => <span className="text-sm">{s.serviceDate}</span>,
    },
    {
      key: 'serviceType',
      header: 'Type',
      render: (_v, s) => <Badge variant="info">{s.serviceType.replace('_', ' ')}</Badge>,
    },
    {
      key: 'garageName',
      header: 'Garage',
      render: (_v, s) => (
        <div className="flex flex-col">
          <span className="text-sm text-[var(--dxp-text)]">{s.garageName ?? '—'}</span>
          {s.description && (
            <span className="text-xs text-[var(--dxp-text-muted)]">{s.description}</span>
          )}
        </div>
      ),
    },
    {
      key: 'odometerKm',
      header: 'Odometer',
      render: (_v, s) => (
        <span className="text-sm text-[var(--dxp-text-secondary)]">
          {s.odometerKm != null ? `${s.odometerKm.toLocaleString('en-IN')} km` : '—'}
        </span>
      ),
    },
    {
      key: 'costPaisa',
      header: 'Cost',
      render: (_v, s) => (
        <span className="font-mono text-[var(--dxp-text)]">{formatINR(s.costPaisa)}</span>
      ),
    },
    {
      key: 'nextServiceDueDate',
      header: 'Next due',
      render: (_v, s) => (
        <span className="text-xs text-[var(--dxp-text-secondary)]">
          {s.nextServiceDueDate ?? (s.nextServiceDueKm ? `${s.nextServiceDueKm} km` : '—')}
        </span>
      ),
    },
    {
      key: 'id',
      header: '',
      render: (_v, s) => (
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              startEdit(s);
            }}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              remove(s.id);
            }}
          >
            <Trash2 className="h-4 w-4 text-rose-500" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <Wrench className="h-5 w-5 text-[var(--dxp-brand)]" />
            Service log ({entries.length})
          </h3>
          {!adding && (
            <Button variant="secondary" size="sm" onClick={startAdd}>
              <Plus className="mr-1 h-3 w-3" /> Record service
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {adding && (
          <div className="mb-4 rounded-lg border border-[var(--dxp-border)] bg-[var(--dxp-surface-alt)] p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Service date">
                <Input
                  type="date"
                  value={form.serviceDate}
                  onChange={(e) => setForm((f) => ({ ...f, serviceDate: e.target.value }))}
                />
              </Field>
              <Field label="Type">
                <Select
                  value={form.serviceType}
                  onChange={(v) => setForm((f) => ({ ...f, serviceType: v as ServiceType }))}
                  options={SERVICE_TYPE_OPTIONS}
                />
              </Field>
              <Field label="Garage">
                <Input
                  value={form.garageName}
                  onChange={(e) => setForm((f) => ({ ...f, garageName: e.target.value }))}
                />
              </Field>
              <Field label="Odometer (km)">
                <Input
                  type="number"
                  value={form.odometerKm}
                  onChange={(e) => setForm((f) => ({ ...f, odometerKm: e.target.value }))}
                />
              </Field>
              <Field label="Cost (₹)">
                <Input
                  type="number"
                  value={form.costRupees}
                  onChange={(e) => setForm((f) => ({ ...f, costRupees: e.target.value }))}
                />
              </Field>
              <Field label="Next service due date">
                <Input
                  type="date"
                  value={form.nextServiceDueDate}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, nextServiceDueDate: e.target.value }))
                  }
                />
              </Field>
              <Field label="Next service due (km)">
                <Input
                  type="number"
                  value={form.nextServiceDueKm}
                  onChange={(e) => setForm((f) => ({ ...f, nextServiceDueKm: e.target.value }))}
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Description">
                  <Input
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    placeholder="e.g. 20K km service — oil + filters"
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
                {editingId ? 'Update service' : 'Record service'}
              </Button>
            </div>
          </div>
        )}
        {entries.length === 0 && !adding ? (
          <p className="py-4 text-center text-sm text-[var(--dxp-text-muted)]">
            No service entries yet.
          </p>
        ) : (
          <DataTable<ServiceRow> columns={columns} data={entries} emptyMessage="No service log" />
        )}
      </CardContent>
    </Card>
  );
}

/* ─── cost of ownership rollup ────────────────────────────────────────── */

function CostOfOwnershipCard({
  policies,
  pucs,
  services,
  purchaseDate,
}: {
  policies: InsurancePolicy[];
  pucs: PucRow[];
  services: ServiceRow[];
  purchaseDate: string;
}) {
  const totalInsurance = policies.reduce(
    (s, p) => s + annualisePremium(p.premiumPaisa, p.premiumFrequency),
    0
  );
  const totalPuc = pucs.reduce((s, p) => s + (p.costPaisa ?? 0), 0);
  const totalService = services.reduce((s, e) => s + e.costPaisa, 0);
  const totalAllTime = totalInsurance + totalPuc + totalService;

  // Current-FY costs
  const fy = indianFY(new Date());
  const inFy = (date: string) => {
    const d = new Date(date);
    return d >= fy.start && d <= fy.end;
  };
  const fyInsurance = policies
    .filter((p) => inFy(p.startDate))
    .reduce((s, p) => s + annualisePremium(p.premiumPaisa, p.premiumFrequency), 0);
  const fyPuc = pucs.filter((p) => inFy(p.issuedDate)).reduce((s, p) => s + (p.costPaisa ?? 0), 0);
  const fyService = services
    .filter((e) => inFy(e.serviceDate))
    .reduce((s, e) => s + e.costPaisa, 0);
  const fyTotal = fyInsurance + fyPuc + fyService;

  // Annualised run rate based on ownership age (capped at 1y to avoid distortion).
  const ownedMs = Date.now() - new Date(purchaseDate).getTime();
  const ownedYears = Math.max(ownedMs / (365.25 * 86_400_000), 0.25);
  const runRate = totalAllTime / Math.min(ownedYears, 10);

  return (
    <Card>
      <CardHeader>
        <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
          <Wallet className="h-5 w-5 text-[var(--dxp-brand)]" />
          Cost of ownership
        </h3>
        <p className="text-xs text-[var(--dxp-text-secondary)]">
          Lifetime totals across this vehicle plus current FY snapshot.
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Stat label="Insurance premium (all)" value={formatINR(totalInsurance)} />
          <Stat label="PUC costs (all)" value={formatINR(totalPuc)} />
          <Stat label="Service costs (all)" value={formatINR(totalService)} />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Stat label="Current FY — insurance" value={formatINR(fyInsurance)} />
          <Stat label="Current FY — PUC" value={formatINR(fyPuc)} />
          <Stat label="Current FY — service" value={formatINR(fyService)} />
        </div>
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Stat label="FY total" value={formatINR(fyTotal)} accent />
          <Stat label="Annualised run rate" value={formatINR(runRate)} accent />
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className={`rounded-lg border ${
        accent
          ? 'border-[var(--dxp-brand)]/40 bg-[var(--dxp-brand-light)]'
          : 'border-[var(--dxp-border)] bg-[var(--dxp-surface-alt)]'
      } p-3`}
    >
      <p className="text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
        {label}
      </p>
      <p
        className={`mt-1 font-mono text-lg font-semibold ${
          accent ? 'text-[var(--dxp-brand-dark)]' : 'text-[var(--dxp-text)]'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
