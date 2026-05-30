'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';

import { Button, Input, Card, CardHeader, CardContent, Select } from '@dxp/ui';
import { Loader2, Users } from 'lucide-react';
import { CHIT_FOREMEN } from '@/lib/finance/chit-presets';

const chitSchema = z.object({
  foremanKey: z.string().min(1, 'Pick a foreman'),
  foremanNameOther: z.string().optional(),
  schemeName: z.string().min(1, 'Scheme name required'),
  registrationNumber: z.string().optional(),
  isRegistered: z.boolean(),
  chitValue: z.number({ message: 'Chit value required' }).positive(),
  durationMonths: z.number({ message: 'Duration required' }).positive(),
  monthlyInstallment: z.number({ message: 'Installment required' }).positive(),
  groupSize: z.number({ message: 'Group size required' }).positive(),
  ticketNumber: z.string().optional(),
  startDate: z.string().min(1, 'Start date required'),
  foremanCommissionPct: z.number().min(0).max(100),
  hasStartingPosition: z.boolean(),
  spInstallmentsPaid: z.number().min(0),
  spTotalPaid: z.number().min(0),
  spTotalDividends: z.number().min(0),
  spStatus: z.enum(['ACTIVE', 'WON', 'COMPLETED']),
  spWinMonth: z.number().min(0),
  spWinBidDiscountPct: z.number().min(0).max(100),
  spWinAmountReceived: z.number().min(0),
  notes: z.string().optional(),
});

type ChitFormData = z.infer<typeof chitSchema>;

