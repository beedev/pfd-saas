'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';

import {
  Button,
  Card,
  CardHeader,
  CardContent,
  Badge,
  StatsDisplay,
  DataTable,
  type Column,
} from '@dxp/ui';
import { Plus, Loader2, Car, Trash2, ChevronDown, ShieldAlert } from 'lucide-react';

type VehicleFuelType = 'PETROL' | 'DIESEL' | 'CNG' | 'LPG' | 'ELECTRIC' | 'HYBRID';
type VehicleStatus = 'ACTIVE' | 'SOLD' | 'SCRAPPED' | 'TRANSFERRED';
type VehicleInsuranceStatus = 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'CLAIMED';
type PremiumFrequency = 'ANNUAL' | 'SEMI_ANNUAL' | 'QUARTERLY' | 'MONTHLY';

interface InsurancePolicy {
  id: number;
  vehicleId: number;
  insurer: string;
  policyNumber: string;
  idvPaisa: number;
  premiumPaisa: number;
  premiumFrequency: PremiumFrequency | null;
  startDate: string;
  renewalDate: string;
  status: VehicleInsuranceStatus | null;
}

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
  // Loaded on demand:
  activeInsurance?: InsurancePolicy | null;
}

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Math.round(paisa) / 100);

const annualisePremium = (paisa: number, freq: PremiumFrequency | null): number => {
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
};

const FUEL_LABEL: Record<VehicleFuelType, string> = {
  PETROL: 'Petrol',
  DIESEL: 'Diesel',
  CNG: 'CNG',
  LPG: 'LPG',
  ELECTRIC: 'Electric',
  HYBRID: 'Hybrid',
};

const STATUS_BADGE: Record<VehicleStatus, 'success' | 'warning' | 'danger' | 'default'> = {
  ACTIVE: 'success',
  SOLD: 'default',
  SCRAPPED: 'danger',
  TRANSFERRED: 'default',
};

