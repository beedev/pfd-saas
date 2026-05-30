'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button, Input, Card, CardHeader, CardContent } from '@dxp/ui';
import { ShieldCheck, Loader2, Building, Banknote, Wallet } from 'lucide-react';

type PFType = 'EPF' | 'PPF' | 'VPF';

const TYPE_CARDS: Array<{ key: PFType; title: string; description: string; rate: string; Icon: typeof ShieldCheck }> = [
  { key: 'EPF', title: 'EPF', description: 'Employees Provident Fund (UAN)', rate: '8.15%', Icon: Building },
  { key: 'PPF', title: 'PPF', description: 'Public Provident Fund (15-year lock-in)', rate: '7.1%', Icon: Banknote },
  { key: 'VPF', title: 'VPF', description: 'Voluntary Provident Fund (top-up to EPF)', rate: '8.15%', Icon: Wallet },
];

const addYears = (iso: string, years: number) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
};

export default function NewPFPage() {
  const router = useRouter();
  const [type, setType] = useState<PFType | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [accountHolder, setAccountHolder] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [uan, setUan] = useState('');
  const [pan, setPan] = useState('');
  const [employeeBalance, setEmployeeBalance] = useState('');
  const [employerBalance, setEmployerBalance] = useState('');
  const [interestBalance, setInterestBalance] = useState('');
  const [totalBalance, setTotalBalance] = useState('');
  const [openingDate, setOpeningDate] = useState('');
  const [ppfMaturityDate, setPpfMaturityDate] = useState('');
  const [interestRate, setInterestRate] = useState('');
  const [notes, setNotes] = useState('');

  const computedTotal = useMemo(() => {
    const e = parseFloat(employeeBalance) || 0;
    const er = parseFloat(employerBalance) || 0;
    const i = parseFloat(interestBalance) || 0;
    return e + er + i;
  }, [employeeBalance, employerBalance, interestBalance]);

  const handleType = (t: PFType) => {
    setType(t);
    if (t === 'EPF') setInterestRate('8.15');
    else if (t === 'PPF') setInterestRate('7.1');
    else setInterestRate('8.15');
  };

  const handleOpeningDate = (iso: string) => {
    setOpeningDate(iso);
    if (type === 'PPF' && !ppfMaturityDate) {
      setPpfMaturityDate(addYears(iso, 15));
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!type) {
      toast.error('Pick a PF type');
      return;
    }
    if (!accountHolder || !openingDate) {
      toast.error('Account holder and opening date are required');
      return;
    }
    setIsSaving(true);
    try {
      const r = await fetch('/api/investments/pf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountType: type,
          accountHolder: accountHolder.trim(),
          accountNumber: accountNumber.trim() || undefined,
          uan: uan.trim() || undefined,
          pan: pan.trim().toUpperCase() || undefined,
          employeeBalanceRupees: parseFloat(employeeBalance) || 0,
          employerBalanceRupees: type === 'EPF' ? parseFloat(employerBalance) || 0 : 0,
          interestBalanceRupees: parseFloat(interestBalance) || 0,
          totalBalanceRupees: parseFloat(totalBalance) || computedTotal,
          openingDate,
          ppfMaturityDate: type === 'PPF' ? ppfMaturityDate || undefined : undefined,
          notes:
            [notes, interestRate ? `Interest rate: ${interestRate}%` : '']
              .filter(Boolean)
              .join(' · ') || undefined,
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to add PF account');
      }
      toast.success('PF account added');
      router.push('/investments/pf');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to add PF account';
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">Add Provident Fund</h1>
        <p className="text-[var(--dxp-text-secondary)]">Pick the PF type and enter balance details.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {TYPE_CARDS.map((tc) => {
          const active = type === tc.key;
          return (
            <button
              key={tc.key}
              type="button"
              onClick={() => handleType(tc.key)}
              className={`rounded-lg border-2 p-4 text-left transition-all ${
                active
                  ? 'border-[var(--dxp-brand)] bg-[var(--dxp-brand-light)] shadow-md'
                  : 'border-[var(--dxp-border)] bg-[var(--dxp-surface)] hover:border-[var(--dxp-brand)]/40'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <tc.Icon className={`h-5 w-5 ${active ? 'text-[var(--dxp-brand)]' : 'text-[var(--dxp-text-muted)]'}`} />
                <span className={`font-semibold ${active ? 'text-[var(--dxp-brand-dark)]' : 'text-[var(--dxp-text)]'}`}>
                  {tc.title}
                </span>
              </div>
              <p className="text-xs text-[var(--dxp-text-secondary)]">{tc.description}</p>
              <p className="mt-1 text-xs font-mono text-[var(--dxp-text-muted)]">~{tc.rate}</p>
            </button>
          );
        })}
      </div>

      {type && (
        <Card>
          <CardHeader>
            <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
              <ShieldCheck className="h-5 w-5 text-[var(--dxp-brand)]" />
              {type} details
            </h3>
            <p className="text-xs text-[var(--dxp-text-secondary)]">All amounts in rupees (₹).</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Account holder</label>
                  <Input value={accountHolder} onChange={(e) => setAccountHolder(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">PAN</label>
                  <Input value={pan} onChange={(e) => setPan(e.target.value.toUpperCase())} />
                </div>
                {type === 'EPF' || type === 'VPF' ? (
                  <div>
                    <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">UAN</label>
                    <Input value={uan} onChange={(e) => setUan(e.target.value)} />
                  </div>
                ) : null}
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Account number</label>
                  <Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Opening date</label>
                  <Input type="date" value={openingDate} onChange={(e) => handleOpeningDate(e.target.value)} />
                </div>
                {type === 'PPF' && (
                  <div>
                    <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Maturity date</label>
                    <Input type="date" value={ppfMaturityDate} onChange={(e) => setPpfMaturityDate(e.target.value)} />
                    <p className="mt-1 text-xs text-[var(--dxp-text-muted)]">Auto-computed (opening + 15y), editable</p>
                  </div>
                )}
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Employee balance (₹)</label>
                  <Input
                    type="number"
                    step="0.01"
                    value={employeeBalance}
                    onChange={(e) => setEmployeeBalance(e.target.value)}
                  />
                </div>
                {type === 'EPF' && (
                  <div>
                    <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Employer balance (₹)</label>
                    <Input
                      type="number"
                      step="0.01"
                      value={employerBalance}
                      onChange={(e) => setEmployerBalance(e.target.value)}
                    />
                  </div>
                )}
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Interest accrued (₹)</label>
                  <Input
                    type="number"
                    step="0.01"
                    value={interestBalance}
                    onChange={(e) => setInterestBalance(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Total balance (₹) — auto if blank
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder={`auto: ${computedTotal.toFixed(2)}`}
                    value={totalBalance}
                    onChange={(e) => setTotalBalance(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Interest rate (%)</label>
                  <Input
                    type="number"
                    step="0.01"
                    value={interestRate}
                    onChange={(e) => setInterestRate(e.target.value)}
                  />
                </div>
              </div>

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
                  Save PF account
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
