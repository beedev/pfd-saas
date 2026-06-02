'use client';

/**
 * Forex Deposits — create form (Sprint 5.10d).
 *
 * Currency dropdown lists the 12 most commonly held by Indian residents
 * abroad (NRE/NRI patterns) + an "Other (3-letter)" option for the long
 * tail. As the user types an amount, we resolve the live INR equivalent
 * via /api/investments/forex-deposits/live-rates so they can sanity-
 * check the conversion before saving.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';

import { Button, Card, CardHeader, CardContent, Input, Select } from '@dxp/ui';
import { ArrowLeft, Save, Loader2 } from 'lucide-react';

const COMMON_CURRENCIES: Array<{ label: string; value: string }> = [
  { label: 'USD — US Dollar', value: 'USD' },
  { label: 'EUR — Euro', value: 'EUR' },
  { label: 'GBP — British Pound', value: 'GBP' },
  { label: 'AED — UAE Dirham', value: 'AED' },
  { label: 'SGD — Singapore Dollar', value: 'SGD' },
  { label: 'AUD — Australian Dollar', value: 'AUD' },
  { label: 'CAD — Canadian Dollar', value: 'CAD' },
  { label: 'JPY — Japanese Yen', value: 'JPY' },
  { label: 'CHF — Swiss Franc', value: 'CHF' },
  { label: 'HKD — Hong Kong Dollar', value: 'HKD' },
  { label: 'SAR — Saudi Riyal', value: 'SAR' },
  { label: 'QAR — Qatari Riyal', value: 'QAR' },
  { label: '(other — type below)', value: '__OTHER__' },
];

const STATUS_OPTIONS = [
  { label: 'Active', value: 'ACTIVE' },
  { label: 'Matured', value: 'MATURED' },
  { label: 'Closed', value: 'CLOSED' },
];

export default function NewForexDepositPage() {
  const router = useRouter();
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [currencyPick, setCurrencyPick] = useState('USD');
  const [currencyCustom, setCurrencyCustom] = useState('');
  const [amount, setAmount] = useState('');
  const [interestRate, setInterestRate] = useState('');
  const [openingDate, setOpeningDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [maturityDate, setMaturityDate] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  // Live preview: rates fetched from server once, then reused for
  // every amount change. INR (already in INR) gets 1.0.
  const [rate, setRate] = useState<number | null>(null);
  const [rateLoading, setRateLoading] = useState(false);

  const activeCurrency =
    currencyPick === '__OTHER__' ? currencyCustom.toUpperCase() : currencyPick;
  const isValidCurrency = /^[A-Z]{3}$/.test(activeCurrency);

  // Fetch live rate whenever the active currency changes. We deliberately
  // hit the server endpoint (not Yahoo directly) so auth + caching stay
  // consistent with the rest of the app.
  useEffect(() => {
    if (!isValidCurrency) {
      setRate(null);
      return;
    }
    let cancelled = false;
    setRateLoading(true);
    fetch('/api/investments/forex-deposits/live-rates')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        // If the user holds none of this currency yet, the user-scoped
        // endpoint won't have it. Issue a one-shot probe via creating a
        // tiny dummy fetch — we just need a number. Fall back to null.
        const r = d.rates?.[activeCurrency];
        if (typeof r === 'number') setRate(r);
        else setRate(null);
      })
      .catch(() => setRate(null))
      .finally(() => {
        if (!cancelled) setRateLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeCurrency, isValidCurrency]);

  const amountNum = parseFloat(amount);
  const previewInr =
    Number.isFinite(amountNum) && amountNum > 0 && rate !== null
      ? amountNum * rate
      : null;

  const submit = async () => {
    if (!bankName.trim()) {
      toast.error('Bank name is required');
      return;
    }
    if (!isValidCurrency) {
      toast.error('Currency must be a 3-letter ISO code (e.g. USD)');
      return;
    }
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      toast.error('Amount must be a positive number');
      return;
    }
    if (!openingDate) {
      toast.error('Opening date is required');
      return;
    }
    setIsSaving(true);
    try {
      const body = {
        bankName,
        accountNumber: accountNumber || null,
        currencyCode: activeCurrency,
        amountInCurrency: amountNum,
        interestRate: interestRate ? Number(interestRate) : null,
        openingDate,
        maturityDate: maturityDate || null,
        status,
        notes: notes || null,
      };
      const r = await fetch('/api/investments/forex-deposits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || 'Save failed');
      toast.success('Forex deposit added');
      router.push('/investments/forex-deposits');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/investments/forex-deposits"
          className="inline-flex items-center text-sm text-[var(--dxp-text-secondary)] hover:text-[var(--dxp-brand)]"
        >
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to forex deposits
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
          Add forex deposit
        </h1>
        <p className="text-[var(--dxp-text-secondary)]">
          Foreign-currency balance with live INR conversion.
        </p>
      </div>

      <Card>
        <CardHeader>
          <h3 className="text-base font-bold text-[var(--dxp-text)]">Details</h3>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Bank / institution">
              <Input
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                placeholder="e.g. HDFC NRE, ENBD, Wise"
              />
            </Field>
            <Field label="Account number (optional)">
              <Input
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                placeholder="last 4 or full"
              />
            </Field>

            <Field label="Currency">
              <Select
                value={currencyPick}
                onChange={(v) => setCurrencyPick(v as string)}
                options={COMMON_CURRENCIES}
              />
              {currencyPick === '__OTHER__' && (
                <Input
                  className="mt-2"
                  value={currencyCustom}
                  onChange={(e) => setCurrencyCustom(e.target.value.toUpperCase())}
                  placeholder="3-letter ISO code (e.g. NZD)"
                  maxLength={3}
                />
              )}
            </Field>

            <Field label="Amount (foreign currency)">
              <Input
                type="number"
                step="0.0001"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 5000"
              />
              <p className="mt-1 text-xs text-[var(--dxp-text-muted)]">
                {rateLoading
                  ? 'Resolving live rate…'
                  : previewInr !== null
                    ? `≈ ₹${previewInr.toLocaleString('en-IN', {
                        maximumFractionDigits: 0,
                      })} at live rate ₹${rate!.toFixed(4)}/${activeCurrency}`
                    : isValidCurrency
                      ? 'Live rate not available yet — INR equivalent will resolve once saved.'
                      : 'Pick a 3-letter currency to preview the INR equivalent.'}
              </p>
            </Field>

            <Field label="Interest rate (% per year, optional)">
              <Input
                type="number"
                step="0.01"
                value={interestRate}
                onChange={(e) => setInterestRate(e.target.value)}
                placeholder="e.g. 4.0"
              />
            </Field>

            <Field label="Status">
              <Select
                value={status}
                onChange={(v) => setStatus(v as string)}
                options={STATUS_OPTIONS}
              />
            </Field>

            <Field label="Opening date">
              <Input
                type="date"
                value={openingDate}
                onChange={(e) => setOpeningDate(e.target.value)}
              />
            </Field>

            <Field label="Maturity date (optional)">
              <Input
                type="date"
                value={maturityDate}
                onChange={(e) => setMaturityDate(e.target.value)}
              />
            </Field>

            <div className="sm:col-span-2">
              <Field label="Notes">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="w-full rounded border border-[var(--dxp-border)] bg-[var(--dxp-surface)] p-2 text-sm text-[var(--dxp-text)] focus:border-[var(--dxp-brand)] focus:outline-none"
                />
              </Field>
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <Link href="/investments/forex-deposits">
              <Button variant="secondary" disabled={isSaving}>
                Cancel
              </Button>
            </Link>
            <Button variant="primary" onClick={submit} disabled={isSaving}>
              {isSaving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
        {label}
      </label>
      {children}
    </div>
  );
}