function daysUntil(date: string | null | undefined): number | null {
  if (!date) return null;
  const target = new Date(date);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export default function VehiclesPage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<Vehicle | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [listOpen, setListOpen] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/investments/vehicles').then((r) => r.json());
      const list: Vehicle[] = r.vehicles || [];

      // For each vehicle, fetch its active insurance so we can show renewal,
      // total premium, and the renewals-due-soon tile.
      const enriched = await Promise.all(
        list.map(async (v) => {
          try {
            const data = await fetch(`/api/investments/vehicles/${v.id}/insurance`).then((r) =>
              r.ok ? r.json() : { policies: [] }
            );
            const policies: InsurancePolicy[] = data.policies || [];
            const active =
              policies.find((p) => (p.status ?? 'ACTIVE') === 'ACTIVE') ?? policies[0] ?? null;
            return { ...v, activeInsurance: active };
          } catch {
            return { ...v, activeInsurance: null };
          }
        })
      );

      setVehicles(enriched);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load vehicles');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const r = await fetch(`/api/investments/vehicles/${deleteTarget.id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('delete failed');
      toast.success('Vehicle removed');
      setDeleteTarget(null);
      await load();
    } catch (e) {
      console.error(e);
      toast.error('Failed to delete');
    } finally {
      setIsDeleting(false);
    }
  };

  const activeVehicles = vehicles.filter((v) => (v.status ?? 'ACTIVE') === 'ACTIVE');
  const totalIdv = activeVehicles.reduce((s, v) => s + (v.currentIdvPaisa ?? 0), 0);
  const totalAnnualPremium = activeVehicles.reduce((s, v) => {
    if (!v.activeInsurance) return s;
    return s + annualisePremium(v.activeInsurance.premiumPaisa, v.activeInsurance.premiumFrequency);
  }, 0);
  const renewalsDueSoon = activeVehicles.filter((v) => {
    const d = daysUntil(v.activeInsurance?.renewalDate);
    return d !== null && d >= 0 && d <= 30;
  }).length;

  const columns: Column<Vehicle>[] = [
    {
      key: 'registrationNumber',
      header: 'Registration',
      render: (_v, row) => (
        <div className="flex flex-col">
          <Link
            href={`/investments/vehicles/${row.id}`}
            className="font-mono font-semibold text-[var(--dxp-brand)] hover:underline"
          >
            {row.registrationNumber}
          </Link>
          {row.status && row.status !== 'ACTIVE' && (
            <Badge variant={STATUS_BADGE[row.status]} className="mt-1 w-fit text-xs">
              {row.status}
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: 'make',
      header: 'Make & Model',
      render: (_v, row) => (
        <div className="flex flex-col">
          <span className="font-semibold text-[var(--dxp-text)]">
            {row.make} {row.model}
          </span>
          {row.variant && (
            <span className="text-xs text-[var(--dxp-text-muted)]">{row.variant}</span>
          )}
        </div>
      ),
    },
    {
      key: 'year',
      header: 'Year',
      render: (_v, row) => (
        <span className="text-sm text-[var(--dxp-text-secondary)]">{row.year}</span>
      ),
    },
    {
      key: 'fuelType',
      header: 'Fuel',
      render: (_v, row) => <Badge variant="info">{FUEL_LABEL[row.fuelType]}</Badge>,
    },
    {
      key: 'currentIdvPaisa',
      header: 'IDV',
      render: (_v, row) => (
        <span className="font-mono font-semibold text-[var(--dxp-text)]">
          {row.currentIdvPaisa != null ? formatINR(row.currentIdvPaisa) : '—'}
        </span>
      ),
    },
    {
      key: 'purchaseDate',
      header: 'Insurance renewal',
      render: (_v, row) => {
        const renewal = row.activeInsurance?.renewalDate;
        const days = daysUntil(renewal);
        if (!renewal) {
          return <span className="text-xs text-[var(--dxp-text-muted)]">—</span>;
        }
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
            <span className={`text-sm ${tone}`}>{renewal}</span>
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
      key: 'id',
      header: '',
      render: (_v, row) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            setDeleteTarget(row);
          }}
        >
          <Trash2 className="h-4 w-4 text-rose-500" />
        </Button>
      ),
    },
  ];

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--dxp-text-muted)]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">Vehicles</h1>
          <p className="text-[var(--dxp-text-secondary)]">
            Cars, bikes and scooters — insurance terms, PUC certificates and service history
          </p>
        </div>
        <Link href="/investments/vehicles/new">
          <Button variant="primary">
            <Plus className="mr-2 h-4 w-4" />
            Register vehicle
          </Button>
        </Link>
      </div>

      <StatsDisplay
        currency="INR"
        locale="en-IN"
        columns={4}
        stats={[
          { label: 'Active vehicles', value: activeVehicles.length, format: 'number' },
          { label: 'Total IDV', value: totalIdv / 100, format: 'currency' },
          { label: 'Annual premium', value: totalAnnualPremium / 100, format: 'currency' },
          { label: 'Renewals ≤ 30 days', value: renewalsDueSoon, format: 'number' },
        ]}
      />

      <Card>
        <CardHeader>
          <button
            type="button"
            className="flex w-full items-center justify-between text-left"
            onClick={() => setListOpen((p) => !p)}
          >
            <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
              <Car className="h-5 w-5 text-[var(--dxp-brand)]" />
              Fleet ({vehicles.length})
            </h3>
            <ChevronDown
              className={`h-5 w-5 text-[var(--dxp-text-muted)] transition-transform ${
                listOpen ? 'rotate-180' : ''
              }`}
            />
          </button>
        </CardHeader>
        {listOpen && (
          <CardContent>
            {vehicles.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <Car className="h-12 w-12 text-[var(--dxp-text-muted)]" />
                <p className="text-[var(--dxp-text-muted)]">No vehicles yet.</p>
                <Link href="/investments/vehicles/new">
                  <Button variant="primary">
                    <Plus className="mr-2 h-4 w-4" /> Register vehicle
                  </Button>
                </Link>
              </div>
            ) : (
              <DataTable<Vehicle> columns={columns} data={vehicles} emptyMessage="No vehicles" />
            )}
          </CardContent>
        )}
      </Card>

      {renewalsDueSoon > 0 && (
        <Card>
          <CardContent>
            <div className="flex items-start gap-3 py-2">
              <ShieldAlert className="h-5 w-5 flex-shrink-0 text-amber-500" />
              <p className="text-sm text-[var(--dxp-text-secondary)]">
                <strong className="text-[var(--dxp-text)]">{renewalsDueSoon}</strong> insurance
                renewal{renewalsDueSoon > 1 ? 's' : ''} due in the next 30 days. Open each vehicle
                to renew before the policy expires.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => !isDeleting && setDeleteTarget(null)}
        >
          <Card className="w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <h3 className="text-base font-bold text-[var(--dxp-text)]">Delete vehicle?</h3>
              <p className="text-xs text-[var(--dxp-text-secondary)]">
                Removes <strong>{deleteTarget.registrationNumber}</strong> ({deleteTarget.make}{' '}
                {deleteTarget.model}). Insurance, PUC and service records are removed too.
              </p>
            </CardHeader>
            <CardContent>
              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setDeleteTarget(null)}
                  disabled={isDeleting}
                >
                  Cancel
                </Button>
                <Button variant="danger" onClick={confirmDelete} disabled={isDeleting}>
                  {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Delete
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
