'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button, Input, Card, CardHeader, CardContent } from '@dxp/ui';
import { Loader2, CreditCard, Home, Car, GraduationCap, Banknote, MoreHorizontal } from 'lucide-react';
import { calculateEmi } from '@/lib/finance/emi';

type LiabilityType = 'HOME_LOAN' | 'AUTO_LOAN' | 'PERSONAL_LOAN' | 'CREDIT_CARD' | 'EDUCATION_LOAN' | 'OTHER';

const TYPE_CARDS: Array<{ key: LiabilityType; title: string; description: string; group: 'LOAN' | 'CARD'; Icon: typeof Home }> = [
  { key: 'HOME_LOAN', title: 'Home Loan', description: 'Housing loan with EMI', group: 'LOAN', Icon: Home },
  { key: 'AUTO_LOAN', title: 'Car / Auto Loan', description: 'Vehicle financing', group: 'LOAN', Icon: Car },
  { key: 'PERSONAL_LOAN', title: 'Personal Loan', description: 'Unsecured personal credit', group: 'LOAN', Icon: Banknote },
  { key: 'EDUCATION_LOAN', title: 'Education Loan', description: 'Student loan', group: 'LOAN', Icon: GraduationCap },
  { key: 'OTHER', title: 'Other Loan', description: 'Gold loan, business loan, etc.', group: 'LOAN', Icon: MoreHorizontal },
  { key: 'CREDIT_CARD', title: 'Credit Card', description: 'Revolving credit', group: 'CARD', Icon: CreditCard },
];

