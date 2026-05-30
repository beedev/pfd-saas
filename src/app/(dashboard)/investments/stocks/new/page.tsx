'use client';

import { useState } from 'react';
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
} from '@dxp/ui';
import { Loader2, Search } from 'lucide-react';

const stockSchema = z.object({
  symbol: z.string().min(1, 'Symbol is required'),
  quantity: z
    .number({ message: 'Quantity is required' })
    .positive('Quantity must be greater than 0'),
  averagePrice: z
    .number({ message: 'Average price is required' })
    .positive('Average price must be greater than 0'),
  purchaseDate: z.string().min(1, 'Purchase date is required'),
  notes: z.string().optional(),
});

type StockFormData = z.infer<typeof stockSchema>;

interface QuotePreview {
  symbol: string;
  price: number;
  currency: string;
  name: string;
}

export default function NewStockPage() {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [preview, setPreview] = useState<QuotePreview | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    getValues,
    watch,
    formState: { errors },
  } = useForm<StockFormData>({
    resolver: zodResolver(stockSchema),
    defaultValues: {
      symbol: '',
      quantity: 0,
      averagePrice: 0,
      purchaseDate: new Date().toISOString().slice(0, 10),
      notes: '',
    },
  });

  const symbolValue = watch('symbol');

  const lookupSymbol = async () => {
    const symbol = (getValues('symbol') || '').toUpperCase().trim();
    if (!symbol) {
      toast.error('Enter a symbol first (e.g. RELIANCE.NS)');
      return;
    }
    setIsLookingUp(true);
    try {
      const response = await fetch(
        `/api/investments/quotes?symbols=${encodeURIComponent(symbol)}`
      );
      const data = await response.json();
      const quote = (data.quotes ?? [])[0] as
        | {
            symbol: string;
            regularMarketPrice: number;
            currency: string;
            longName?: string;
            shortName?: string;
          }
        | undefined;
      if (!quote) {
        toast.error(`No quote found for ${symbol}`);
        setPreview(null);
        return;
      }
      setPreview({
        symbol: quote.symbol,
        price: quote.regularMarketPrice,
        currency: quote.currency || 'INR',
        name: quote.longName || quote.shortName || quote.symbol,
      });
      // Auto-fill the average price if user hasn't entered one yet
      if (getValues('averagePrice') === 0) {
        setValue('averagePrice', quote.regularMarketPrice);
      }
      toast.success(`Found ${quote.longName || quote.symbol}`);
    } catch (error) {
      console.error(error);
      toast.error('Lookup failed');
    } finally {
      setIsLookingUp(false);
    }
  };

  const onSubmit = async (data: StockFormData) => {
    setIsSaving(true);
    try {
      const payload = { ...data, symbol: data.symbol.toUpperCase().trim() };
      const response = await fetch('/api/investments/stocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to add stock');
      }
      toast.success('Stock added');
      router.push('/investments/stocks');
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to add stock';
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">Add Stock</h1>
        <p className="text-[var(--dxp-text-secondary)]">
          Record a new equity holding. Use Yahoo Finance symbols (e.g. RELIANCE.NS, INFY.NS).
        </p>
      </div>

      <Card>
        <CardHeader>
          <h3 className="text-base font-bold text-[var(--dxp-text)]">Holding details</h3>
          <p className="text-xs text-[var(--dxp-text-secondary)]">
            All amounts are in rupees (₹). They&apos;ll be stored internally as paisa.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            {/* Symbol with lookup */}
            <div>
              <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                Symbol
              </label>
              <div className="flex gap-2">
                <div className="flex-1">
                  <Input
                    placeholder="e.g. RELIANCE.NS"
                    value={symbolValue}
                    onChange={(e) => setValue('symbol', e.target.value.toUpperCase())}
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={lookupSymbol}
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
              {errors.symbol && (
                <p className="mt-1 text-xs text-rose-600">{errors.symbol.message}</p>
              )}
            </div>

            {/* Live preview */}
            {preview && (
              <div className="rounded-md border border-[var(--dxp-border)] bg-[var(--dxp-brand-light)] p-3 text-sm">
                <p className="font-semibold text-[var(--dxp-text)]">{preview.name}</p>
                <p className="text-xs text-[var(--dxp-text-secondary)]">
                  Live price:{' '}
                  <span className="font-mono font-bold text-[var(--dxp-brand-dark)]">
                    {preview.currency} {preview.price.toFixed(2)}
                  </span>
                </p>
              </div>
            )}

            {/* Quantity + Average price */}
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                  Quantity
                </label>
                <Input
                  type="number"
                  step="0.0001"
                  min="0"
                  {...register('quantity', { valueAsNumber: true })}
                />
                {errors.quantity && (
                  <p className="mt-1 text-xs text-rose-600">{errors.quantity.message}</p>
                )}
              </div>
              <div>
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                  Average price (₹)
                </label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  {...register('averagePrice', { valueAsNumber: true })}
                />
                <p className="mt-1 text-xs text-[var(--dxp-text-muted)]">
                  Per share purchase price in rupees.
                </p>
                {errors.averagePrice && (
                  <p className="mt-1 text-xs text-rose-600">{errors.averagePrice.message}</p>
                )}
              </div>
            </div>

            {/* Purchase date */}
            <div>
              <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                Purchase date
              </label>
              <Input type="date" {...register('purchaseDate')} />
              {errors.purchaseDate && (
                <p className="mt-1 text-xs text-rose-600">{errors.purchaseDate.message}</p>
              )}
            </div>

            {/* Notes */}
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

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <Button type="submit" variant="primary" disabled={isSaving}>
                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add stock
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => router.push('/investments/stocks')}
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
