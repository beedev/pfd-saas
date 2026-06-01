'use client';
export const dynamic = "force-dynamic";

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';

export default function NewSalaryPage() {
  return <Suspense fallback={<div className="p-6 text-gray-400">Loading…</div>}><Inner /></Suspense>;
}

function Inner() {
  const router = useRouter();
  const sp = useSearchParams();
  const fy = sp.get('fy') ?? '2025-26';

  const [employerName, setEmployerName] = useState('');
  const [employerTan, setEmployerTan] = useState('');
  const [grossSalary, setGrossSalary] = useState('');
  const [exemptions, setExemptions] = useState('');
  const [section16, setSection16] = useState('50000');
  const [taxableSalary, setTaxableSalary] = useState('');
  const [tdsAmount, setTdsAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Sprint 5.1a — salary components for HRA + 80C math
  const [showComponents, setShowComponents] = useState(false);
  const [basic, setBasic] = useState('');
  const [da, setDa] = useState('');
  const [hraReceived, setHraReceived] = useState('');
  const [lta, setLta] = useState('');
  const [conveyance, setConveyance] = useState('');
  const [childrenEd, setChildrenEd] = useState('');
  const [medical, setMedical] = useState('');
  const [otherAllowances, setOtherAllowances] = useState('');
  const [rentPaidMonthly, setRentPaidMonthly] = useState('');

  const componentSum =
    (Number(basic) || 0) +
    (Number(da) || 0) +
    (Number(hraReceived) || 0) +
    (Number(lta) || 0) +
    (Number(conveyance) || 0) +
    (Number(childrenEd) || 0) +
    (Number(medical) || 0) +
    (Number(otherAllowances) || 0);

  // Auto-derive taxable if user fills gross/exemptions/section16 but not taxable
  const autoTaxable = (() => {
    const g = Number(grossSalary) || 0;
    const e = Number(exemptions) || 0;
    const s = Number(section16) || 0;
    return Math.max(0, g - e - s);
  })();

  const submit = async () => {
    if (!employerName || !employerTan) {
      toast.error('Employer name and TAN are required');
      return;
    }
    const g = Number(grossSalary);
    const t = Number(taxableSalary || autoTaxable);
    if (!g || g <= 0) {
      toast.error('Gross salary required');
      return;
    }
    setSaving(true);
    try {
      const r = await fetch('/api/tax/itr3/salary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          financialYear: fy,
          employerName: employerName.trim(),
          employerTan: employerTan.trim().toUpperCase(),
          grossSalaryRupees: g,
          exemptionsRupees: Number(exemptions) || 0,
          section16Rupees: Number(section16) || 0,
          taxableSalaryRupees: t,
          tdsRupees: Number(tdsAmount) || 0,
          notes: notes || null,
          // Sprint 5.1a — salary components (zero defaults are safe)
          basicRupees: Number(basic) || 0,
          daRupees: Number(da) || 0,
          hraReceivedRupees: Number(hraReceived) || 0,
          ltaRupees: Number(lta) || 0,
          conveyanceRupees: Number(conveyance) || 0,
          childrenEdAllowanceRupees: Number(childrenEd) || 0,
          medicalRupees: Number(medical) || 0,
          otherAllowancesRupees: Number(otherAllowances) || 0,
          rentPaidMonthlyRupees: Number(rentPaidMonthly) || 0,
        }),
      });
      if (!r.ok) {
        const d = await r.json();
        throw new Error(d?.error || 'Failed');
      }
      toast.success('Saved');
      router.push(`/tax/itr3/salary?fy=${fy}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-4">
      <Link href={`/tax/itr3/salary?fy=${fy}`} className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline">
        <ArrowLeft className="h-3 w-3" /> Salary list
      </Link>
      <h1 className="text-2xl font-bold text-gray-900">Add Form 16 — FY {fy}</h1>

      <div className="rounded-lg border bg-white p-4 space-y-3">
        <Field label="Employer name" value={employerName} onChange={setEmployerName} />
        <Field label="Employer TAN (e.g. DELE12345A)" value={employerTan} onChange={setEmployerTan} placeholder="10-character TAN" />
        <Field label="Gross salary (₹)" value={grossSalary} onChange={setGrossSalary} type="number" />
        <Field
          label="Exemptions u/s 10 (HRA, LTA, etc.) (₹)"
          value={exemptions}
          onChange={setExemptions}
          type="number"
          hint="From Form 16 Part B"
        />
        <Field
          label="Section 16 deductions (Std deduction + prof tax) (₹)"
          value={section16}
          onChange={setSection16}
          type="number"
          hint="Standard deduction = ₹50,000 (FY 24-25 onwards: ₹75,000 under new regime)"
        />
        <Field
          label={`Taxable salary (₹) — auto: ${autoTaxable.toLocaleString('en-IN')}`}
          value={taxableSalary}
          onChange={setTaxableSalary}
          type="number"
          hint="Leave blank to use auto = gross − exemptions − section 16"
        />
        <Field label="TDS deducted (₹)" value={tdsAmount} onChange={setTdsAmount} type="number" />
        <Field label="Notes (optional)" value={notes} onChange={setNotes} />

        {/* Sprint 5.1a — salary components (collapsible) */}
        <div className="border-t pt-3">
          <button
            type="button"
            onClick={() => setShowComponents(!showComponents)}
            className="text-xs font-semibold text-blue-600 hover:underline"
          >
            {showComponents ? '▾' : '▸'} Salary breakdown (needed for HRA exemption + sec 80 limits)
          </button>
          {showComponents && (
            <div className="mt-3 space-y-3 rounded border border-blue-100 bg-blue-50/30 p-3">
              <p className="text-[11px] text-gray-600">
                Enter values from Form 16 Part B. The HRA exemption math needs Basic + DA + HRA + rent paid.
                Component sum: <strong className="font-mono">₹{componentSum.toLocaleString('en-IN')}</strong>
                {componentSum > 0 && Number(grossSalary) > 0 && componentSum !== Number(grossSalary) && (
                  <span className="ml-2 text-amber-700">
                    (differs from gross ₹{Number(grossSalary).toLocaleString('en-IN')} — check entries)
                  </span>
                )}
              </p>
              <Field label="Basic salary (₹)" value={basic} onChange={setBasic} type="number" />
              <Field label="Dearness Allowance / DA (₹)" value={da} onChange={setDa} type="number" />
              <Field label="HRA received (₹)" value={hraReceived} onChange={setHraReceived} type="number" />
              <Field label="LTA — Leave Travel Allowance (₹)" value={lta} onChange={setLta} type="number" />
              <Field label="Conveyance / Transport allowance (₹)" value={conveyance} onChange={setConveyance} type="number" />
              <Field label="Children Education Allowance (₹)" value={childrenEd} onChange={setChildrenEd} type="number" />
              <Field label="Medical reimbursement (₹)" value={medical} onChange={setMedical} type="number" />
              <Field label="Other allowances / perks (₹)" value={otherAllowances} onChange={setOtherAllowances} type="number" />
              <Field
                label="Rent paid — monthly (₹)"
                value={rentPaidMonthly}
                onChange={setRentPaidMonthly}
                type="number"
                hint="Drives sec 10(13A) HRA exemption. Leave 0 if you don't rent."
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Link href={`/tax/itr3/salary?fy=${fy}`}>
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
  hint,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  hint?: string;
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
      {hint && <p className="mt-1 text-[10px] text-gray-500">{hint}</p>}
    </div>
  );
}
