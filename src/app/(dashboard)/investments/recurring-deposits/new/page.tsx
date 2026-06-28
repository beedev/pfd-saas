'use client';

/**
 * Add Recurring Deposit — registration form with live maturity preview.
 * Tenure is entered in months; maturity date is derived from start + tenure.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button, Input, Card, CardHeader, CardContent, Select } from '@dxp/ui';
import { Repeat, Loader2 } from 'lucide-react';

import {
  calculateRdMaturityPaisa,
  rdTotalDepositPaisa,
  addMonthsIso,
} from '@/lib/finance/rd';
import type { RDCompoundingFreq } from '@/db/schema';

const COMPOUNDING_OPTIONS: Array<{ value: RDCompoundingFreq; label: string }> = [
  { value: 'QUARTERLY', label: 'Quarterly (most banks)' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'HALF_YEARLY', label: 'Half-yearly' },
  { value: 'YEARLY', label: 'Yearly' },
];

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export default function NewRecurringDepositPage() {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);

  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [monthlyInstallment, setMonthlyInstallment] = useState('');
  const [interestRate, setInterestRate] = useState('');
  const [tenureMonths, setTenureMonths] = useState('');
  const [compoundingFreq, setCompoundingFreq] = useState<RDCompoundingFreq>('QUARTERLY');
  const [startDate, setStartDate] = useState('');
  const [maturityAmount, setMaturityAmount] = useState('');
  const [autoRenew, setAutoRenew] = useState(false);
  const [jointHolderName, setJointHolderName] = useState('');
  const [notes, setNotes] = useState('');

  // Live preview: maturity from installment + rate + tenure.
  const computed = useMemo(() => {
    const inst = parseFloat(monthlyInstallment);
    const r = parseFloat(interestRate);
    const n = parseInt(tenureMonths, 10);
    if (!Number.isFinite(inst) || inst <= 0) return null;
    if (!Number.isFinite(r) || r <= 0) return null;
    if (!Number.isInteger(n) || n <= 0) return null;
    if (!startDate) return null;
    const instPaisa = Math.round(inst * 100);
    const matPaisa = calculateRdMaturityPaisa(instPaisa, r, n, compoundingFreq);
    const depositPaisa = rdTotalDepositPaisa(instPaisa, n);
    return {
      tenureMonths: n,
      maturityDate: addMonthsIso(startDate, n),
      totalDepositPaisa: depositPaisa,
      maturityPaisa: matPaisa,
      interestPaisa: matPaisa - depositPaisa,
    };
  }, [monthlyInstallment, interestRate, tenureMonths, startDate, compoundingFreq]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bankName.trim()) {
      toast.error('Bank name required');
      return;
    }
    if (!monthlyInstallment || parseFloat(monthlyInstallment) <= 0) {
      toast.error('Monthly installment must be > 0');
      return;
    }
    if (!interestRate || parseFloat(interestRate) <= 0) {
      toast.error('Interest rate must be > 0');
      return;
    }
    const n = parseInt(tenureMonths, 10);
    if (!Number.isInteger(n) || n <= 0) {
      toast.error('Tenure (months) must be a positive whole number');
      return;
    }
    if (!startDate) {
      toast.error('Start date required');
      return;
    }

    setIsSaving(true);
    try {
      const r = await fetch('/api/investments/recurring-deposits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bankName: bankName.trim(),
          accountNumber: accountNumber.trim() || undefined,
          monthlyInstallment: parseFloat(monthlyInstallment),
          interestRate: parseFloat(interestRate),
          tenureMonths: n,
          compoundingFreq,
          startDate,
          maturityAmount: maturityAmount ? parseFloat(maturityAmount) : undefined,
          autoRenew,
          jointHolderName: jointHolderName.trim() || undefined,
          notes: notes || undefined,
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to add RD');
      }
      toast.success('Recurring deposit added');
      router.push('/investments/recurring-deposits');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add RD');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
          Add Recurring Deposit
        </h1>
        <p className="text-[var(--dxp-text-secondary)]">
          Monthly installment, rate, and tenure. Maturity value auto-computes.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
              <Repeat className="h-5 w-5 text-[var(--dxp-brand)]" />
              RD details
            </h3>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Bank *">
                <Input
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  placeholder="HDFC Bank"
                  required
                />
              </Field>
              <Field label="Account / receipt no.">
                <Input
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  placeholder="optional"
                />
              </Field>
              <Field label="Monthly installment (₹) *">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={monthlyInstallment}
                  onChange={(e) => setMonthlyInstallment(e.target.value)}
                  placeholder="5000"
                  required
                />
              </Field>
              <Field label="Interest rate (% p.a.) *">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={interestRate}
                  onChange={(e) => setInterestRate(e.target.value)}
                  placeholder="7.00"
                  required
                />
              </Field>
              <Field label="Tenure (months) *">
                <Input
                  type="number"
                  step="1"
                  min="1"
                  value={tenureMonths}
                  onChange={(e) => setTenureMonths(e.target.value)}
                  placeholder="36"
                  required
                />
              </Field>
              <Field label="Start date *">
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                />
              </Field>
              <Field label="Compounding">
                <Select
                  value={compoundingFreq}
                  onChange={(v) => setCompoundingFreq(v as RDCompoundingFreq)}
                  options={COMPOUNDING_OPTIONS}
                />
              </Field>
              <Field label="Maturity amount (₹) — override">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={maturityAmount}
                  onChange={(e) => setMaturityAmount(e.target.value)}
                  placeholder={
                    computed ? (computed.maturityPaisa / 100).toFixed(0) : 'auto-computed'
                  }
                />
              </Field>
              <Field label="Joint holder">
                <Input
                  value={jointHolderName}
                  onChange={(e) => setJointHolderName(e.target.value)}
                  placeholder="optional"
                />
              </Field>
              <div className="flex items-center gap-4 sm:col-span-2">
                <label className="flex items-center gap-2 text-sm text-[var(--dxp-text)]">
                  <input
                    type="checkbox"
                    checked={autoRenew}
                    onChange={(e) => setAutoRenew(e.target.checked)}
                    className="h-4 w-4"
                  />
                  Auto-renew on maturity
                </label>
              </div>
              <Field label="Notes" full>
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="optional"
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        {computed && (
          <Card>
            <CardHeader>
              <h3 className="text-base font-bold text-[var(--dxp-text)]">Maturity preview</h3>
              <p className="text-xs text-[var(--dxp-text-muted)]">
                Matures {fmtDate(computed.maturityDate)} ·{' '}
                {compoundingFreq.toLowerCase().replace('_', '-')} compounding. Interest is added to
                tax in the maturity financial year.
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Stat
                  label="Total deposited"
                  value={formatINR(computed.totalDepositPaisa)}
                  sub={`${computed.tenureMonths} installments`}
                />
                <Stat
                  label="Maturity value"
                  value={formatINR(computed.maturityPaisa)}
                  sub="paid at maturity date"
                  positive
                />
                <Stat
                  label="Interest earned"
                  value={formatINR(computed.interestPaisa)}
                  sub={
                    computed.totalDepositPaisa > 0
                      ? `${((computed.interestPaisa / computed.totalDepositPaisa) * 100).toFixed(1)}% absolute`
                      : ''
                  }
                />
              </div>
            </CardContent>
          </Card>
        )}

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
            Add recurring deposit
          </Button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
        {label}
      </label>
      {children}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  positive,
}: {
  label: string;
  value: string;
  sub: string;
  positive?: boolean;
}) {
  return (
    <div className="rounded border border-[var(--dxp-border-light)] bg-[var(--dxp-surface)] p-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
        {label}
      </p>
      <p
        className={`mt-1 font-mono text-lg font-bold ${
          positive ? 'text-emerald-700' : 'text-[var(--dxp-text)]'
        }`}
      >
        {value}
      </p>
      <p className="text-[10px] text-[var(--dxp-text-muted)]">{sub}</p>
    </div>
  );
}
