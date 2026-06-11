'use client';

/**
 * /tax/form-16/[id] — Sprint B (saas back-port) detail + edit page.
 *
 * Inline-edit pattern (matches investment detail pages). Every field is
 * editable. PDF-extracted fields get an "imported" badge when non-zero
 * on first load — purely informational, doesn't block editing.
 *
 * Server enforces userId scoping; this page just trusts the response
 * (404 redirects back to the list).
 */

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Card, CardHeader, CardContent, Badge, Input } from '@dxp/ui';
import { ArrowLeft, Loader2, Save, X, FileText } from 'lucide-react';
import { toast } from 'sonner';

interface Form16Upload {
  id: number;
  fy: string;
  employerName: string;
  employerTan: string;
  uploadedAt: string | null;
  sourceFilename: string | null;
  sourceKind: 'PDF' | 'MANUAL';
  grossSalaryPaisa: number | null;
  hraExemptionPaisa: number | null;
  exemptAllowancesPaisa: number | null;
  standardDeductionPaisa: number | null;
  professionalTaxPaisa: number | null;
  taxableSalaryPaisa: number | null;
  totalTaxableIncomePaisa: number | null;
  taxOnTotalIncomePaisa: number | null;
  netTaxPayablePaisa: number | null;
  totalTdsPaisa: number | null;
  quarterlyTdsQ1Paisa: number | null;
  quarterlyTdsQ2Paisa: number | null;
  quarterlyTdsQ3Paisa: number | null;
  quarterlyTdsQ4Paisa: number | null;
  notes: string | null;
}

const fmtINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

const paisaToRupees = (p: number | null | undefined): string =>
  p == null ? '' : String(Math.round(p) / 100);

