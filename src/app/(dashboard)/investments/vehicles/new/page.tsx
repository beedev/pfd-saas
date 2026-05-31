'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';

import { Button, Input, Card, CardHeader, CardContent, Select } from '@dxp/ui';
import { Car, Loader2, ArrowLeft } from 'lucide-react';

type VehicleFuelType = 'PETROL' | 'DIESEL' | 'CNG' | 'LPG' | 'ELECTRIC' | 'HYBRID';

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

export default function NewVehiclePage() {
  const router = useRouter();
  const currentYear = new Date().getFullYear();

  const [registrationNumber, setRegistrationNumber] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [variant, setVariant] = useState('');
  const [year, setYear] = useState<string>(currentYear.toString());
  const [fuelType, setFuelType] = useState<VehicleFuelType>('PETROL');
  const [transmission, setTransmission] = useState('');
  const [color, setColor] = useState('');
  const [bodyType, setBodyType] = useState('');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [currentIdv, setCurrentIdv] = useState('');
  const [odometerKm, setOdometerKm] = useState('0');
  const [notes, setNotes] = useState('');

  const [isSaving, setIsSaving] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!registrationNumber.trim() || !make.trim() || !model.trim()) {
      toast.error('Registration, make and model are required');
      return;
    }
    const yearNum = Number(year);
    if (!yearNum || yearNum < 1990 || yearNum > currentYear + 1) {
      toast.error(`Year must be between 1990 and ${currentYear + 1}`);
      return;
    }
    if (!purchaseDate) {
      toast.error('Purchase date is required');
      return;
    }
    if (!purchasePrice) {
      toast.error('Purchase price is required');
      return;
    }

    setIsSaving(true);
    try {
      const r = await fetch('/api/investments/vehicles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registrationNumber: registrationNumber.trim().toUpperCase(),
          make: make.trim(),
          model: model.trim(),
          variant: variant.trim() || undefined,
          year: yearNum,
          fuelType,
          transmission: transmission || undefined,
          color: color.trim() || undefined,
          bodyType: bodyType || undefined,
          purchaseDate,
          purchasePriceRupees: parseFloat(purchasePrice) || 0,
          currentIdvRupees: currentIdv ? parseFloat(currentIdv) : parseFloat(purchasePrice) || 0,
          odometerKm: odometerKm ? parseInt(odometerKm, 10) : 0,
          notes: notes.trim() || undefined,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Failed to register vehicle');
      toast.success('Vehicle registered');
      const newId = data.vehicle?.id ?? data.id;
      if (newId) {
        router.push(`/investments/vehicles/${newId}`);
      } else {
        router.push('/investments/vehicles');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to register vehicle';
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/investments/vehicles"
          className="inline-flex items-center text-sm text-[var(--dxp-text-secondary)] hover:text-[var(--dxp-brand)]"
        >
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to vehicles
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
          Register Vehicle
        </h1>
        <p className="text-[var(--dxp-text-secondary)]">
          Add a car, bike or scooter. You can attach insurance, PUC and service entries afterwards.
        </p>
      </div>

      <Card>
        <CardHeader>
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <Car className="h-5 w-5 text-[var(--dxp-brand)]" />
            Vehicle details
          </h3>
          <p className="text-xs text-[var(--dxp-text-secondary)]">All amounts in rupees (₹).</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                  Registration number
                </label>
                <Input
                  value={registrationNumber}
                  onChange={(e) => setRegistrationNumber(e.target.value.toUpperCase())}
                  placeholder="e.g. TN09AB1234"
                  className="font-mono"
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                  Make
                </label>
                <Input
                  value={make}
                  onChange={(e) => setMake(e.target.value)}
                  placeholder="e.g. Honda"
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                  Model
                </label>
                <Input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="e.g. City"
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                  Variant
                </label>
                <Input
                  value={variant}
                  onChange={(e) => setVariant(e.target.value)}
                  placeholder="e.g. ZX CVT"
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                  Year
                </label>
                <Input
                  type="number"
                  min={1990}
                  max={currentYear + 1}
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                  Fuel type
                </label>
                <Select
                  value={fuelType}
                  onChange={(v) => setFuelType(v as VehicleFuelType)}
                  options={FUEL_OPTIONS}
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                  Transmission
                </label>
                <Select
                  value={transmission}
                  onChange={(v) => setTransmission(v)}
                  options={TRANSMISSION_OPTIONS}
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                  Body type
                </label>
                <Select
                  value={bodyType}
                  onChange={(v) => setBodyType(v)}
                  options={BODY_TYPE_OPTIONS}
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                  Color
                </label>
                <Input value={color} onChange={(e) => setColor(e.target.value)} />
              </div>
              <div>
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                  Odometer (km)
                </label>
                <Input
                  type="number"
                  value={odometerKm}
                  onChange={(e) => setOdometerKm(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                  Purchase date
                </label>
                <Input
                  type="date"
                  value={purchaseDate}
                  onChange={(e) => setPurchaseDate(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                  Purchase price (₹)
                </label>
                <Input
                  type="number"
                  step="0.01"
                  value={purchasePrice}
                  onChange={(e) => setPurchasePrice(e.target.value)}
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                  Current IDV (₹){' '}
                  <span className="font-normal text-[var(--dxp-text-muted)]">
                    — defaults to purchase price
                  </span>
                </label>
                <Input
                  type="number"
                  step="0.01"
                  value={currentIdv}
                  onChange={(e) => setCurrentIdv(e.target.value)}
                  placeholder={purchasePrice || '0'}
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                Notes
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full rounded border border-[var(--dxp-border)] bg-[var(--dxp-surface)] p-2 text-sm text-[var(--dxp-text)] focus:border-[var(--dxp-brand)] focus:outline-none"
                placeholder="Anything noteworthy — accident history, registration office, dealer notes…"
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => router.back()}
                disabled={isSaving}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={isSaving}>
                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save vehicle
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
