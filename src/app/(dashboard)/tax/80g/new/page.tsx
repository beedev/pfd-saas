'use client';

import { useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button, Card, CardHeader, CardContent, Input, Select } from '@dxp/ui';
import { Loader2, Upload } from 'lucide-react';
import { getCurrentFinancialYear } from '@/lib/finance/tax-constants';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-[var(--dxp-text)]">{label}</label>
      {children}
    </div>
  );
}

const QUAL_PCT_OPTS = [
  { value: '100', label: '100%' },
  { value: '50', label: '50%' },
];

const LIMIT_OPTS = [
  { value: 'false', label: 'Without upper limit' },
  { value: 'true', label: 'With upper limit (10% GTI)' },
];

const PM_OPTS = ['CASH', 'CHEQUE', 'NEFT', 'UPI', 'CARD'].map((v) => ({ value: v, label: v }));

export default function New80GDonationPage() {
  const router = useRouter();
  const [recipientName, setRecipientName] = useState('');
  const [recipientPan, setRecipientPan] = useState('');
  const [recipient80gNumber, setRecipient80gNumber] = useState('');
  const [qualifyingPercent, setQualifyingPercent] = useState('100');
  const [hasUpperLimit, setHasUpperLimit] = useState('false');
  const [amountRupees, setAmountRupees] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState('NEFT');
  const [notes, setNotes] = useState('');
  const [receipt, setReceipt] = useState<File | null>(null);
  const [certificate, setCertificate] = useState<File | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const fy = getCurrentFinancialYear();

  const submit = async () => {
    if (!recipientName) {
      toast.error('Recipient name required');
      return;
    }
    if (!amountRupees) {
      toast.error('Amount required');
      return;
    }
    const amount = Number(amountRupees);
    if (amount > 2000 && !recipientPan) {
      toast.error('PAN is required for donations above ₹2,000');
      return;
    }
    setIsSaving(true);
    try {
      const r = await fetch('/api/tax/deductions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section: '80G',
          description: `Donation to ${recipientName}`,
          amountRupees: amount,
          paymentDate,
          paymentMethod,
          recipientName,
          recipientPan: recipientPan || null,
          recipient80gNumber: recipient80gNumber || null,
          qualifyingPercent: Number(qualifyingPercent),
          hasUpperLimit: hasUpperLimit === 'true',
          financialYear: fy,
          notes,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'Failed');
      const { deduction } = await r.json();

      // Upload files if any
      const uploads: Promise<Response>[] = [];
      for (const [file, cat] of [
        [receipt, 'DONATION_RECEIPT'],
        [certificate, '80G_CERTIFICATE'],
      ] as const) {
        if (!file) continue;
        const fd = new FormData();
        fd.append('file', file);
        fd.append('category', cat);
        fd.append('financialYear', fy);
        fd.append('title', `${recipientName} — ${cat}`);
        fd.append('deductionId', String(deduction.id));
        uploads.push(fetch('/api/tax/documents', { method: 'POST', body: fd }));
      }
      await Promise.all(uploads);

      toast.success('Donation recorded');
      router.push('/tax/80g');
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">Add 80G Donation</h1>
        <p className="text-[var(--dxp-text-secondary)]">Charitable contribution for FY {fy}</p>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <h3 className="text-base font-bold text-[var(--dxp-text)]">Donation details</h3>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Field label="Recipient Name">
              <Input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} />
            </Field>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Recipient PAN">
                <Input value={recipientPan} onChange={(e) => setRecipientPan(e.target.value.toUpperCase())} placeholder="ABCDE1234F" />
              </Field>
              <Field label="80G Certificate Number">
                <Input value={recipient80gNumber} onChange={(e) => setRecipient80gNumber(e.target.value)} />
              </Field>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Qualifying %">
                <Select options={QUAL_PCT_OPTS} value={qualifyingPercent} onChange={setQualifyingPercent} />
              </Field>
              <Field label="Upper Limit">
                <Select options={LIMIT_OPTS} value={hasUpperLimit} onChange={setHasUpperLimit} />
              </Field>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Amount (INR)">
                <Input type="number" value={amountRupees} onChange={(e) => setAmountRupees(e.target.value)} />
              </Field>
              <Field label="Payment Date">
                <Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
              </Field>
            </div>
            <Field label="Payment Method">
              <Select options={PM_OPTS} value={paymentMethod} onChange={setPaymentMethod} />
            </Field>
            <Field label="Notes">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
            </Field>

            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Donation Receipt (PDF/JPG)">
                <div className="rounded border border-dashed border-[var(--dxp-border)] p-3 text-sm">
                  <input
                    type="file"
                    accept="application/pdf,image/*"
                    onChange={(e) => setReceipt(e.target.files?.[0] || null)}
                    className="text-xs"
                  />
                  {receipt && <p className="mt-1 text-xs text-[var(--dxp-text-muted)]">{receipt.name}</p>}
                </div>
              </Field>
              <Field label="80G Certificate (PDF/JPG)">
                <div className="rounded border border-dashed border-[var(--dxp-border)] p-3 text-sm">
                  <input
                    type="file"
                    accept="application/pdf,image/*"
                    onChange={(e) => setCertificate(e.target.files?.[0] || null)}
                    className="text-xs"
                  />
                  {certificate && <p className="mt-1 text-xs text-[var(--dxp-text-muted)]">{certificate.name}</p>}
                </div>
              </Field>
            </div>

            <div className="flex justify-end gap-2">
              <Link href="/tax/80g">
                <Button variant="secondary">Cancel</Button>
              </Link>
              <Button variant="primary" onClick={submit} disabled={isSaving}>
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                Save donation
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