function addMonthsIso(iso: string, months: number): string {
  if (!iso) return '';
  const d = new Date(iso);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

export default function NewChitFundPage() {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<ChitFormData>({
    resolver: zodResolver(chitSchema),
    defaultValues: {
      foremanKey: '',
      foremanNameOther: '',
      schemeName: '',
      registrationNumber: '',
      isRegistered: true,
      chitValue: 0,
      durationMonths: 20,
      monthlyInstallment: 0,
      groupSize: 20,
      ticketNumber: '',
      startDate: new Date().toISOString().slice(0, 10),
      foremanCommissionPct: 5,
      hasStartingPosition: false,
      spInstallmentsPaid: 0,
      spTotalPaid: 0,
      spTotalDividends: 0,
      spStatus: 'ACTIVE',
      spWinMonth: 0,
      spWinBidDiscountPct: 0,
      spWinAmountReceived: 0,
      notes: '',
    },
  });

  const foremanKey = watch('foremanKey');
  const chitValue = watch('chitValue');
  const durationMonths = watch('durationMonths');
  const startDate = watch('startDate');
  const hasStarting = watch('hasStartingPosition');
  const spStatus = watch('spStatus');

  // Auto-compute monthly installment from chit value / duration
  useEffect(() => {
    if (chitValue > 0 && durationMonths > 0) {
      const auto = Math.round(chitValue / durationMonths);
      setValue('monthlyInstallment', auto);
    }
  }, [chitValue, durationMonths, setValue]);

  // Keep group size == duration as a reasonable default
  useEffect(() => {
    if (durationMonths > 0) setValue('groupSize', durationMonths);
  }, [durationMonths, setValue]);

  const expectedEndDate = startDate && durationMonths ? addMonthsIso(startDate, durationMonths) : '';

  const onSubmit = async (data: ChitFormData) => {
    setIsSaving(true);
    try {
      const foreman = CHIT_FOREMEN.find((f) => f.key === data.foremanKey);
      const foremanName =
        data.foremanKey === 'other'
          ? (data.foremanNameOther?.trim() || 'Other')
          : (foreman?.name ?? data.foremanKey);

      const payload: Record<string, unknown> = {
        foremanName,
        schemeName: data.schemeName,
        registrationNumber: data.registrationNumber || undefined,
        isRegistered: data.isRegistered,
        chitValue: data.chitValue,
        monthlyInstallment: data.monthlyInstallment,
        durationMonths: data.durationMonths,
        groupSize: data.groupSize,
        ticketNumber: data.ticketNumber || undefined,
        startDate: data.startDate,
        foremanCommissionPct: data.foremanCommissionPct,
        notes: data.notes || undefined,
      };

      if (data.hasStartingPosition) {
        payload.startingPosition = {
          installmentsPaid: data.spInstallmentsPaid,
          totalPaid: data.spTotalPaid,
          totalDividends: data.spTotalDividends,
          status: data.spStatus,
          ...(data.spStatus === 'WON'
            ? {
                winMonth: data.spWinMonth,
                winBidDiscountPct: data.spWinBidDiscountPct,
                winAmountReceived: data.spWinAmountReceived || undefined,
              }
            : {}),
        };
      }

      const r = await fetch('/api/investments/chit-funds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to register chit fund');
      }
      const result = await r.json();
      toast.success('Chit fund registered');
      router.push(`/investments/chit-funds/${result.chitFund.id}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to register chit fund';
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">Register chit fund</h1>
        <p className="text-[var(--dxp-text-secondary)]">
          Add a chit subscription and (optionally) seed any installments already paid.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Scheme Details */}
        <Card>
          <CardHeader>
            <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
              <Users className="h-5 w-5 text-[var(--dxp-brand)]" />
              Scheme details
            </h3>
          </CardHeader>
          <CardContent>
            <div className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Foreman
                  </label>
                  <Select
                    placeholder="Select foreman..."
                    options={CHIT_FOREMEN.map((f) => ({ value: f.key, label: f.name }))}
                    value={foremanKey}
                    onChange={(v) => setValue('foremanKey', v)}
                  />
                  {errors.foremanKey && (
                    <p className="mt-1 text-xs text-rose-600">{errors.foremanKey.message}</p>
                  )}
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Scheme name
                  </label>
                  <Input placeholder="Fortune 10 Lakh" {...register('schemeName')} />
                  {errors.schemeName && (
                    <p className="mt-1 text-xs text-rose-600">{errors.schemeName.message}</p>
                  )}
                </div>
              </div>

              {foremanKey === 'other' && (
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Foreman name
                  </label>
                  <Input placeholder="Enter foreman name" {...register('foremanNameOther')} />
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Registration number (optional)
                  </label>
                  <Input placeholder="State chit licence" {...register('registrationNumber')} />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Ticket number (optional)
                  </label>
                  <Input placeholder="Your ticket" {...register('ticketNumber')} />
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-[var(--dxp-text)]">
                <input type="checkbox" {...register('isRegistered')} />
                This is a registered chit fund scheme
              </label>

              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Chit value (₹)
                  </label>
                  <Input
                    type="number"
                    step="1000"
                    min="0"
                    {...register('chitValue', { valueAsNumber: true })}
                  />
                  {errors.chitValue && (
                    <p className="mt-1 text-xs text-rose-600">{errors.chitValue.message}</p>
                  )}
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Duration (months)
                  </label>
                  <Input
                    type="number"
                    step="1"
                    min="1"
                    {...register('durationMonths', { valueAsNumber: true })}
                  />
                  {errors.durationMonths && (
                    <p className="mt-1 text-xs text-rose-600">{errors.durationMonths.message}</p>
                  )}
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Monthly installment (₹)
                  </label>
                  <Input
                    type="number"
                    step="100"
                    min="0"
                    {...register('monthlyInstallment', { valueAsNumber: true })}
                  />
                  <p className="mt-1 text-xs text-[var(--dxp-text-muted)]">
                    Auto: chit value ÷ duration
                  </p>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Group size
                  </label>
                  <Input
                    type="number"
                    step="1"
                    min="1"
                    {...register('groupSize', { valueAsNumber: true })}
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Start date
                  </label>
                  <Input type="date" {...register('startDate')} />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Expected end date
                  </label>
                  <Input type="text" value={expectedEndDate} readOnly />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Foreman commission %
                  </label>
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    {...register('foremanCommissionPct', { valueAsNumber: true })}
                  />
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
              Toggle on if this chit is already running — we&apos;ll seed the ledger so XIRR is accurate.
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <label className="flex items-center gap-2 text-sm text-[var(--dxp-text)]">
                <input type="checkbox" {...register('hasStartingPosition')} />
                This chit is already running
              </label>

              {hasStarting && (
                <>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div>
                      <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                        Installments already paid
                      </label>
                      <Input
                        type="number"
                        step="1"
                        min="0"
                        {...register('spInstallmentsPaid', { valueAsNumber: true })}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                        Total paid so far (₹)
                      </label>
                      <Input
                        type="number"
                        step="100"
                        min="0"
                        {...register('spTotalPaid', { valueAsNumber: true })}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                        Total dividends received (₹)
                      </label>
                      <Input
                        type="number"
                        step="100"
                        min="0"
                        {...register('spTotalDividends', { valueAsNumber: true })}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-2">
                      Current status
                    </label>
                    <div className="flex gap-4 text-sm text-[var(--dxp-text)]">
                      {(['ACTIVE', 'WON', 'COMPLETED'] as const).map((s) => (
                        <label key={s} className="flex items-center gap-2">
                          <input type="radio" value={s} {...register('spStatus')} />
                          {s}
                        </label>
                      ))}
                    </div>
                  </div>

                  {spStatus === 'WON' && (
                    <div className="grid gap-4 md:grid-cols-3">
                      <div>
                        <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                          Win month
                        </label>
                        <Input
                          type="number"
                          step="1"
                          min="1"
                          {...register('spWinMonth', { valueAsNumber: true })}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                          Bid discount %
                        </label>
                        <Input
                          type="number"
                          step="0.1"
                          min="0"
                          max="100"
                          {...register('spWinBidDiscountPct', { valueAsNumber: true })}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                          Amount received (₹, optional)
                        </label>
                        <Input
                          type="number"
                          step="100"
                          min="0"
                          {...register('spWinAmountReceived', { valueAsNumber: true })}
                        />
                        <p className="mt-1 text-xs text-[var(--dxp-text-muted)]">
                          Leave blank to auto-compute
                        </p>
                      </div>
                    </div>
                  )}
                </>
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
              placeholder="Any notes about this chit fund"
              className="w-full rounded-md border border-[var(--dxp-border)] bg-[var(--dxp-surface)] px-3 py-2 text-sm text-[var(--dxp-text)] placeholder:text-[var(--dxp-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--dxp-brand)]"
              {...register('notes')}
            />
          </CardContent>
        </Card>

        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Register chit fund
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => router.push('/investments/chit-funds')}
            disabled={isSaving}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