export default function Form16DetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [upload, setUpload] = useState<Form16Upload | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Editable rupee strings (form-style — we convert ×100 on save).
  const [form, setForm] = useState({
    fy: '',
    employerName: '',
    employerTan: '',
    grossSalaryRupees: '',
    hraExemptionRupees: '',
    exemptAllowancesRupees: '',
    standardDeductionRupees: '',
    professionalTaxRupees: '',
    taxableSalaryRupees: '',
    totalTaxableIncomeRupees: '',
    taxOnTotalIncomeRupees: '',
    netTaxPayableRupees: '',
    totalTdsRupees: '',
    quarterlyTdsQ1Rupees: '',
    quarterlyTdsQ2Rupees: '',
    quarterlyTdsQ3Rupees: '',
    quarterlyTdsQ4Rupees: '',
    notes: '',
  });

  // Snapshot of initial PDF-imported fields — drives the badges.
  const [initialFromPdf, setInitialFromPdf] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/tax/form-16/${id}`);
      if (!r.ok) {
        toast.error('Failed to load');
        router.push('/tax/form-16');
        return;
      }
      const j = await r.json();
      const u = j.upload as Form16Upload;
      setUpload(u);
      setForm({
        fy: u.fy,
        employerName: u.employerName,
        employerTan: u.employerTan,
        grossSalaryRupees: paisaToRupees(u.grossSalaryPaisa),
        hraExemptionRupees: paisaToRupees(u.hraExemptionPaisa),
        exemptAllowancesRupees: paisaToRupees(u.exemptAllowancesPaisa),
        standardDeductionRupees: paisaToRupees(u.standardDeductionPaisa),
        professionalTaxRupees: paisaToRupees(u.professionalTaxPaisa),
        taxableSalaryRupees: paisaToRupees(u.taxableSalaryPaisa),
        totalTaxableIncomeRupees: paisaToRupees(u.totalTaxableIncomePaisa),
        taxOnTotalIncomeRupees: paisaToRupees(u.taxOnTotalIncomePaisa),
        netTaxPayableRupees: paisaToRupees(u.netTaxPayablePaisa),
        totalTdsRupees: paisaToRupees(u.totalTdsPaisa),
        quarterlyTdsQ1Rupees: paisaToRupees(u.quarterlyTdsQ1Paisa),
        quarterlyTdsQ2Rupees: paisaToRupees(u.quarterlyTdsQ2Paisa),
        quarterlyTdsQ3Rupees: paisaToRupees(u.quarterlyTdsQ3Paisa),
        quarterlyTdsQ4Rupees: paisaToRupees(u.quarterlyTdsQ4Paisa),
        notes: u.notes ?? '',
      });
      if (u.sourceKind === 'PDF') {
        setInitialFromPdf({
          grossSalary: (u.grossSalaryPaisa ?? 0) > 0,
          hraExemption: (u.hraExemptionPaisa ?? 0) > 0,
          exemptAllowances: (u.exemptAllowancesPaisa ?? 0) > 0,
          standardDeduction: (u.standardDeductionPaisa ?? 0) > 0,
          professionalTax: (u.professionalTaxPaisa ?? 0) > 0,
          taxableSalary: (u.taxableSalaryPaisa ?? 0) > 0,
          totalTaxableIncome: (u.totalTaxableIncomePaisa ?? 0) > 0,
          taxOnTotalIncome: (u.taxOnTotalIncomePaisa ?? 0) > 0,
          netTaxPayable: (u.netTaxPayablePaisa ?? 0) > 0,
          totalTds: (u.totalTdsPaisa ?? 0) > 0,
          q1: (u.quarterlyTdsQ1Paisa ?? 0) > 0,
          q2: (u.quarterlyTdsQ2Paisa ?? 0) > 0,
          q3: (u.quarterlyTdsQ3Paisa ?? 0) > 0,
          q4: (u.quarterlyTdsQ4Paisa ?? 0) > 0,
        });
      }
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch(`/api/tax/form-16/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || 'Save failed');
      setUpload(j.upload);
      setEditing(false);
      toast.success('Saved');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !upload) {
    return (
      <div className="flex h-60 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--dxp-text-muted)]" />
      </div>
    );
  }

  const quarterTotal =
    (upload.quarterlyTdsQ1Paisa ?? 0) +
    (upload.quarterlyTdsQ2Paisa ?? 0) +
    (upload.quarterlyTdsQ3Paisa ?? 0) +
    (upload.quarterlyTdsQ4Paisa ?? 0);
  const quarterMismatch =
    quarterTotal > 0 && Math.abs(quarterTotal - (upload.totalTdsPaisa ?? 0)) > 100 * 100;

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Link
            href="/tax/form-16"
            className="text-sm text-[var(--dxp-text-muted)] hover:underline inline-flex items-center gap-1 mb-2"
          >
            <ArrowLeft className="h-3 w-3" /> All Form 16 uploads
          </Link>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="h-6 w-6" /> {upload.employerName}
          </h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="info">FY {upload.fy}</Badge>
            <Badge variant={upload.sourceKind === 'PDF' ? 'info' : 'success'}>{upload.sourceKind}</Badge>
            <span className="text-xs font-mono text-[var(--dxp-text-muted)]">TAN: {upload.employerTan}</span>
          </div>
        </div>
        <div className="flex gap-2">
          {editing ? (
            <>
              <Button onClick={save} variant="primary" disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                Save
              </Button>
              <Button onClick={() => { setEditing(false); load(); }} variant="ghost" disabled={saving}>
                <X className="h-4 w-4 mr-1" /> Cancel
              </Button>
            </>
          ) : (
            <Button onClick={() => setEditing(true)} variant="primary">Edit</Button>
          )}
        </div>
      </div>

      {quarterMismatch && (
        <Card className="border-amber-500 bg-amber-50 dark:bg-amber-950/30">
          <CardContent>
            <p className="text-sm">
              <strong>Heads up:</strong> Quarterly TDS sum ({fmtINR(quarterTotal)}) doesn&apos;t match total TDS
              ({fmtINR(upload.totalTdsPaisa ?? 0)}). Off by {fmtINR(Math.abs(quarterTotal - (upload.totalTdsPaisa ?? 0)))}.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Identification */}
      <Card>
        <CardHeader>
          <h2 className="text-lg font-bold">Identification</h2>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <Field
            label="Financial year"
            editing={editing}
            value={form.fy}
            display={`FY ${upload.fy}`}
            onChange={(v) => setForm((f) => ({ ...f, fy: v }))}
            placeholder="2025-26"
          />
          <Field
            label="Employer name"
            editing={editing}
            value={form.employerName}
            display={upload.employerName}
            onChange={(v) => setForm((f) => ({ ...f, employerName: v }))}
            colSpan={2}
          />
          <Field
            label="Employer TAN"
            editing={editing}
            value={form.employerTan}
            display={upload.employerTan}
            onChange={(v) => setForm((f) => ({ ...f, employerTan: v.toUpperCase() }))}
            mono
          />
        </CardContent>
      </Card>

      {/* Part B — Salary buckets */}
      <Card>
        <CardHeader>
          <h2 className="text-lg font-bold">Part B — Salary buckets</h2>
          <p className="text-xs text-[var(--dxp-text-muted)] mt-1">All amounts in rupees.</p>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <MoneyField label="Gross salary" editing={editing} value={form.grossSalaryRupees}
            display={fmtINR(upload.grossSalaryPaisa ?? 0)} fromPdf={initialFromPdf.grossSalary}
            onChange={(v) => setForm((f) => ({ ...f, grossSalaryRupees: v }))} />
          <MoneyField label="HRA exemption (sec 10(13A))" editing={editing} value={form.hraExemptionRupees}
            display={fmtINR(upload.hraExemptionPaisa ?? 0)} fromPdf={initialFromPdf.hraExemption}
            onChange={(v) => setForm((f) => ({ ...f, hraExemptionRupees: v }))} />
          <MoneyField label="Exempt allowances total (sec 10)" editing={editing} value={form.exemptAllowancesRupees}
            display={fmtINR(upload.exemptAllowancesPaisa ?? 0)} fromPdf={initialFromPdf.exemptAllowances}
            onChange={(v) => setForm((f) => ({ ...f, exemptAllowancesRupees: v }))} />
          <MoneyField label="Standard deduction (sec 16ia)" editing={editing} value={form.standardDeductionRupees}
            display={fmtINR(upload.standardDeductionPaisa ?? 0)} fromPdf={initialFromPdf.standardDeduction}
            onChange={(v) => setForm((f) => ({ ...f, standardDeductionRupees: v }))} />
          <MoneyField label="Professional tax (sec 16iii)" editing={editing} value={form.professionalTaxRupees}
            display={fmtINR(upload.professionalTaxPaisa ?? 0)} fromPdf={initialFromPdf.professionalTax}
            onChange={(v) => setForm((f) => ({ ...f, professionalTaxRupees: v }))} />
          <MoneyField label="Income under 'Salaries' (line 6)" editing={editing} value={form.taxableSalaryRupees}
            display={fmtINR(upload.taxableSalaryPaisa ?? 0)} fromPdf={initialFromPdf.taxableSalary}
            onChange={(v) => setForm((f) => ({ ...f, taxableSalaryRupees: v }))} />
        </CardContent>
      </Card>

      {/* Part B — Tax computation */}
      <Card>
        <CardHeader>
          <h2 className="text-lg font-bold">Part B — Tax computation</h2>
          <p className="text-xs text-[var(--dxp-text-muted)] mt-1">
            Total taxable income is what tax is computed on (after Chapter VI-A).
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <MoneyField label="Total taxable income (line 12)" editing={editing} value={form.totalTaxableIncomeRupees}
            display={fmtINR(upload.totalTaxableIncomePaisa ?? 0)} fromPdf={initialFromPdf.totalTaxableIncome}
            onChange={(v) => setForm((f) => ({ ...f, totalTaxableIncomeRupees: v }))} bold />
          <MoneyField label="Tax on total income (line 13)" editing={editing} value={form.taxOnTotalIncomeRupees}
            display={fmtINR(upload.taxOnTotalIncomePaisa ?? 0)} fromPdf={initialFromPdf.taxOnTotalIncome}
            onChange={(v) => setForm((f) => ({ ...f, taxOnTotalIncomeRupees: v }))} />
          <MoneyField label="Net tax payable (line 21)" editing={editing} value={form.netTaxPayableRupees}
            display={fmtINR(upload.netTaxPayablePaisa ?? 0)} fromPdf={initialFromPdf.netTaxPayable}
            onChange={(v) => setForm((f) => ({ ...f, netTaxPayableRupees: v }))} />
        </CardContent>
      </Card>

      {/* Part A — TDS */}
      <Card>
        <CardHeader>
          <h2 className="text-lg font-bold">Part A — TDS by quarter</h2>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <MoneyField label="Total TDS" editing={editing} value={form.totalTdsRupees}
            display={fmtINR(upload.totalTdsPaisa ?? 0)} fromPdf={initialFromPdf.totalTds}
            onChange={(v) => setForm((f) => ({ ...f, totalTdsRupees: v }))} bold />
          <div className="hidden md:block" />
          <MoneyField label="Q1 (Apr–Jun)" editing={editing} value={form.quarterlyTdsQ1Rupees}
            display={fmtINR(upload.quarterlyTdsQ1Paisa ?? 0)} fromPdf={initialFromPdf.q1}
            onChange={(v) => setForm((f) => ({ ...f, quarterlyTdsQ1Rupees: v }))} />
          <MoneyField label="Q2 (Jul–Sep)" editing={editing} value={form.quarterlyTdsQ2Rupees}
            display={fmtINR(upload.quarterlyTdsQ2Paisa ?? 0)} fromPdf={initialFromPdf.q2}
            onChange={(v) => setForm((f) => ({ ...f, quarterlyTdsQ2Rupees: v }))} />
          <MoneyField label="Q3 (Oct–Dec)" editing={editing} value={form.quarterlyTdsQ3Rupees}
            display={fmtINR(upload.quarterlyTdsQ3Paisa ?? 0)} fromPdf={initialFromPdf.q3}
            onChange={(v) => setForm((f) => ({ ...f, quarterlyTdsQ3Rupees: v }))} />
          <MoneyField label="Q4 (Jan–Mar)" editing={editing} value={form.quarterlyTdsQ4Rupees}
            display={fmtINR(upload.quarterlyTdsQ4Paisa ?? 0)} fromPdf={initialFromPdf.q4}
            onChange={(v) => setForm((f) => ({ ...f, quarterlyTdsQ4Rupees: v }))} />
        </CardContent>
      </Card>

      {/* Notes */}
      <Card>
        <CardHeader>
          <h2 className="text-lg font-bold">Notes</h2>
        </CardHeader>
        <CardContent>
          {editing ? (
            <textarea
              className="w-full min-h-[80px] rounded border border-[var(--dxp-border)] bg-[var(--dxp-surface)] p-2 text-sm"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          ) : (
            <p className="text-sm whitespace-pre-wrap text-[var(--dxp-text-secondary)]">
              {upload.notes || '—'}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Small inline subcomponents ─────────────────────────────────────────

function Field({
  label,
  editing,
  value,
  display,
  onChange,
  placeholder,
  mono,
  colSpan,
}: {
  label: string;
  editing: boolean;
  value: string;
  display: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  colSpan?: number;
}) {
  return (
    <div className={colSpan === 2 ? 'md:col-span-2' : ''}>
      <p className="text-xs uppercase tracking-wide text-[var(--dxp-text-muted)] mb-1">{label}</p>
      {editing ? (
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      ) : (
        <p className={mono ? 'font-mono' : 'font-medium'}>{display}</p>
      )}
    </div>
  );
}

function MoneyField({
  label,
  editing,
  value,
  display,
  onChange,
  fromPdf,
  bold,
}: {
  label: string;
  editing: boolean;
  value: string;
  display: string;
  onChange: (v: string) => void;
  fromPdf?: boolean;
  bold?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs uppercase tracking-wide text-[var(--dxp-text-muted)]">{label}</p>
        {fromPdf && <Badge variant="info">imported</Badge>}
      </div>
      {editing ? (
        <Input
          type="number"
          step="0.01"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0"
        />
      ) : (
        <p className={`font-mono ${bold ? 'text-lg font-bold' : ''}`}>{display}</p>
      )}
    </div>
  );
}
