'use client';

/**
 * Small Savings — registration form.
 *
 * Scheme selection up top as six cards. Picking one reveals the entry
 * form pre-filled with that scheme's govt-default interest rate and
 * compounding cadence. The lib at `@/lib/finance/small-savings` owns
 * the per-scheme rules; this page just calls into it for display
 * defaults so the user can see what they're getting before submission.
 *
 * Reads `?scheme=PPF` query param so deep-links from the empty-tab CTA
 * land directly on the right scheme card.
 */

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';

import { Button, Input, Card, CardHeader, CardContent, Select } from '@dxp/ui';
import {
  Landmark,
  Building2,
  FileText,
  Coins,
  Heart,
  UserCheck,
  Loader2,
  ArrowLeft,
} from 'lucide-react';

import {
  defaultInterestRate,
  maturityDate as computeMaturityDate,
} from '@/lib/finance/small-savings';

type SmallSavingsScheme = 'PPF' | 'VPF' | 'NSC' | 'KVP' | 'SSY' | 'SCSS';
type SmallSavingsStatus = 'ACTIVE' | 'MATURED' | 'CLOSED' | 'EXTENDED';
type InterestCompounding = 'YEARLY' | 'HALF_YEARLY' | 'QUARTERLY';

const SCHEME_CARDS: Array<{
  key: SmallSavingsScheme;
  title: string;
  tagline: string;
  lockIn: string;
  Icon: typeof Landmark;
}> = [
  {
    key: 'PPF',
    title: 'PPF',
    tagline: 'Public Provident Fund · 80C, EEE tax',
    lockIn: '15-year lock, extendable 5y blocks',
    Icon: Landmark,
  },
  {
    key: 'VPF',
    title: 'VPF',
    tagline: 'Voluntary PF on top of EPF · 80C',
    lockIn: 'Retirement-bound',
    Icon: Building2,
  },
  {
    key: 'NSC',
    title: 'NSC',
    tagline: 'National Savings Certificate · 80C',
    lockIn: '5-year term, interest at maturity',
    Icon: FileText,
  },
  {
    key: 'KVP',
    title: 'KVP',
    tagline: 'Kisan Vikas Patra · principal doubles',
    lockIn: '~115 months to double',
    Icon: Coins,
  },
  {
    key: 'SSY',
    title: 'SSY',
    tagline: 'Sukanya Samriddhi · girl child · 80C',
    lockIn: '21y or child age 18, whichever later',
    Icon: Heart,
  },
  {
    key: 'SCSS',
    title: 'SCSS',
    tagline: 'Senior Citizens · quarterly payout',
    lockIn: '5-year term, extendable 3y',
    Icon: UserCheck,
  },
];

const STATUS_OPTIONS: Array<{ label: string; value: SmallSavingsStatus }> = [
  { label: 'Active', value: 'ACTIVE' },
  { label: 'Matured', value: 'MATURED' },
  { label: 'Closed', value: 'CLOSED' },
  { label: 'Extended', value: 'EXTENDED' },
];

const COMPOUNDING_OPTIONS: Array<{ label: string; value: InterestCompounding }> = [
  { label: 'Yearly', value: 'YEARLY' },
  { label: 'Half-yearly', value: 'HALF_YEARLY' },
  { label: 'Quarterly', value: 'QUARTERLY' },
];

