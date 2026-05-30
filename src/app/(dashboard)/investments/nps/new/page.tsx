'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button, Input, Card, CardHeader, CardContent, Select } from '@dxp/ui';
import { Landmark, Loader2 } from 'lucide-react';

type Tier = 'TIER1' | 'TIER2';
type Scheme = 'LC25' | 'LC50' | 'LC75' | 'Active Choice';

const SCHEMES: Array<{ value: Scheme; label: string }> = [
  { value: 'LC25', label: 'LC25 (Conservative)' },
  { value: 'LC50', label: 'LC50 (Moderate)' },
  { value: 'LC75', label: 'LC75 (Aggressive)' },
  { value: 'Active Choice', label: 'Active Choice' },
];

export default function NewNPSPage() {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);

  const [accountNumber, setAccountNumber] = useState('');
  const [accountHolder, setAccountHolder] = useState('');
  const [pan, setPan] = useState('');
  const [tier, setTier] = useState<Tier>('TIER1');
  const [scheme, setScheme] = useState<Scheme>('LC50');
  const [totalValue, setTotalValue] = useState('');
  const [equityValue, setEquityValue] = useState('');
  const [debtValue, setDebtValue] = useState('');
  const [govtValue, setGovtValue] = useState('');
  const [altValue, setAltValue] = useState('');
  const [totalContributed, setTotalContributed] = useState('');
  const [employerContribution, setEmployerContribution] = useState('');
  const [openingDate, setOpeningDate] = useState('');
  const [notes, setNotes] = useState('');

  const splitSum = useMemo(() => {
    const e = parseFloat(equityValue) || 0;
    const d = parseFloat(debtValue) || 0;
    const g = parseFloat(govtValue) || 0;
    const a = parseFloat(altValue) || 0;
    return e + d + g + a;
  }, [equityValue, debtValue, govtValue, altValue]);

  const totalNum = parseFloat(totalValue) || 0;
  const splitMatches = totalNum === 0 || Math.abs(splitSum - totalNum) < 1;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountNumber || !accountHolder || !pan || !openingDate) {
      toast.error('Please fill all required fields');
      return;
    }
    if (!splitMatches) {
      toast.error('Equity + Debt + Govt + Alt must equal Total Value');
      return;
    }

    setIsSaving(true);
    try {
      const debtCombined = (parseFloat(debtValue) || 0) + (parseFloat(govtValue) || 0);
      const r = await fetch('/api/investments/nps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountNumber: accountNumber.trim(),
          accountHolder: accountHolder.trim(),
          pan: pan.trim().toUpperCase(),
          tier,
          scheme,
          totalValueRupees: totalNum,
          equityValueRupees: parseFloat(equityValue) || 0,
          debtValueRupees: debtCombined,
          alternativeValueRupees: parseFloat(altValue) || 0,
          totalContributedRupees: parseFloat(totalContributed) || 0,
          employerContributionRupees: parseFloat(employerContribution) || 0,
          openingDate,
          notes: notes || undefined,
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to add NPS account');
      }
      toast.success('NPS account added');
      router.push('/investments/nps');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to add NPS account';
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">Add NPS Account</h1>
        <p className="text-[var(--dxp-text-secondary)]">
          Track a National Pension System Tier I or Tier II account.
        </p>
      </div>

      <Card>
        <CardHeader>
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <Landmark className="h-5 w-5 text-[var(--dxp-brand)]" />
            NPS account details
          </h3>
          <p className="text-xs text-[var(--dxp-text-secondary)]">
            All amounts in rupees (₹). Stored internally as paisa.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">PRAN</label>
                <Input
                  placeholder="12-digit PRAN"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Account holder</label>
                <Input value={accountHolder} onChange={(e) => setAccountHolder(e.target.value)} />
              </div>
              <div>
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">PAN</label>
                <Input
                  placeholder="ABCDE1234F"
                  value={pan}
                  onChange={(e) => setPan(e.target.value.toUpperCase())}
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Opening date</label>
                <Input type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} />
              </div>
            </div>

            <div>
              <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-2">Tier</label>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setTier('TIER1')}
                  className={`flex-1 rounded-lg border-2 p-4 text-left transition-all ${
                    tier === 'TIER1'
                      ? 'border-[var(--dxp-brand)] bg-[var(--dxp-brand-light)]'
                      : 'border-[var(--dxp-border)] hover:border-[var(--dxp-brand)]/40'
                  }`}
                >
                  <p className="font-semibold text-[var(--dxp-text)]">Tier I</p>
                  <p className="text-xs text-[var(--dxp-text-secondary)]">Locked till retirement</p>
                </button>
                <button
                  type="button"
                  onClick={() => setTier('TIER2')}
                  className={`flex-1 rounded-lg border-2 p-4 text-left transition-all ${
                    tier === 'TIER2'
                      ? 'border-[var(--dxp-brand)] bg-[var(--dxp-brand-light)]'
                      : 'border-[var(--dxp-border)] hover:border-[var(--dxp-brand)]/40'
                  }`}
                >
                  <p className="font-semibold text-[var(--dxp-text)]">Tier II</p>
                  <p className="text-xs text-[var(--dxp-text-secondary)]">Flexible withdrawals</p>
                </button>
              </div>
            </div>

            <div>
              <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Scheme</label>
              <Select
                options={SCHEMES.map((s) => ({ value: s.value, label: s.label }))}
                value={scheme}
                onChange={(v) => setScheme(v as Scheme)}
              />
            </div>

            <div>
              <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Total current value (₹)</label>
              <Input
                type="number"
                step="0.01"
                value={totalValue}
                onChange={(e) => setTotalValue(e.target.value)}
              />
            </div>

            <div>
              <p className="text-sm font-semibold text-[var(--dxp-text)] mb-2">Allocation split</p>
              <div className="grid gap-3 md:grid-cols-4">
                <div>
                  <label className="text-xs text-[var(--dxp-text-muted)] block mb-1">Equity (₹)</label>
                  <Input type="number" step="0.01" value={equityValue} onChange={(e) => setEquityValue(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs text-[var(--dxp-text-muted)] block mb-1">Corp Debt (₹)</label>
                  <Input type="number" step="0.01" value={debtValue} onChange={(e) => setDebtValue(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs text-[var(--dxp-text-muted)] block mb-1">Govt Sec (₹)</label>
                  <Input type="number" step="0.01" value={govtValue} onChange={(e) => setGovtValue(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs text-[var(--dxp-text-muted)] block mb-1">Alt Invest (₹)</label>
                  <Input type="number" step="0.01" value={altValue} onChange={(e) => setAltValue(e.target.value)} />
                </div>
              </div>
              {!splitMatches && (
                <p className="mt-2 text-xs text-rose-600">
                  Split sum ₹{splitSum.toLocaleString('en-IN')} ≠ Total ₹{totalNum.toLocaleString('en-IN')}
                </p>
              )}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Total contributions so far (₹)</label>
                <Input
                  type="number"
                  step="0.01"
                  value={totalContributed}
                  onChange={(e) => setTotalContributed(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Employer contribution (₹, optional)</label>
                <Input
                  type="number"
                  step="0.01"
                  value={employerContribution}
                  onChange={(e) => setEmployerContribution(e.target.value)}
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
                Save NPS account
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
