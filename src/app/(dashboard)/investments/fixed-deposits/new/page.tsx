'use client';

/**
 * Add Fixed Deposit — registration form with live maturity preview.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button, Input, Card, CardHeader, CardContent, Select } from '@dxp/ui';
import { PiggyBank, Loader2 } from 'lucide-react';

import { calculateFdMaturityPaisa, monthsBetween } from '@/lib/finance/fd';
import type { FDCompoundingFreq, FDInterestType } from '@/db/schema';

const COMPOUNDING_OPTIONS: Array<{ value: FDCompoundingFreq; label: string }> = [
  { value: 'QUARTERLY', label: 'Quarterly (most banks)' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'HALF_YEARLY', label: 'Half-yearly' },
  { value: 'YEARLY', label: 'Yearly' },
];

const INTEREST_TYPE_OPTIONS: Array<{ value: FDInterestType; label: string }> = [
  { value: 'CUMULATIVE', label: 'Cumulative (paid at maturity)' },
  { value: 'NON_CUMULATIVE', label: 'Non-cumulative (periodic payout)' },
];

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

export default function NewFixedDepositPage() {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);

  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [principal, setPrincipal] = useState('');
  const [interestRate, setInterestRate] = useState('');
  const [compoundingFreq, setCompoundingFreq] =
    useState<FDCompoundingFreq>('QUARTERLY');
  const [interestType, setInterestType] = useState<FDInterestType>('CUMULATIVE');
  const [startDate, setStartDate] = useState('');
  const [maturityDate, setMaturityDate] = useState('');
  const [maturityAmount, setMaturityAmount] = useState('');
  const [isTaxSaver, setIsTaxSaver] = useState(false);
  const [autoRenew, setAutoRenew] = useState(false);
  const [jointHolderName, setJointHolderName] = useState('');
  const [notes, setNotes] = useState('');

  // Live preview: computed maturity from the principal + rate + dates.
  const computed = useMemo(() => {
    const p = parseFloat(principal);
    const r = parseFloat(interestRate);
    if (!Number.isFinite(p) || p <= 0) return null;
    if (!Number.isFinite(r) || r <= 0) return null;
    if (!startDate || !maturityDate) return null;
    if (new Date(maturityDate) <= new Date(startDate)) return null;
    const tenureMonths = monthsBetween(startDate, maturityDate);
    if (tenureMonths <= 0) return null;
    const matPaisa = calculateFdMaturityPaisa(
      Math.round(p * 100),
      r,
      tenureMonths,
      compoundingFreq,
      interestType,
    );
    return {
      tenureMonths,
      maturityPaisa: matPaisa,
      interestPaisa: matPaisa - Math.round(p * 100),
    };
  }, [principal, interestRate, startDate, maturityDate, compoundingFreq, interestType]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bankName.trim()) {
      toast.error('Bank name required');
      return;
    }
    if (!principal || parseFloat(principal) <= 0) {
      toast.error('Principal must be > 0');
      return;
    }
    if (!interestRate || parseFloat(interestRate) <= 0) {
      toast.error('Interest rate must be > 0');
      return;
    }
    if (!startDate || !maturityDate) {
      toast.error('Start and maturity dates required');
      return;
    }
    if (new Date(maturityDate) <= new Date(startDate)) {
      toast.error('Maturity must be after start date');
      return;
    }

    setIsSaving(true);
    try {
      const r = await fetch('/api/investments/fixed-deposits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bankName: bankName.trim(),
          accountNumber: accountNumber.trim() || undefined,
          principal: parseFloat(principal),
          interestRate: parseFloat(interestRate),
          compoundingFreq,
          interestType,
          startDate,
          maturityDate,
          maturityAmount: maturityAmount ? parseFloat(maturityAmount) : undefined,
          isTaxSaver,
          autoRenew,
          jointHolderName: jointHolderName.trim() || undefined,
          notes: notes || undefined,
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to add FD');
      }
      toast.success('Fixed deposit added');
      router.push('/investments/fixed-deposits');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add FD');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
          Add Fixed Deposit
        </h1>
        <p className="text-[var(--dxp-text-secondary)]">
          Bank, principal, rate, and dates. Maturity value auto-computes.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
              <PiggyBank className="h-5 w-5 text-[var(--dxp-brand)]" />
              FD details
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
              <Field label="Principal (₹) *">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={principal}
                  onChange={(e) => setPrincipal(e.target.value)}
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
                  placeholder="7.10"
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
              <Field label="Maturity date *">
                <Input
                  type="date"
                  value={maturityDate}
                  onChange={(e) => setMaturityDate(e.target.value)}
                  required
                />
              </Field>
              <Field label="Compounding">
                <Select
                  value={compoundingFreq}
                  onChange={(v) => setCompoundingFreq(v as FDCompoundingFreq)}
                  options={COMPOUNDING_OPTIONS}
                />
              </Field>
              <Field label="Interest type">
                <Select
                  value={interestType}
                  onChange={(v) => setInterestType(v as FDInterestType)}
                  options={INTEREST_TYPE_OPTIONS}
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
                    checked={isTaxSaver}
                    onChange={(e) => setIsTaxSaver(e.target.checked)}
                    className="h-4 w-4"
                  />
                  Tax-saver (80C, 5-year lock)
                </label>
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
                Computed at {compoundingFreq.toLowerCase().replace('_', '-')} compounding.
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Stat
                  label="Tenure"
                  value={`${computed.tenureMonths} months`}
                  sub={`${(computed.tenureMonths / 12).toFixed(1)} years`}
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
                  sub={`${((computed.interestPaisa / (parseFloat(principal) * 100)) * 100).toFixed(1)}% absolute`}
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
            Add fixed deposit
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