export default function NewSmallSavingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const presetScheme = searchParams.get('scheme') as SmallSavingsScheme | null;

  const [scheme, setScheme] = useState<SmallSavingsScheme | null>(
    presetScheme && SCHEME_CARDS.some((s) => s.key === presetScheme) ? presetScheme : null,
  );
  const [isSaving, setIsSaving] = useState(false);

  // Form fields. Strings throughout so HTML inputs round-trip cleanly;
  // parsed to numbers only on submit.
  const [accountNumber, setAccountNumber] = useState('');
  const [holderName, setHolderName] = useState('');
  const [holderDob, setHolderDob] = useState('');
  const [pan, setPan] = useState('');
  const [institution, setInstitution] = useState('');
  const [openingDate, setOpeningDate] = useState(new Date().toISOString().slice(0, 10));
  const [maturityDate, setMaturityDate] = useState('');
  const [lockInEndDate, setLockInEndDate] = useState('');
  const [currentBalance, setCurrentBalance] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [interestRate, setInterestRate] = useState('');
  const [compounding, setCompounding] = useState<InterestCompounding>('YEARLY');
  const [totalDeposited, setTotalDeposited] = useState('');
  const [totalInterest, setTotalInterest] = useState('0');
  const [status, setStatus] = useState<SmallSavingsStatus>('ACTIVE');
  const [notes, setNotes] = useState('');

  // When a scheme is picked, populate per-scheme defaults: rate,
  // compounding, and an initial maturity computed from opening date.
  // This is a side-effect rather than direct state so the user can
  // pick a scheme, then change opening date, and have maturity track
  // both inputs.
  useEffect(() => {
    if (!scheme) return;
    setInterestRate(defaultInterestRate(scheme).toString());
    setCompounding(scheme === 'SCSS' ? 'QUARTERLY' : 'YEARLY');
  }, [scheme]);

  // Recompute maturity whenever opening date / DOB / scheme changes
  // and the user hasn't manually overridden it.
  useEffect(() => {
    if (!scheme || !openingDate) return;
    const dob = scheme === 'SSY' ? holderDob : undefined;
    if (scheme === 'SSY' && !dob) return; // wait for DOB
    const computed = computeMaturityDate(scheme, openingDate, dob);
    setMaturityDate(computed);
    setLockInEndDate(computed);
  }, [scheme, openingDate, holderDob]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scheme) {
      toast.error('Pick a scheme');
      return;
    }
    if (!accountNumber.trim() || !holderName.trim() || !openingDate) {
      toast.error('Account number, holder, and opening date are required');
      return;
    }
    if (scheme === 'SSY' && !holderDob) {
      toast.error("Child's DOB is required for SSY");
      return;
    }
    if (!currentBalance) {
      toast.error('Current balance is required');
      return;
    }

    setIsSaving(true);
    try {
      const body = {
        schemeType: scheme,
        accountNumber: accountNumber.trim(),
        holderName: holderName.trim(),
        holderDob: holderDob || undefined,
        pan: pan.trim() || undefined,
        institution: institution.trim() || undefined,
        openingDate,
        maturityDate: maturityDate || undefined,
        depositAmountRupees: depositAmount ? parseFloat(depositAmount) : undefined,
        currentBalanceRupees: parseFloat(currentBalance) || 0,
        interestRatePercent: interestRate ? parseFloat(interestRate) : undefined,
        interestCompounding: compounding,
        lockInEndDate: lockInEndDate || undefined,
        totalDepositedRupees: totalDeposited ? parseFloat(totalDeposited) : undefined,
        totalInterestRupees: totalInterest ? parseFloat(totalInterest) : 0,
        status,
        notes: notes.trim() || undefined,
      };
      const r = await fetch('/api/investments/small-savings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Failed to register account');
      toast.success('Account registered');
      const newId = data.account?.id;
      if (newId) {
        router.push(`/investments/small-savings/${newId}`);
      } else {
        router.push('/investments/small-savings');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to register account';
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/investments/small-savings"
          className="inline-flex items-center text-sm text-[var(--dxp-text-secondary)] hover:text-[var(--dxp-brand)]"
        >
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to small savings
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
          Add Small Savings Account
        </h1>
        <p className="text-[var(--dxp-text-secondary)]">
          Pick the scheme, then fill in the basics. Defaults track the FY 2025-26 govt rates.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {SCHEME_CARDS.map((sc) => {
          const active = scheme === sc.key;
          const Icon = sc.Icon;
          const rate = defaultInterestRate(sc.key);
          return (
            <button
              key={sc.key}
              type="button"
              onClick={() => setScheme(sc.key)}
              className={`rounded-lg border-2 p-4 text-left transition-all ${
                active
                  ? 'border-[var(--dxp-brand)] bg-[var(--dxp-brand-light)] shadow-md'
                  : 'border-[var(--dxp-border)] bg-[var(--dxp-surface)] hover:border-[var(--dxp-brand)]/40'
              }`}
            >
              <div className="flex items-start gap-3">
                <Icon
                  className={`h-6 w-6 ${
                    active ? 'text-[var(--dxp-brand-dark)]' : 'text-[var(--dxp-brand)]'
                  }`}
                />
                <div className="flex-1">
                  <p
                    className={`font-semibold ${
                      active ? 'text-[var(--dxp-brand-dark)]' : 'text-[var(--dxp-text)]'
                    }`}
                  >
                    {sc.title}
                    <span className="ml-2 text-xs font-mono text-[var(--dxp-text-secondary)]">
                      {rate.toFixed(2)}%
                    </span>
                  </p>
                  <p className="text-xs text-[var(--dxp-text-secondary)] mt-1">{sc.tagline}</p>
                  <p className="text-xs text-[var(--dxp-text-muted)] mt-1">{sc.lockIn}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {scheme && (
        <Card>
          <CardHeader>
            <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
              <Landmark className="h-5 w-5 text-[var(--dxp-brand)]" />
              {scheme} details
            </h3>
            <p className="text-xs text-[var(--dxp-text-secondary)]">All amounts in rupees (₹).</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Account number
                  </label>
                  <Input
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value)}
                    placeholder="e.g. 0345001234567"
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Holder name {scheme === 'SSY' && '(child)'}
                  </label>
                  <Input
                    value={holderName}
                    onChange={(e) => setHolderName(e.target.value)}
                  />
                </div>
                {scheme === 'SSY' && (
                  <div>
                    <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                      Child&apos;s DOB
                    </label>
                    <Input
                      type="date"
                      value={holderDob}
                      onChange={(e) => setHolderDob(e.target.value)}
                    />
                  </div>
                )}
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    PAN (optional)
                  </label>
                  <Input value={pan} onChange={(e) => setPan(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Institution
                  </label>
                  <Input
                    value={institution}
                    onChange={(e) => setInstitution(e.target.value)}
                    placeholder="Bank / Post Office branch"
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Opening date
                  </label>
                  <Input
                    type="date"
                    value={openingDate}
                    onChange={(e) => setOpeningDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Maturity date
                  </label>
                  <Input
                    type="date"
                    value={maturityDate}
                    onChange={(e) => setMaturityDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Lock-in end
                  </label>
                  <Input
                    type="date"
                    value={lockInEndDate}
                    onChange={(e) => setLockInEndDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Current balance (₹)
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    value={currentBalance}
                    onChange={(e) => setCurrentBalance(e.target.value)}
                    placeholder="What's in the account today"
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Regular deposit (₹/mo)
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    placeholder="Monthly equivalent, optional"
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Interest rate (%)
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    value={interestRate}
                    onChange={(e) => setInterestRate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Compounding
                  </label>
                  <Select
                    value={compounding}
                    onChange={(v) => setCompounding(v as InterestCompounding)}
                    options={COMPOUNDING_OPTIONS}
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Total deposited so far (₹)
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    value={totalDeposited}
                    onChange={(e) => setTotalDeposited(e.target.value)}
                    placeholder="Defaults to current balance"
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Total interest earned (₹)
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    value={totalInterest}
                    onChange={(e) => setTotalInterest(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Status
                  </label>
                  <Select
                    value={status}
                    onChange={(v) => setStatus(v as SmallSavingsStatus)}
                    options={STATUS_OPTIONS}
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
                  Save account
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
