'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
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
import { Loader2, Repeat } from 'lucide-react';

interface MutualFund {
  id: number;
  schemeName: string;
  nav: number;
  units: number;
  totalInvestment: number;
}

const sipSchema = z.object({
  mutualFundId: z.number({ message: 'Pick a fund' }).positive(),
  monthlyAmount: z.number({ message: 'Amount required' }).positive(),
  frequency: z.enum(['MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL']),
  startDate: z.string().min(1, 'Start date required'),
  endDate: z.string().optional(),
  hasStartingPosition: z.boolean(),
  startingUnits: z.number().min(0),
  startingNav: z.number().min(0),
  totalInvestedSoFar: z.number().min(0),
  notes: z.string().optional(),
});

type SipFormData = z.infer<typeof sipSchema>;

export default function NewSipPage() {
  const router = useRouter();
  const [funds, setFunds] = useState<MutualFund[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<SipFormData>({
    resolver: zodResolver(sipSchema),
    defaultValues: {
      mutualFundId: 0,
      monthlyAmount: 0,
      frequency: 'MONTHLY',
      startDate: new Date().toISOString().slice(0, 10),
      endDate: '',
      hasStartingPosition: false,
      startingUnits: 0,
      startingNav: 0,
      totalInvestedSoFar: 0,
      notes: '',
    },
  });

  const hasStarting = watch('hasStartingPosition');
  const mfId = watch('mutualFundId');

  useEffect(() => {
    fetch('/api/investments/mutual-funds')
      .then((r) => r.json())
      .then((d) => setFunds(d.mutualFunds || []))
      .catch(() => setFunds([]));
  }, []);

  // Auto-fill starting units/NAV from selected MF when toggling on
  useEffect(() => {
    if (!hasStarting || !mfId) return;
    const mf = funds.find((f) => f.id === mfId);
    if (mf) {
      setValue('startingUnits', mf.units);
      setValue('startingNav', mf.nav / 100);
      setValue('totalInvestedSoFar', mf.totalInvestment / 100);
    }
  }, [hasStarting, mfId, funds, setValue]);

  const onSubmit = async (data: SipFormData) => {
    setIsSaving(true);
    try {
      const payload = {
        mutualFundId: data.mutualFundId,
        monthlyAmount: data.monthlyAmount,
        frequency: data.frequency,
        startDate: data.startDate,
        endDate: data.endDate || undefined,
        startingUnits: data.hasStartingPosition ? data.startingUnits : 0,
        startingNav: data.hasStartingPosition ? data.startingNav : 0,
        totalInvestedSoFar: data.hasStartingPosition ? data.totalInvestedSoFar : 0,
        notes: data.notes,
      };
      const r = await fetch('/api/investments/sips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to register SIP');
      }
      const result = await r.json();
      toast.success('SIP registered');
      router.push(`/investments/sips/${result.sip.id}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to register SIP';
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">Register SIP</h1>
        <p className="text-[var(--dxp-text-secondary)]">
          Set up a systematic investment plan and (optionally) snapshot your existing position.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Schedule */}
        <Card>
          <CardHeader>
            <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
              <Repeat className="h-5 w-5 text-[var(--dxp-brand)]" />
              Schedule
            </h3>
          </CardHeader>
          <CardContent>
            <div className="space-y-5">
              <div>
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                  Mutual fund
                </label>
                {funds.length === 0 ? (
                  <div className="rounded-md border border-dashed border-[var(--dxp-border)] p-3 text-sm text-[var(--dxp-text-secondary)]">
                    No funds yet.{' '}
                    <Link
                      href="/investments/mutual-funds/new"
                      className="text-[var(--dxp-brand)] underline hover:no-underline"
                    >
                      Add a mutual fund first
                    </Link>
                    .
                  </div>
                ) : (
                  <Select
                    placeholder="Select a fund..."
                    options={funds.map((f) => ({
                      value: String(f.id),
                      label: f.schemeName,
                    }))}
                    value={mfId ? String(mfId) : ''}
                    onChange={(v) => setValue('mutualFundId', Number(v))}
                  />
                )}
                {errors.mutualFundId && (
                  <p className="mt-1 text-xs text-rose-600">{errors.mutualFundId.message}</p>
                )}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Monthly amount (₹)
                  </label>
                  <Input
                    type="number"
                    step="100"
                    min="0"
                    {...register('monthlyAmount', { valueAsNumber: true })}
                  />
                  {errors.monthlyAmount && (
                    <p className="mt-1 text-xs text-rose-600">{errors.monthlyAmount.message}</p>
                  )}
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Frequency
                  </label>
                  <Select
                    options={[
                      { value: 'MONTHLY', label: 'Monthly' },
                      { value: 'QUARTERLY', label: 'Quarterly' },
                      { value: 'SEMI_ANNUAL', label: 'Semi-annual' },
                      { value: 'ANNUAL', label: 'Annual' },
                    ]}
                    value={watch('frequency')}
                    onChange={(v) => setValue('frequency', v as SipFormData['frequency'])}
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Start date
                  </label>
                  <Input type="date" {...register('startDate')} />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    End date (optional)
                  </label>
                  <Input type="date" {...register('endDate')} />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Starting position */}
        <Card>
          <CardHeader>
            <h3 className="text-base font-bold text-[var(--dxp-text)]">Starting position</h3>
            <p className="text-xs text-[var(--dxp-text-secondary)]">
              Toggle on if you already have units in this fund — gives XIRR an accurate seed.
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <label className="flex items-center gap-2 text-sm text-[var(--dxp-text)]">
                <input type="checkbox" {...register('hasStartingPosition')} />
                I already have units in this fund
              </label>

              {hasStarting && (
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                      Current units
                    </label>
                    <Input
                      type="number"
                      step="0.001"
                      min="0"
                      {...register('startingUnits', { valueAsNumber: true })}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                      NAV at snapshot (₹)
                    </label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      {...register('startingNav', { valueAsNumber: true })}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                      Total invested so far (₹)
                    </label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      {...register('totalInvestedSoFar', { valueAsNumber: true })}
                    />
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Notes */}
        <Card>
          <CardHeader>
            <h3 className="text-base font-bold text-[var(--dxp-text)]">Notes</h3>
          </CardHeader>
          <CardContent>
            <textarea
              rows={3}
              placeholder="Any notes about this SIP"
              className="w-full rounded-md border border-[var(--dxp-border)] bg-[var(--dxp-surface)] px-3 py-2 text-sm text-[var(--dxp-text)] placeholder:text-[var(--dxp-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--dxp-brand)]"
              {...register('notes')}
            />
          </CardContent>
        </Card>

        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={isSaving || funds.length === 0}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Register SIP
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => router.push('/investments/sips')}
            disabled={isSaving}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
