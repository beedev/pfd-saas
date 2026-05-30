'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button, Input, Card, CardHeader, CardContent, Select } from '@dxp/ui';
import { Home, Loader2, Building2, MapPin, Briefcase, Trees } from 'lucide-react';

type PropertyType = 'RESIDENTIAL' | 'COMMERCIAL' | 'LAND' | 'PLOT';

const TYPE_CARDS: Array<{ key: PropertyType; title: string; description: string; Icon: typeof Home }> = [
  { key: 'RESIDENTIAL', title: 'Residential', description: 'Apartment, independent house', Icon: Home },
  { key: 'COMMERCIAL', title: 'Commercial', description: 'Shops, offices, godown', Icon: Briefcase },
  { key: 'LAND', title: 'Land', description: 'Agricultural or other land', Icon: Trees },
  { key: 'PLOT', title: 'Plot', description: 'Residential / commercial plot', Icon: MapPin },
];

export default function NewPropertyPage() {
  const router = useRouter();
  const [type, setType] = useState<PropertyType | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [propertyName, setPropertyName] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [pincode, setPincode] = useState('');
  const [area, setArea] = useState('');
  const [builtUpArea, setBuiltUpArea] = useState('');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [currentValuation, setCurrentValuation] = useState('');
  const [valuationDate, setValuationDate] = useState(new Date().toISOString().slice(0, 10));
  const [valuationMethod, setValuationMethod] = useState('SELF');
  const [hasLoan, setHasLoan] = useState(false);
  const [loanAmount, setLoanAmount] = useState('');
  const [loanEmi, setLoanEmi] = useState('');
  const [loanRate, setLoanRate] = useState('');
  const [loanLender, setLoanLender] = useState('');
  const [loanEndDate, setLoanEndDate] = useState('');
  const [isRented, setIsRented] = useState(false);
  const [monthlyRent, setMonthlyRent] = useState('');
  const [isUnderConstruction, setIsUnderConstruction] = useState(false);
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [notes, setNotes] = useState('');

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!type) {
      toast.error('Pick a property type');
      return;
    }
    if (!propertyName || !address || !city || !state || !purchaseDate || !area) {
      toast.error('Please fill required fields');
      return;
    }
    setIsSaving(true);
    try {
      const r = await fetch('/api/investments/real-estate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyName: propertyName.trim(),
          type,
          address: address.trim(),
          city: city.trim(),
          state: state.trim(),
          pincode: pincode || undefined,
          area: parseFloat(area),
          builtUpArea: parseFloat(builtUpArea) || undefined,
          purchaseDate,
          purchasePriceRupees: parseFloat(purchasePrice) || 0,
          currentValuationRupees: parseFloat(currentValuation) || parseFloat(purchasePrice) || 0,
          valuationDate,
          valuationMethod,
          hasLoan,
          mortgageAmountRupees: hasLoan ? parseFloat(loanAmount) || 0 : undefined,
          mortgageEmiRupees: hasLoan ? parseFloat(loanEmi) || 0 : undefined,
          mortgageRate: hasLoan ? parseFloat(loanRate) || 0 : undefined,
          mortgageLender: hasLoan ? loanLender : undefined,
          mortgageEndDate: hasLoan ? loanEndDate || undefined : undefined,
          isRented,
          monthlyRentRupees: isRented ? parseFloat(monthlyRent) || 0 : undefined,
          isUnderConstruction,
          notes:
            [notes, registrationNumber ? `Reg #${registrationNumber}` : '']
              .filter(Boolean)
              .join(' · ') || undefined,
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to add property');
      }
      toast.success('Property added');
      router.push('/investments/real-estate');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to add property';
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">Add Property</h1>
        <p className="text-[var(--dxp-text-secondary)]">Track a real estate investment.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        {TYPE_CARDS.map((tc) => {
          const active = type === tc.key;
          return (
            <button
              key={tc.key}
              type="button"
              onClick={() => setType(tc.key)}
              className={`rounded-lg border-2 p-4 text-left transition-all ${
                active
                  ? 'border-[var(--dxp-brand)] bg-[var(--dxp-brand-light)] shadow-md'
                  : 'border-[var(--dxp-border)] bg-[var(--dxp-surface)] hover:border-[var(--dxp-brand)]/40'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <tc.Icon className={`h-5 w-5 ${active ? 'text-[var(--dxp-brand)]' : 'text-[var(--dxp-text-muted)]'}`} />
                <span className={`font-semibold ${active ? 'text-[var(--dxp-brand-dark)]' : 'text-[var(--dxp-text)]'}`}>
                  {tc.title}
                </span>
              </div>
              <p className="text-xs text-[var(--dxp-text-secondary)]">{tc.description}</p>
            </button>
          );
        })}
      </div>

      {type && (
        <Card>
          <CardHeader>
            <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
              <Building2 className="h-5 w-5 text-[var(--dxp-brand)]" />
              Property details
            </h3>
            <p className="text-xs text-[var(--dxp-text-secondary)]">All amounts in rupees (₹).</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Property name</label>
                  <Input value={propertyName} onChange={(e) => setPropertyName(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Address</label>
                  <Input value={address} onChange={(e) => setAddress(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">City</label>
                  <Input value={city} onChange={(e) => setCity(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">State</label>
                  <Input value={state} onChange={(e) => setState(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Pincode</label>
                  <Input value={pincode} onChange={(e) => setPincode(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Area (sqft)</label>
                  <Input type="number" value={area} onChange={(e) => setArea(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Built-up / carpet (sqft)</label>
                  <Input type="number" value={builtUpArea} onChange={(e) => setBuiltUpArea(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Registration number</label>
                  <Input value={registrationNumber} onChange={(e) => setRegistrationNumber(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Purchase date</label>
                  <Input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Purchase price (₹)</label>
                  <Input type="number" step="0.01" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Current notional value (₹)</label>
                  <Input type="number" step="0.01" value={currentValuation} onChange={(e) => setCurrentValuation(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Last valuation date</label>
                  <Input type="date" value={valuationDate} onChange={(e) => setValuationDate(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Valuation method</label>
                  <Select
                    options={[
                      { value: 'CIRCLE_RATE', label: 'Circle rate' },
                      { value: 'MARKET_QUOTE', label: 'Market quote' },
                      { value: 'BROKER_ESTIMATE', label: 'Broker estimate' },
                      { value: 'SELF', label: 'Self estimate' },
                    ]}
                    value={valuationMethod}
                    onChange={(v) => setValuationMethod(v)}
                  />
                </div>
              </div>

              <div className="rounded-lg border border-[var(--dxp-border-light)] p-4">
                <label className="flex items-center gap-2 text-sm font-semibold text-[var(--dxp-text)]">
                  <input type="checkbox" checked={hasLoan} onChange={(e) => setHasLoan(e.target.checked)} />
                  Property has an active loan
                </label>
                {hasLoan && (
                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    <div>
                      <label className="text-xs text-[var(--dxp-text-muted)] block mb-1">Lender</label>
                      <Input value={loanLender} onChange={(e) => setLoanLender(e.target.value)} />
                    </div>
                    <div>
                      <label className="text-xs text-[var(--dxp-text-muted)] block mb-1">Outstanding (₹)</label>
                      <Input type="number" step="0.01" value={loanAmount} onChange={(e) => setLoanAmount(e.target.value)} />
                    </div>
                    <div>
                      <label className="text-xs text-[var(--dxp-text-muted)] block mb-1">EMI (₹)</label>
                      <Input type="number" step="0.01" value={loanEmi} onChange={(e) => setLoanEmi(e.target.value)} />
                    </div>
                    <div>
                      <label className="text-xs text-[var(--dxp-text-muted)] block mb-1">Rate (%)</label>
                      <Input type="number" step="0.01" value={loanRate} onChange={(e) => setLoanRate(e.target.value)} />
                    </div>
                    <div>
                      <label className="text-xs text-[var(--dxp-text-muted)] block mb-1">End date</label>
                      <Input type="date" value={loanEndDate} onChange={(e) => setLoanEndDate(e.target.value)} />
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-[var(--dxp-border-light)] p-4">
                <label className="flex items-center gap-2 text-sm font-semibold text-[var(--dxp-text)]">
                  <input type="checkbox" checked={isRented} onChange={(e) => setIsRented(e.target.checked)} />
                  Property is rented out
                </label>
                {isRented && (
                  <div className="mt-3">
                    <label className="text-xs text-[var(--dxp-text-muted)] block mb-1">Monthly rent (₹)</label>
                    <Input type="number" step="0.01" value={monthlyRent} onChange={(e) => setMonthlyRent(e.target.value)} />
                  </div>
                )}
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm font-semibold text-[var(--dxp-text)]">
                  <input
                    type="checkbox"
                    checked={isUnderConstruction}
                    onChange={(e) => setIsUnderConstruction(e.target.checked)}
                  />
                  Under construction
                </label>
              </div>

              <div>
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Notes</label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => router.back()} disabled={isSaving}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={isSaving}>
                  {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save property
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
