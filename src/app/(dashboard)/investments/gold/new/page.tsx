'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import {
  Button,
  Input,
  Card,
  CardHeader,
  CardContent,
  Select,
} from '@dxp/ui';
import {
  Coins,
  Loader2,
  Search,
  Landmark,
  LineChart,
  Package,
  Smartphone,
} from 'lucide-react';

type GoldType = 'GOLD_BOND' | 'ETF' | 'PHYSICAL' | 'DIGITAL';

const typeCards: Array<{
  key: GoldType;
  title: string;
  description: string;
  Icon: typeof Coins;
}> = [
  {
    key: 'GOLD_BOND',
    title: 'Sovereign Gold Bond',
    description: 'RBI-issued, 8-year tenure, 2.5% interest',
    Icon: Landmark,
  },
  {
    key: 'ETF',
    title: 'Gold ETF',
    description: 'Exchange-traded, live NSE/BSE price',
    Icon: LineChart,
  },
  {
    key: 'PHYSICAL',
    title: 'Physical',
    description: 'Coins, bars, jewellery in your possession',
    Icon: Package,
  },
  {
    key: 'DIGITAL',
    title: 'Digital',
    description: 'MMTC-PAMP, SafeGold, Augmont',
    Icon: Smartphone,
  },
];

// Helper to add N years to an ISO date string (YYYY-MM-DD)
const addYearsIso = (iso: string, years: number): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
};

