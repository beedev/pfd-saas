'use client';
export const dynamic = "force-dynamic";

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';

const CATEGORIES = [
  { value: 'CONSULTING', label: 'Consulting / Professional fees (194J)' },
  { value: 'INTEREST', label: 'Interest income (194A)' },
  { value: 'RENT', label: 'Rent (194-IB / 194-I)' },
  { value: 'PROPERTY', label: 'Property purchase (194-IA)' },
  { value: 'OTHER', label: 'Other' },
] as const;

const DEFAULT_SECTION: Record<string, string> = {
  CONSULTING: '194J',
  INTEREST: '194A',
  RENT: '194-IB',
  PROPERTY: '194-IA',
  OTHER: '',
};

export default function NewTdsPage() {
  return <Suspense fallback={<div className="p-6 text-gray-400">Loading…</div>}><Inner /></Suspense>;
}

function Inner() {
  const router = useRouter();
  const sp = useSearchParams();
  const fy = sp.get('fy') ?? '2025-26';

  const [category, setCategory] = useState<string>('CONSULTING');
  const [deductorName, setDeductorName] = useState('');
  const [deductorTan, setDeductorTan] = useState('');
  const [deductorPan, setDeductorPan] = useState('');
  const [section, setSection] = useState(DEFAULT_SECTION.CONSULTING);
  const [incomeRupees, setIncomeRupees] = useState('');
  const [tdsRupees, setTdsRupees] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const onCategoryChange = (v: string) => {
    setCategory(v);
    setSection(DEFAULT_SECTION[v] ?? '');
  };

  const submit = async () => {
    if (!deductorName) {
      toast.error('Deductor name required');
      return;
    }
    if (!deductorTan && !deductorPan) {
      toast.error('Provide either TAN or PAN of the deductor');
      return;
    }
    if (!section) {
      toast.error('Section required');
      return;
    }
    const inc = Number(incomeRupees);
    const tds = Number(tdsRupees);
    if (!inc || !tds) {
      toast.error('Income and TDS amounts required');
      return;
    }
    setSaving(true);
    try {
      const r = await fetch('/api/tax/itr3/tds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          financialYear: fy,
          category,
          deductorName: deductorName.trim(),
          deductorTan: deductorTan.trim() || null,
          deductorPan: deductorPan.trim() || null,
          section: section.trim(),
          incomeRupees: inc,
          tdsRupees: tds,
          notes: notes || null,
        }),
      });
      if (!r.ok) {
        const d = await r.json();
        throw new Error(d?.error || 'Failed');
      }
      toast.success('Saved');
      router.push(`/tax/itr3/tds?fy=${fy}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-4">
      <Link href={`/tax/itr3/tds?fy=${fy}`} className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline">
        <ArrowLeft className="h-3 w-3" /> TDS list
      </Link>
      <h1 className="text-2xl font-bold text-gray-900">Add TDS Credit — FY {fy}</h1>

      <div className="rounded-lg border bg-white p-4 space-y-3">
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-gray-700">Category</label>
          <select
            value={category}
            onChange={(e) => onCategoryChange(e.target.value)}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
        <Field label="Deductor name" value={deductorName} onChange={setDeductorName} />
        <Field
          label="Deductor TAN (10-char) — leave blank for property TDS"
          value={deductorTan}
          onChange={setDeductorTan}
          placeholder="e.g. DELE12345A"
        />
        <Field
          label="Deductor PAN (only if TDS via PAN, e.g. property u/s 194-IA)"
          value={deductorPan}
          onChange={setDeductorPan}
          placeholder="e.g. ABCDE1234F"
        />
        <Field label="Section" value={section} onChange={setSection} placeholder="e.g. 194J" />
        <Field label="Income chargeable (₹)" value={incomeRupees} onChange={setIncomeRupees} type="number" />
        <Field label="TDS deducted (₹)" value={tdsRupees} onChange={setTdsRupees} type="number" />
        <Field label="Notes (optional)" value={notes} onChange={setNotes} />

        <div className="flex justify-end gap-2 pt-2">
          <Link href={`/tax/itr3/tds?fy=${fy}`}>
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

function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-gray-700">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-blue-500"
      />
    </div>
  );
}
