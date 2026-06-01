'use client';

import { useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button, Card, CardHeader, CardContent, Input, Select } from '@dxp/ui';
import { Loader2 } from 'lucide-react';
import { ALL_SECTIONS, SECTION_CAPS, getCurrentFinancialYear } from '@/lib/finance/tax-constants';

const PAYMENT_METHODS = ['CASH', 'CHEQUE', 'NEFT', 'UPI', 'CARD'];

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-[var(--dxp-text)]">{label}</label>
      {children}
    </div>
  );
}

export default function NewDeductionPage() {
  const router = useRouter();
  const [section, setSection] = useState<string>('80C');
  const [description, setDescription] = useState('');
  const [amountRupees, setAmountRupees] = useState<string>('');
  const [paymentDate, setPaymentDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState<string>('NEFT');
  const [financialYear, setFinancialYear] = useState<string>(getCurrentFinancialYear());
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  // Sprint 5.1c — 80D bucket selector
  const [eightyDBucket, setEightyDBucket] = useState<'SELF_FAMILY' | 'PARENTS'>('SELF_FAMILY');

  const submit = async () => {
    if (!amountRupees) {
      toast.error('Amount is required');
      return;
    }
    setIsSaving(true);
    try {
      const r = await fetch('/api/tax/deductions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section,
          description: description || SECTION_CAPS[section as keyof typeof SECTION_CAPS]?.label,
          amountRupees: Number(amountRupees),
          paymentDate,
          paymentMethod,
          financialYear,
          notes,
          ...(section === '80D' ? { eightyDBucket } : {}),
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'Failed');
      toast.success('Deduction added');
      router.push('/tax');
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setIsSaving(false);
    }
  };

  const sectionOpts = ALL_SECTIONS.map((s) => ({ value: s, label: SECTION_CAPS[s].label }));
  const pmOpts = PAYMENT_METHODS.map((p) => ({ value: p, label: p }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">Add Deduction</h1>
        <p className="text-[var(--dxp-text-secondary)]">Record a tax-deductible payment</p>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <h3 className="text-base font-bold text-[var(--dxp-text)]">Deduction details</h3>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Field label="Section">
              <Select options={sectionOpts} value={section} onChange={setSection} />
            </Field>
            {section === '80D' && (
              <Field label="80D bucket">
                <Select
                  options={[
                    { value: 'SELF_FAMILY', label: 'Self + family (₹25k / ₹50k sr citizen)' },
                    { value: 'PARENTS', label: 'Parents (₹25k / ₹50k if parents are sr citizen)' },
                  ]}
                  value={eightyDBucket}
                  onChange={(v) => setEightyDBucket(v as 'SELF_FAMILY' | 'PARENTS')}
                />
              </Field>
            )}
            <Field label="Description">
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. ELSS SIP, PPF contribution, etc."
              />
            </Field>
            <Field label="Amount (INR)">
              <Input
                type="number"
                value={amountRupees}
                onChange={(e) => setAmountRupees(e.target.value)}
                placeholder="50000"
              />
            </Field>
            <Field label="Payment Date">
              <Input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
              />
            </Field>
            <Field label="Payment Method">
              <Select options={pmOpts} value={paymentMethod} onChange={setPaymentMethod} />
            </Field>
            <Field label="Financial Year">
              <Input
                value={financialYear}
                onChange={(e) => setFinancialYear(e.target.value)}
                placeholder="2026-27"
              />
            </Field>
            <Field label="Notes">
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional"
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Link href="/tax">
                <Button variant="secondary">Cancel</Button>
              </Link>
              <Button variant="primary" onClick={submit} disabled={isSaving}>
                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
