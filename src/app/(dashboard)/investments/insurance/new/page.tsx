'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button, Input, Card, CardHeader, CardContent, Select } from '@dxp/ui';
import { Umbrella, Loader2 } from 'lucide-react';

type PolicyType =
  | 'TERM_LIFE'
  | 'WHOLE_LIFE'
  | 'ENDOWMENT'
  | 'ULIP'
  | 'HEALTH'
  | 'CRITICAL_ILLNESS'
  | 'DISABILITY'
  | 'ACCIDENT';

const TYPE_CARDS: Array<{ key: PolicyType; title: string; description: string }> = [
  { key: 'TERM_LIFE', title: 'Term Life', description: 'Pure protection, low premium' },
  { key: 'WHOLE_LIFE', title: 'Whole Life', description: 'Lifelong cover with cash value' },
  { key: 'ENDOWMENT', title: 'Endowment', description: 'Cover + maturity benefit' },
  { key: 'ULIP', title: 'ULIP', description: 'Insurance + investment' },
  { key: 'HEALTH', title: 'Health', description: 'Hospitalisation cover' },
  { key: 'CRITICAL_ILLNESS', title: 'Critical Illness', description: 'Lump-sum on diagnosis' },
  { key: 'DISABILITY', title: 'Disability', description: 'Income replacement' },
  { key: 'ACCIDENT', title: 'Personal Accident', description: 'Accidental injury / death' },
];

const CASH_VALUE_TYPES: PolicyType[] = ['WHOLE_LIFE', 'ENDOWMENT', 'ULIP'];

export default function NewInsurancePage() {
  const router = useRouter();
  const [type, setType] = useState<PolicyType | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [policyNumber, setPolicyNumber] = useState('');
  const [insurer, setInsurer] = useState('');
  const [policyName, setPolicyName] = useState('');
  const [policyHolder, setPolicyHolder] = useState('Self');
  const [sumAssured, setSumAssured] = useState('');
  const [premiumAmount, setPremiumAmount] = useState('');
  const [premiumFrequency, setPremiumFrequency] = useState('YEARLY');
  const [policyStartDate, setPolicyStartDate] = useState('');
  const [maturityDate, setMaturityDate] = useState('');
  const [policyTerm, setPolicyTerm] = useState('');
  const [investmentValue, setInvestmentValue] = useState('');
  const [maturityBenefit, setMaturityBenefit] = useState('');
  const [notes, setNotes] = useState('');

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!type) {
      toast.error('Pick a policy type');
      return;
    }
    if (!policyNumber || !insurer || !policyHolder || !policyStartDate) {
      toast.error('Please fill required fields');
      return;
    }
    setIsSaving(true);
    try {
      const r = await fetch('/api/investments/insurance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          policyNumber: policyNumber.trim(),
          policyType: type,
          policyHolder: policyHolder.trim(),
          insurer: insurer.trim(),
          policyName: policyName.trim() || undefined,
          sumAssuredRupees: parseFloat(sumAssured) || 0,
          premiumAmountRupees: parseFloat(premiumAmount) || 0,
          premiumFrequency,
          policyStartDate,
          maturityDate: maturityDate || undefined,
          policyTerm: parseInt(policyTerm) || undefined,
          investmentValueRupees: CASH_VALUE_TYPES.includes(type) ? parseFloat(investmentValue) || 0 : undefined,
          maturityBenefitRupees: CASH_VALUE_TYPES.includes(type) ? parseFloat(maturityBenefit) || 0 : undefined,
          notes: notes || undefined,
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to add policy');
      }
      toast.success('Policy added');
      router.push('/investments/insurance');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to add policy';
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">Add Insurance Policy</h1>
        <p className="text-[var(--dxp-text-secondary)]">Pick the policy type and enter the details.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {TYPE_CARDS.map((tc) => {
          const active = type === tc.key;
          return (
            <button
              key={tc.key}
              type="button"
              onClick={() => setType(tc.key)}
              className={`rounded-lg border-2 p-4 text-left transition-all ${
                active
                  ? 'border-[var(--dxp-brand)] bg-[var(--dxp-brand-light)] shadow-md'
                  : 'border-[var(--dxp-border)] bg-[var(--dxp-surface)] hover:border-[var(--dxp-brand)]/40'
              }`}
            >
              <p className={`font-semibold ${active ? 'text-[var(--dxp-brand-dark)]' : 'text-[var(--dxp-text)]'}`}>
                {tc.title}
              </p>
              <p className="text-xs text-[var(--dxp-text-secondary)] mt-1">{tc.description}</p>
            </button>
          );
        })}
      </div>

      {type && (
        <Card>
          <CardHeader>
            <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
              <Umbrella className="h-5 w-5 text-[var(--dxp-brand)]" />
              Policy details
            </h3>
            <p className="text-xs text-[var(--dxp-text-secondary)]">All amounts in rupees (₹).</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Policy number</label>
                  <Input value={policyNumber} onChange={(e) => setPolicyNumber(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Insurer</label>
                  <Input value={insurer} onChange={(e) => setInsurer(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Plan name</label>
                  <Input value={policyName} onChange={(e) => setPolicyName(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Policy holder</label>
                  <Select
                    options={[
                      { value: 'Self', label: 'Self' },
                      { value: 'Spouse', label: 'Spouse' },
                      { value: 'Child', label: 'Child' },
                      { value: 'Parent', label: 'Parent' },
                    ]}
                    value={policyHolder}
                    onChange={(v) => setPolicyHolder(v)}
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Sum assured (₹)</label>
                  <Input type="number" step="0.01" value={sumAssured} onChange={(e) => setSumAssured(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Premium amount (₹)</label>
                  <Input type="number" step="0.01" value={premiumAmount} onChange={(e) => setPremiumAmount(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Frequency</label>
                  <Select
                    options={[
                      { value: 'MONTHLY', label: 'Monthly' },
                      { value: 'QUARTERLY', label: 'Quarterly' },
                      { value: 'HALF_YEARLY', label: 'Half-yearly' },
                      { value: 'YEARLY', label: 'Yearly' },
                      { value: 'SINGLE', label: 'Single (one-time)' },
                    ]}
                    value={premiumFrequency}
                    onChange={(v) => setPremiumFrequency(v)}
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Policy term (years)</label>
                  <Input type="number" value={policyTerm} onChange={(e) => setPolicyTerm(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Start date</label>
                  <Input type="date" value={policyStartDate} onChange={(e) => setPolicyStartDate(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Maturity date</label>
                  <Input type="date" value={maturityDate} onChange={(e) => setMaturityDate(e.target.value)} />
                </div>
              </div>

              {CASH_VALUE_TYPES.includes(type) && (
                <div className="grid gap-4 md:grid-cols-2 rounded-lg border border-[var(--dxp-border-light)] p-4">
                  <div>
                    <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Current surrender value (₹)</label>
                    <Input type="number" step="0.01" value={investmentValue} onChange={(e) => setInvestmentValue(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">Expected maturity value (₹)</label>
                    <Input type="number" step="0.01" value={maturityBenefit} onChange={(e) => setMaturityBenefit(e.target.value)} />
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
                  Save policy
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
