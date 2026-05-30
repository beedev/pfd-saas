'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';

import {
  Button,
  Input,
  Card,
  CardHeader,
  CardContent,
  Select,
} from '@dxp/ui';
import { Loader2, Search, PiggyBank } from 'lucide-react';

interface AmfiFund {
  schemeCode: string;
  isin: string;
  schemeName: string;
  nav: number;
  navDate: string;
}

const fundFormSchema = z.object({
  units: z.number({ message: 'Units required' }).positive('Units must be > 0'),
  totalInvestment: z
    .number({ message: 'Total invested required' })
    .positive('Total invested must be > 0'),
  fundType: z.enum(['EQUITY', 'DEBT', 'HYBRID', 'LIQUID', 'GOLD']),
  folioNumber: z.string().optional(),
  notes: z.string().optional(),
});

type FundFormData = z.infer<typeof fundFormSchema>;

export default function NewMutualFundPage() {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AmfiFund[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selected, setSelected] = useState<AmfiFund | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FundFormData>({
    resolver: zodResolver(fundFormSchema),
    defaultValues: {
      units: 0,
      totalInvestment: 0,
      fundType: 'EQUITY',
      folioNumber: '',
      notes: '',
    },
  });

  // Debounced AMFI search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim() || selected) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const r = await fetch(
          `/api/investments/mutual-funds/search?q=${encodeURIComponent(query)}`
        );
        const data = await r.json();
        setResults(data.funds || []);
      } catch (e) {
        console.error(e);
      } finally {
        setIsSearching(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, selected]);

  const pickFund = (fund: AmfiFund) => {
    setSelected(fund);
    setResults([]);
    setQuery(fund.schemeName);
    // Heuristic guess for fund type based on name keywords
    const lower = fund.schemeName.toLowerCase();
    if (lower.includes('liquid') || lower.includes('overnight')) setValue('fundType', 'LIQUID');
    else if (lower.includes('debt') || lower.includes('bond') || lower.includes('gilt')) setValue('fundType', 'DEBT');
    else if (lower.includes('hybrid') || lower.includes('balanced')) setValue('fundType', 'HYBRID');
    else if (lower.includes('gold')) setValue('fundType', 'GOLD');
    else setValue('fundType', 'EQUITY');
  };

  const clearSelection = () => {
    setSelected(null);
    setQuery('');
  };

  const onSubmit = async (data: FundFormData) => {
    if (!selected) {
      toast.error('Pick a scheme from the AMFI search results');
      return;
    }
    setIsSaving(true);
    try {
      const payload = {
        isin: selected.isin,
        schemeCode: selected.schemeCode,
        schemeName: selected.schemeName,
        fundType: data.fundType,
        folioNumber: data.folioNumber || undefined,
        units: data.units,
        nav: selected.nav,
        totalInvestment: data.totalInvestment,
        notes: data.notes,
      };
      const r = await fetch('/api/investments/mutual-funds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to add fund');
      }
      toast.success('Mutual fund added');
      router.push('/investments/mutual-funds');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to add fund';
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">Add Mutual Fund</h1>
        <p className="text-[var(--dxp-text-secondary)]">
          Search the AMFI catalog and snapshot your existing position.
        </p>
      </div>

      <Card>
        <CardHeader>
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <PiggyBank className="h-5 w-5 text-[var(--dxp-brand)]" />
            Fund details
          </h3>
          <p className="text-xs text-[var(--dxp-text-secondary)]">
            All amounts are in rupees (₹). Stored internally as paisa.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            {/* AMFI search */}
            <div>
              <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                Search scheme
              </label>
              <div className="relative">
                <div className="flex items-center gap-2 rounded-md border border-[var(--dxp-border)] bg-[var(--dxp-surface)] px-3 py-2">
                  <Search className="h-4 w-4 text-[var(--dxp-text-muted)]" />
                  <input
                    type="text"
                    placeholder="e.g. HDFC Mid Cap Opportunities"
                    value={query}
                    onChange={(e) => {
                      setSelected(null);
                      setQuery(e.target.value);
                    }}
                    className="flex-1 bg-transparent text-sm text-[var(--dxp-text)] placeholder:text-[var(--dxp-text-muted)] focus:outline-none"
                  />
                  {isSearching && <Loader2 className="h-4 w-4 animate-spin text-[var(--dxp-text-muted)]" />}
                </div>
                {results.length > 0 && (
                  <div className="absolute z-10 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-[var(--dxp-border)] bg-[var(--dxp-surface)] shadow-lg">
                    {results.map((fund) => (
                      <button
                        key={fund.schemeCode}
                        type="button"
                        onClick={() => pickFund(fund)}
                        className="flex w-full items-start justify-between gap-4 border-b border-[var(--dxp-border-light)] px-3 py-2 text-left last:border-b-0 hover:bg-[var(--dxp-brand-light)]"
                      >
                        <div className="flex-1">
                          <p className="text-sm font-medium text-[var(--dxp-text)]">{fund.schemeName}</p>
                          <p className="text-xs text-[var(--dxp-text-muted)] font-mono">
                            {fund.isin} • Code {fund.schemeCode}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-mono text-sm font-bold text-[var(--dxp-text)]">
                            ₹{fund.nav.toFixed(2)}
                          </p>
                          <p className="text-[10px] text-[var(--dxp-text-muted)]">{fund.navDate}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <p className="mt-1 text-xs text-[var(--dxp-text-muted)]">
                Type at least 3 characters. Results come from AMFI&apos;s daily NAV file.
              </p>
            </div>

            {/* Selected scheme preview */}
            {selected && (
              <div className="rounded-md border border-[var(--dxp-border)] bg-[var(--dxp-brand-light)] p-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-[var(--dxp-text)]">{selected.schemeName}</p>
                    <p className="text-xs text-[var(--dxp-text-secondary)] font-mono">
                      ISIN {selected.isin} • Code {selected.schemeCode}
                    </p>
                    <p className="text-xs text-[var(--dxp-text-secondary)] mt-1">
                      Latest NAV:{' '}
                      <span className="font-mono font-bold text-[var(--dxp-brand-dark)]">
                        ₹{selected.nav.toFixed(2)}
                      </span>{' '}
                      ({selected.navDate})
                    </p>
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={clearSelection}>
                    Change
                  </Button>
                </div>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                  Fund type
                </label>
                <Select
                  options={[
                    { value: 'EQUITY', label: 'Equity' },
                    { value: 'DEBT', label: 'Debt' },
                    { value: 'HYBRID', label: 'Hybrid' },
                    { value: 'LIQUID', label: 'Liquid' },
                    { value: 'GOLD', label: 'Gold' },
                  ]}
                  value={watch('fundType')}
                  onChange={(v) => setValue('fundType', v as FundFormData['fundType'])}
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                  Folio number (optional)
                </label>
                <Input placeholder="e.g. 12345678/00" {...register('folioNumber')} />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                  Units
                </label>
                <Input
                  type="number"
                  step="0.001"
                  min="0"
                  {...register('units', { valueAsNumber: true })}
                />
                {errors.units && (
                  <p className="mt-1 text-xs text-rose-600">{errors.units.message}</p>
                )}
              </div>
              <div>
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                  Total invested (₹)
                </label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  {...register('totalInvestment', { valueAsNumber: true })}
                />
                {errors.totalInvestment && (
                  <p className="mt-1 text-xs text-rose-600">{errors.totalInvestment.message}</p>
                )}
              </div>
            </div>

            <div>
              <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                Notes (optional)
              </label>
              <textarea
                rows={3}
                placeholder="Any notes about this position"
                className="w-full rounded-md border border-[var(--dxp-border)] bg-[var(--dxp-surface)] px-3 py-2 text-sm text-[var(--dxp-text)] placeholder:text-[var(--dxp-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--dxp-brand)]"
                {...register('notes')}
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button type="submit" variant="primary" disabled={isSaving || !selected}>
                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add fund
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => router.push('/investments/mutual-funds')}
                disabled={isSaving}
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
