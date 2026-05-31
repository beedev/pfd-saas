'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';

import { Button, Input, Card, CardHeader, CardContent, Select } from '@dxp/ui';
import { HeartPulse, Loader2, ArrowLeft } from 'lucide-react';

type HealthPolicyType =
  | 'INDIVIDUAL'
  | 'FAMILY_FLOATER'
  | 'TOPUP'
  | 'SUPER_TOPUP'
  | 'CRITICAL_ILLNESS'
  | 'OPD_RIDER';

const TYPE_CARDS: Array<{ key: HealthPolicyType; title: string; description: string }> = [
  { key: 'INDIVIDUAL', title: 'Individual', description: 'One person, dedicated sum insured' },
  { key: 'FAMILY_FLOATER', title: 'Family floater', description: 'Shared sum across the family' },
  { key: 'TOPUP', title: 'Top-up', description: 'Kicks in past a deductible' },
  { key: 'SUPER_TOPUP', title: 'Super top-up', description: 'Aggregate deductible over a year' },
  { key: 'CRITICAL_ILLNESS', title: 'Critical illness', description: 'Lump-sum on diagnosis' },
  { key: 'OPD_RIDER', title: 'OPD rider', description: 'Outpatient consults & diagnostics' },
];

export default function NewHealthInsurancePage() {
  const router = useRouter();
  const [type, setType] = useState<HealthPolicyType | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [insurer, setInsurer] = useState('');
  const [policyNumber, setPolicyNumber] = useState('');
  const [policyHolder, setPolicyHolder] = useState('');
  const [sumInsured, setSumInsured] = useState('');
  const [premium, setPremium] = useState('');
  const [premiumFrequency, setPremiumFrequency] = useState('ANNUAL');
  const [startDate, setStartDate] = useState('');
  const [renewalDate, setRenewalDate] = useState('');
  const [waitingPeriodMonths, setWaitingPeriodMonths] = useState('48');
  const [preExistingDiseases, setPreExistingDiseases] = useState('');
  const [cashlessAvailable, setCashlessAvailable] = useState(true);
  const [networkHospitalCount, setNetworkHospitalCount] = useState('');
  const [notes, setNotes] = useState('');

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!type) {
      toast.error('Pick a policy type');
      return;
    }
    if (!insurer.trim() || !policyNumber.trim() || !policyHolder.trim() || !startDate) {
      toast.error('Please fill insurer, policy number, holder and start date');
      return;
    }
    if (!sumInsured || !premium) {
      toast.error('Please enter sum insured and premium');
      return;
    }

    setIsSaving(true);
    try {
      const r = await fetch('/api/investments/health-insurance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          insurer: insurer.trim(),
          policyNumber: policyNumber.trim(),
          policyType: type,
          policyHolder: policyHolder.trim(),
          sumInsuredRupees: parseFloat(sumInsured) || 0,
          premiumRupees: parseFloat(premium) || 0,
          premiumFrequency,
          startDate,
          renewalDate: renewalDate || undefined,
          waitingPeriodMonths: waitingPeriodMonths ? parseInt(waitingPeriodMonths) : undefined,
          preExistingDiseases: preExistingDiseases.trim() || undefined,
          cashlessAvailable,
          networkHospitalCount: networkHospitalCount ? parseInt(networkHospitalCount) : undefined,
          notes: notes.trim() || undefined,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Failed to register policy');
      toast.success('Policy registered');
      const newId = data.policy?.id ?? data.id;
      if (newId) {
        router.push(`/investments/health-insurance/${newId}`);
      } else {
        router.push('/investments/health-insurance');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to register policy';
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/investments/health-insurance"
          className="inline-flex items-center text-sm text-[var(--dxp-text-secondary)] hover:text-[var(--dxp-brand)]"
        >
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to health insurance
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
          Register Health Policy
        </h1>
        <p className="text-[var(--dxp-text-secondary)]">
          Pick the policy type and enter the basics. You can add cards, claims and portability later.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
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
              <p
                className={`font-semibold ${
                  active ? 'text-[var(--dxp-brand-dark)]' : 'text-[var(--dxp-text)]'
                }`}
              >
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
              <HeartPulse className="h-5 w-5 text-[var(--dxp-brand)]" />
              Policy details
            </h3>
            <p className="text-xs text-[var(--dxp-text-secondary)]">All amounts in rupees (₹).</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Insurer
                  </label>
                  <Input
                    value={insurer}
                    onChange={(e) => setInsurer(e.target.value)}
                    placeholder="e.g. Star Health"
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Policy number
                  </label>
                  <Input
                    value={policyNumber}
                    onChange={(e) => setPolicyNumber(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Policy holder
                  </label>
                  <Input
                    value={policyHolder}
                    onChange={(e) => setPolicyHolder(e.target.value)}
                    placeholder="Name on policy"
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Sum insured (₹)
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    value={sumInsured}
                    onChange={(e) => setSumInsured(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Premium (₹)
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    value={premium}
                    onChange={(e) => setPremium(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Premium frequency
                  </label>
                  <Select
                    value={premiumFrequency}
                    onChange={(v) => setPremiumFrequency(v)}
                    options={[
                      { value: 'ANNUAL', label: 'Annual' },
                      { value: 'SEMI_ANNUAL', label: 'Semi-annual' },
                      { value: 'QUARTERLY', label: 'Quarterly' },
                      { value: 'MONTHLY', label: 'Monthly' },
                    ]}
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Start date
                  </label>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Renewal date
                  </label>
                  <Input
                    type="date"
                    value={renewalDate}
                    onChange={(e) => setRenewalDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Waiting period (months)
                  </label>
                  <Input
                    type="number"
                    value={waitingPeriodMonths}
                    onChange={(e) => setWaitingPeriodMonths(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Network hospital count
                  </label>
                  <Input
                    type="number"
                    value={networkHospitalCount}
                    onChange={(e) => setNetworkHospitalCount(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                  Pre-existing diseases
                </label>
                <textarea
                  value={preExistingDiseases}
                  onChange={(e) => setPreExistingDiseases(e.target.value)}
                  rows={2}
                  className="w-full rounded border border-[var(--dxp-border)] bg-[var(--dxp-surface)] p-2 text-sm text-[var(--dxp-text)] focus:border-[var(--dxp-brand)] focus:outline-none"
                  placeholder="e.g. Diabetes (declared), Hypertension"
                />
              </div>

              <label className="flex items-center gap-2 text-sm text-[var(--dxp-text)]">
                <input
                  type="checkbox"
                  checked={cashlessAvailable}
                  onChange={(e) => setCashlessAvailable(e.target.checked)}
                  className="h-4 w-4 rounded border-[var(--dxp-border)]"
                />
                Cashless available at network hospitals
              </label>

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