export default function NewLiabilityPage() {
  const router = useRouter();
  const [type, setType] = useState<LiabilityType | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Common
  const [name, setName] = useState('');
  const [creditorName, setCreditorName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [startDate, setStartDate] = useState('');
  const [notes, setNotes] = useState('');

  // Loan
  const [principal, setPrincipal] = useState('');
  const [outstanding, setOutstanding] = useState('');
  const [interestRate, setInterestRate] = useState('');
  const [tenureMonths, setTenureMonths] = useState('');
  const [remainingMonths, setRemainingMonths] = useState('');

  // Card
  const [creditLimit, setCreditLimit] = useState('');
  const [currentBalance, setCurrentBalance] = useState('');
  const [minimumDue, setMinimumDue] = useState('');
  const [totalDue, setTotalDue] = useState('');
  const [statementDay, setStatementDay] = useState('');
  const [dueDay, setDueDay] = useState('');

  const computedEmi = useMemo(() => {
    const p = parseFloat(principal) || 0;
    const r = parseFloat(interestRate) || 0;
    const n = parseInt(tenureMonths) || 0;
    return calculateEmi(p, r, n);
  }, [principal, interestRate, tenureMonths]);

  const isCard = type === 'CREDIT_CARD';

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!type) {
      toast.error('Pick a liability type');
      return;
    }
    if (!creditorName || !startDate) {
      toast.error('Lender and start date are required');
      return;
    }
    setIsSaving(true);
    try {
      const r = await fetch('/api/investments/liabilities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          name: name.trim() || undefined,
          creditorName: creditorName.trim(),
          productName: name.trim() || undefined,
          accountNumber: accountNumber.trim() || undefined,
          startDate,
          interestRate: parseFloat(interestRate) || 0,
          ...(isCard
            ? {
                creditLimitRupees: parseFloat(creditLimit) || 0,
                currentBalanceRupees: parseFloat(currentBalance) || 0,
                totalDueRupees: parseFloat(totalDue) || parseFloat(currentBalance) || 0,
                minimumDueRupees: parseFloat(minimumDue) || 0,
                statementDate: statementDay || undefined,
                dueDate: dueDay || undefined,
              }
            : {
                originalAmountRupees: parseFloat(principal) || 0,
                currentBalanceRupees: parseFloat(outstanding) || 0,
                monthlyEmiRupees: computedEmi,
                remainingTenor: parseInt(remainingMonths) || parseInt(tenureMonths) || undefined,
              }),
          notes: notes || undefined,
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to add liability');
      }
      toast.success('Liability added');
      router.push('/investments/liabilities');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to add liability';
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  };

  const loans = TYPE_CARDS.filter((t) => t.group === 'LOAN');
  const cards = TYPE_CARDS.filter((t) => t.group === 'CARD');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">Add Liability</h1>
        <p className="text-[var(--dxp-text-secondary)]">Track a loan or credit card.</p>
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold text-[var(--dxp-text-muted)] uppercase tracking-wide">Loans</p>
        <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-5">
          {loans.map((tc) => {
            const active = type === tc.key;
            return (
              <button
                key={tc.key}
                type="button"
                onClick={() => setType(tc.key)}
                className={`rounded-lg border-2 p-3 text-left transition-all ${
                  active
                    ? 'border-[var(--dxp-brand)] bg-[var(--dxp-brand-light)] shadow-md'
                    : 'border-[var(--dxp-border)] bg-[var(--dxp-surface)] hover:border-[var(--dxp-brand)]/40'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <tc.Icon className={`h-4 w-4 ${active ? 'text-[var(--dxp-brand)]' : 'text-[var(--dxp-text-muted)]'}`} />
                  <span className={`text-sm font-semibold ${active ? 'text-[var(--dxp-brand-dark)]' : 'text-[var(--dxp-text)]'}`}>
                    {tc.title}
                  </span>
                </div>
                <p className="text-xs text-[var(--dxp-text-secondary)]">{tc.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold text-[var(--dxp-text-muted)] uppercase tracking-wide">Cards</p>
        <div className="grid gap-3 md:grid-cols-3">
          {cards.map((tc) => {
            const active = type === tc.key;
            return (
              <button
                key={tc.key}
                type="button"
                onClick={() => setType(tc.key)}
                className={`rounded-lg border-2 p-3 text-left transition-all ${
                  active
                    ? 'border-[var(--dxp-brand)] bg-[var(--dxp-brand-light)] shadow-md'
                    : 'border-[var(--dxp-border)] bg-[var(--dxp-surface)] hover:border-[var(--dxp-brand)]/40'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <tc.Icon className={`h-4 w-4 ${active ? 'text-[var(--dxp-brand)]' : 'text-[var(--dxp-text-muted)]'}`} />
                  <span className={`text-sm font-semibold ${active ? 'text-[var(--dxp-brand-dark)]' : 'text-[var(--dxp-text)]'}`}>
                    {tc.title}
                  </span>
                </div>
                <p className="text-xs text-[var(--dxp-text-secondary)]">{tc.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      {type && (
        <Card>
          <CardHeader>
            <h3 className="text-base font-bold text-[var(--dxp-text)]">
              {TYPE_CARDS.find((t) => t.key === type)?.title} details
            </h3>
            <p className="text-xs text-[var(--dxp-text-secondary)]">All amounts in rupees (₹).</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Lender</label>
                  <Input value={creditorName} onChange={(e) => setCreditorName(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Product name {isCard ? '(card name)' : '(loan name)'}
                  </label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    {isCard ? 'Last 4 digits' : 'Account / Loan number'}
                  </label>
                  <Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Start date</label>
                  <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
              </div>

              {isCard ? (
                <div className="grid gap-4 md:grid-cols-2 rounded-lg border border-[var(--dxp-border-light)] p-4">
                  <div>
                    <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Credit limit (₹)</label>
                    <Input type="number" step="0.01" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Current balance (₹)</label>
                    <Input type="number" step="0.01" value={currentBalance} onChange={(e) => setCurrentBalance(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Total due (₹)</label>
                    <Input type="number" step="0.01" value={totalDue} onChange={(e) => setTotalDue(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Minimum due (₹)</label>
                    <Input type="number" step="0.01" value={minimumDue} onChange={(e) => setMinimumDue(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Statement day (1-31)</label>
                    <Input type="number" min="1" max="31" value={statementDay} onChange={(e) => setStatementDay(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Due day (1-31)</label>
                    <Input type="number" min="1" max="31" value={dueDay} onChange={(e) => setDueDay(e.target.value)} />
                  </div>
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 rounded-lg border border-[var(--dxp-border-light)] p-4">
                  <div>
                    <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Principal (₹)</label>
                    <Input type="number" step="0.01" value={principal} onChange={(e) => setPrincipal(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Current outstanding (₹)</label>
                    <Input type="number" step="0.01" value={outstanding} onChange={(e) => setOutstanding(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Interest rate (%)</label>
                    <Input type="number" step="0.01" value={interestRate} onChange={(e) => setInterestRate(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Tenure (months)</label>
                    <Input type="number" value={tenureMonths} onChange={(e) => setTenureMonths(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Months remaining</label>
                    <Input type="number" value={remainingMonths} onChange={(e) => setRemainingMonths(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Auto EMI (₹)</label>
                    <p className="font-mono text-lg font-bold text-[var(--dxp-text)]">
                      ₹{computedEmi.toLocaleString('en-IN')}
                    </p>
                    <p className="text-xs text-[var(--dxp-text-muted)]">From P, r, n via standard EMI formula</p>
                  </div>
                </div>
              )}

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
                  Save liability
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