export default function NewGoldPage() {
  const router = useRouter();
  const [type, setType] = useState<GoldType | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Shared
  const [name, setName] = useState('');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [notes, setNotes] = useState('');

  // Weight-based (SGB/Physical/Digital)
  const [grams, setGrams] = useState('');
  const [purity, setPurity] = useState<'999' | '995' | '916'>('999');
  const [purchasePricePerGram, setPurchasePricePerGram] = useState('');
  const [storageLocation, setStorageLocation] = useState('');
  const [digitalProvider, setDigitalProvider] = useState('');

  // SGB
  const [sgbSeries, setSgbSeries] = useState('');
  const [sgbIssueDate, setSgbIssueDate] = useState('');
  const [sgbMaturityDate, setSgbMaturityDate] = useState('');
  const [sgbInterestRate, setSgbInterestRate] = useState('2.5');

  // ETF
  const [etfSymbol, setEtfSymbol] = useState('');
  const [etfUnits, setEtfUnits] = useState('');
  const [purchasePricePerUnit, setPurchasePricePerUnit] = useState('');
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [etfPreview, setEtfPreview] = useState<{ name: string; price: number } | null>(null);

  const onIssueDateChange = (iso: string) => {
    setSgbIssueDate(iso);
    if (iso && !sgbMaturityDate) {
      setSgbMaturityDate(addYearsIso(iso, 8));
    }
  };

  const lookupEtf = async () => {
    if (!etfSymbol.trim()) return;
    setIsLookingUp(true);
    try {
      const r = await fetch(
        `/api/investments/quotes?symbols=${encodeURIComponent(etfSymbol.trim().toUpperCase())}`
      );
      const data = await r.json();
      const quote = data.quotes?.[0];
      if (!quote) {
        toast.error(`No quote found for ${etfSymbol}`);
        setEtfPreview(null);
        return;
      }
      setEtfPreview({
        name: quote.longName || quote.shortName || quote.symbol,
        price: quote.regularMarketPrice,
      });
      if (!purchasePricePerUnit) {
        setPurchasePricePerUnit(String(quote.regularMarketPrice));
      }
      toast.success(`Found ${quote.longName || quote.symbol}`);
    } catch (err) {
      console.error(err);
      toast.error('Lookup failed');
    } finally {
      setIsLookingUp(false);
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!type) {
      toast.error('Pick a gold type');
      return;
    }
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }

    setIsSaving(true);
    try {
      let payload: Record<string, unknown> = {
        type,
        name: name.trim(),
        purchaseDate: purchaseDate || undefined,
        notes: notes || undefined,
      };

      if (type === 'GOLD_BOND') {
        payload = {
          ...payload,
          grams: parseFloat(grams),
          purity: '999',
          purchasePricePerGram: parseFloat(purchasePricePerGram),
          sgbSeries: sgbSeries || undefined,
          sgbIssueDate: sgbIssueDate || undefined,
          sgbMaturityDate: sgbMaturityDate || undefined,
          sgbInterestRate: parseFloat(sgbInterestRate) || 2.5,
        };
      } else if (type === 'ETF') {
        payload = {
          ...payload,
          etfSymbol: etfSymbol.trim().toUpperCase(),
          etfUnits: parseFloat(etfUnits),
          purchasePricePerUnit: parseFloat(purchasePricePerUnit),
        };
      } else if (type === 'PHYSICAL') {
        payload = {
          ...payload,
          grams: parseFloat(grams),
          purity,
          purchasePricePerGram: parseFloat(purchasePricePerGram),
          notes:
            [notes, storageLocation ? `Storage: ${storageLocation}` : '']
              .filter(Boolean)
              .join(' · ') || undefined,
        };
      } else if (type === 'DIGITAL') {
        payload = {
          ...payload,
          grams: parseFloat(grams),
          purity: '999',
          purchasePricePerGram: parseFloat(purchasePricePerGram),
          notes:
            [notes, digitalProvider ? `Provider: ${digitalProvider}` : '']
              .filter(Boolean)
              .join(' · ') || undefined,
        };
      }

      const r = await fetch('/api/investments/gold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to add gold holding');
      }
      toast.success('Gold holding added');
      router.push('/investments/gold');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to add gold holding';
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">Add Gold</h1>
        <p className="text-[var(--dxp-text-secondary)]">
          Pick the type of gold, then fill in the position details.
        </p>
      </div>

      {/* Type selector */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {typeCards.map((tc) => {
          const active = type === tc.key;
          return (
            <button
              key={tc.key}
              type="button"
              onClick={() => setType(tc.key)}
              className={`rounded-lg border-2 p-4 text-left transition-all ${
                active
                  ? 'border-amber-500 bg-amber-50 shadow-md'
                  : 'border-[var(--dxp-border)] bg-[var(--dxp-surface)] hover:border-amber-300'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <tc.Icon className={`h-5 w-5 ${active ? 'text-amber-600' : 'text-[var(--dxp-text-muted)]'}`} />
                <span className={`font-semibold ${active ? 'text-amber-900' : 'text-[var(--dxp-text)]'}`}>
                  {tc.title}
                </span>
              </div>
              <p className="text-xs text-[var(--dxp-text-secondary)]">{tc.description}</p>
            </button>
          );
        })}
      </div>

      {/* Form */}
      {type && (
        <Card>
          <CardHeader>
            <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
              <Coins className="h-5 w-5 text-amber-600" />
              {typeCards.find((t) => t.key === type)?.title} details
            </h3>
            <p className="text-xs text-[var(--dxp-text-secondary)]">
              All amounts in rupees (₹). Stored internally as paisa.
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-5">
              {/* Shared: name + purchase date */}
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Name
                  </label>
                  <Input
                    placeholder={
                      type === 'GOLD_BOND'
                        ? 'e.g. SGB 2024-I'
                        : type === 'ETF'
                        ? 'e.g. HDFC Gold ETF'
                        : type === 'PHYSICAL'
                        ? 'e.g. 22K bangles'
                        : 'e.g. MMTC-PAMP wallet'
                    }
                    value={name}
                    onChange={(e) => setName(e.target.value)}
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
              </div>

              {/* SGB-specific */}
              {type === 'GOLD_BOND' && (
                <>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div>
                      <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                        Grams
                      </label>
                      <Input
                        type="number"
                        step="0.001"
                        min="0"
                        value={grams}
                        onChange={(e) => setGrams(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                        Series
                      </label>
                      <Input
                        placeholder="e.g. 2024-I"
                        value={sgbSeries}
                        onChange={(e) => setSgbSeries(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                        Interest rate (%)
                      </label>
                      <Input
                        type="number"
                        step="0.1"
                        min="0"
                        value={sgbInterestRate}
                        onChange={(e) => setSgbInterestRate(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div>
                      <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                        Issue date
                      </label>
                      <Input
                        type="date"
                        value={sgbIssueDate}
                        onChange={(e) => onIssueDateChange(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                        Maturity date
                      </label>
                      <Input
                        type="date"
                        value={sgbMaturityDate}
                        onChange={(e) => setSgbMaturityDate(e.target.value)}
                      />
                      <p className="mt-1 text-xs text-[var(--dxp-text-muted)]">
                        Auto-computed (issue + 8 years), editable
                      </p>
                    </div>
                    <div>
                      <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                        Issue price per gram (₹)
                      </label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={purchasePricePerGram}
                        onChange={(e) => setPurchasePricePerGram(e.target.value)}
                      />
                    </div>
                  </div>
                </>
              )}

              {/* ETF-specific */}
              {type === 'ETF' && (
                <>
                  <div>
                    <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                      ETF symbol
                    </label>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <Input
                          placeholder="e.g. GOLDBEES.NS"
                          value={etfSymbol}
                          onChange={(e) => setEtfSymbol(e.target.value.toUpperCase())}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={lookupEtf}
                        disabled={isLookingUp}
                      >
                        {isLookingUp ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Search className="mr-2 h-4 w-4" />
                        )}
                        Lookup
                      </Button>
                    </div>
                    <p className="mt-1 text-xs text-[var(--dxp-text-muted)]">
                      Add the exchange suffix: .NS for NSE, .BO for BSE.
                    </p>
                  </div>

                  {etfPreview && (
                    <div className="rounded-md border border-[var(--dxp-border)] bg-amber-50 p-3 text-sm">
                      <p className="font-semibold text-[var(--dxp-text)]">{etfPreview.name}</p>
                      <p className="text-xs text-[var(--dxp-text-secondary)]">
                        Live price:{' '}
                        <span className="font-mono font-bold text-amber-900">
                          ₹{etfPreview.price.toFixed(2)}
                        </span>
                      </p>
                    </div>
                  )}

                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                        Units
                      </label>
                      <Input
                        type="number"
                        step="0.001"
                        min="0"
                        value={etfUnits}
                        onChange={(e) => setEtfUnits(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                        Average price per unit (₹)
                      </label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={purchasePricePerUnit}
                        onChange={(e) => setPurchasePricePerUnit(e.target.value)}
                      />
                    </div>
                  </div>
                </>
              )}

              {/* Physical-specific */}
              {type === 'PHYSICAL' && (
                <>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div>
                      <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                        Grams
                      </label>
                      <Input
                        type="number"
                        step="0.001"
                        min="0"
                        value={grams}
                        onChange={(e) => setGrams(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                        Purity
                      </label>
                      <Select
                        options={[
                          { value: '999', label: '999 (24K)' },
                          { value: '995', label: '995' },
                          { value: '916', label: '916 (22K)' },
                        ]}
                        value={purity}
                        onChange={(v) => setPurity(v as '999' | '995' | '916')}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                        Purchase price per gram (₹)
                      </label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={purchasePricePerGram}
                        onChange={(e) => setPurchasePricePerGram(e.target.value)}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                      Storage location (optional)
                    </label>
                    <Input
                      placeholder="e.g. Home locker, SBI locker"
                      value={storageLocation}
                      onChange={(e) => setStorageLocation(e.target.value)}
                    />
                  </div>
                </>
              )}

              {/* Digital-specific */}
              {type === 'DIGITAL' && (
                <>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div>
                      <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                        Provider
                      </label>
                      <Input
                        placeholder="MMTC-PAMP / SafeGold / Augmont"
                        value={digitalProvider}
                        onChange={(e) => setDigitalProvider(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                        Grams
                      </label>
                      <Input
                        type="number"
                        step="0.0001"
                        min="0"
                        value={grams}
                        onChange={(e) => setGrams(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                        Purchase price per gram (₹)
                      </label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={purchasePricePerGram}
                        onChange={(e) => setPurchasePricePerGram(e.target.value)}
                      />
                    </div>
                  </div>
                </>
              )}

              {/* Notes */}
              <div>
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                  Notes (optional)
                </label>
                <textarea
                  rows={3}
                  placeholder="Any notes about this holding"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full rounded-md border border-[var(--dxp-border)] bg-[var(--dxp-surface)] px-3 py-2 text-sm text-[var(--dxp-text)] placeholder:text-[var(--dxp-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--dxp-brand)]"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <Button type="submit" variant="primary" disabled={isSaving}>
                  {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Add gold
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => router.push('/investments/gold')}
                  disabled={isSaving}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
