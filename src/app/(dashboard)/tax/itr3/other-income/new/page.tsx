'use client';
export const dynamic = "force-dynamic";

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';

const SOURCES = [
  { value: 'BANK_INTEREST', label: 'Bank savings interest' },
  { value: 'FD_INTEREST', label: 'Fixed deposit interest' },
  { value: 'PF_INTEREST', label: 'PF interest (taxable portion)' },
  { value: 'DIVIDEND', label: 'Dividend income' },
  { value: 'OTHER', label: 'Other' },
];

export default function NewOtherIncomePage() {
  return <Suspense fallback={<div className="p-6 text-gray-400">Loading…</div>}><Inner /></Suspense>;
}

function Inner() {
  const router = useRouter();
  const sp = useSearchParams();
  const fy = sp.get('fy') ?? '2025-26';

  const [source, setSource] = useState('BANK_INTEREST');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!description) {
      toast.error('Description required');
      return;
    }
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      toast.error('Amount required');
      return;
    }
    setSaving(true);
    try {
      const r = await fetch('/api/tax/itr3/other-income', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          financialYear: fy,
          source,
          description: description.trim(),
          amountRupees: amt,
          notes: notes || null,
        }),
      });
      if (!r.ok) {
        const d = await r.json();
        throw new Error(d?.error || 'Failed');
      }
      toast.success('Saved');
      router.push(`/tax/itr3/other-income?fy=${fy}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-4">
      <Link href={`/tax/itr3/other-income?fy=${fy}`} className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline">
        <ArrowLeft className="h-3 w-3" /> Other income list
      </Link>
      <h1 className="text-2xl font-bold text-gray-900">Add Other Source Income — FY {fy}</h1>

      <div className="rounded-lg border bg-white p-4 space-y-3">
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-gray-700">Source</label>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            {SOURCES.map((s) => (<option key={s.value} value={s.value}>{s.label}</option>))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-gray-700">Description</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. SBI savings account, HDFC FD #12345"
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-gray-700">Amount (₹)</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-gray-700">Notes (optional)</label>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Link href={`/tax/itr3/other-income?fy=${fy}`}>
            <button className="rounded border px-3 py-1.5 text-sm hover:bg-gray-50">Cancel</button>
          </Link>
          <button
            onClick={submit}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-3 w-3 animate-spin" />}
            <Save className="h-3 w-3" /> Save
          </button>
        </div>
      </div>
    </div>
  );
}
