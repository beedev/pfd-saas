'use client';
export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Trash2, ArrowLeft, FileText, Upload } from 'lucide-react';
import { toast } from 'sonner';

interface SalaryRow {
  id: number;
  financialYear: string;
  employerName: string;
  employerTan: string;
  grossSalaryPaisa: number;
  taxableSalaryPaisa: number;
  tdsPaisa: number;
}

interface Form16Totals {
  grossSalaryPaisa: number;
  taxableSalaryPaisa: number;
  totalTdsPaisa: number;
}

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(paisa / 100);

export default function SalaryListPage() {
  return <Suspense fallback={<div className="p-6 text-gray-400">Loading…</div>}><Inner /></Suspense>;
}

function Inner() {
  const sp = useSearchParams();
  const fy = sp.get('fy') ?? '2025-26';
  const [rows, setRows] = useState<SalaryRow[]>([]);
  const [form16, setForm16] = useState<Form16Totals | null>(null);
  const [form16Count, setForm16Count] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [salaryRes, f16Res] = await Promise.all([
        fetch(`/api/tax/itr3/salary?fy=${fy}`).then((r) => r.json()),
        fetch(`/api/tax/form-16?fy=${encodeURIComponent(fy)}`).then((r) => r.json()).catch(() => null),
      ]);
      setRows(salaryRes.entries || []);
      const uploads = f16Res?.uploads ?? [];
      setForm16Count(uploads.length);
      setForm16(uploads.length ? (f16Res.totals as Form16Totals) : null);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [fy]);

  useEffect(() => { load(); }, [load]);

  const remove = async (id: number) => {
    if (!confirm('Delete this entry?')) return;
    const r = await fetch(`/api/tax/itr3/salary/${id}`, { method: 'DELETE' });
    if (r.ok) {
      toast.success('Deleted');
      load();
    } else {
      toast.error('Failed');
    }
  };

  // Books totals across all salary_income rows for the FY.
  const booksGross = rows.reduce((s, r) => s + (r.grossSalaryPaisa ?? 0), 0);
  const booksTaxable = rows.reduce((s, r) => s + (r.taxableSalaryPaisa ?? 0), 0);
  const booksTds = rows.reduce((s, r) => s + (r.tdsPaisa ?? 0), 0);

  return (
    <div className="max-w-5xl space-y-4">
      <Link href={`/tax/itr3?fy=${fy}`} className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline">
        <ArrowLeft className="h-3 w-3" /> ITR-3 Hub
      </Link>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Salary Income</h1>
          <p className="text-sm text-gray-500">FY {fy} — books vs the official Form 16</p>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/tax/import" className="inline-flex items-center gap-2 text-sm text-blue-600 hover:underline">
            <Upload className="h-4 w-4" /> Import from Yeswanth TaxCalc
          </Link>
          <Link href="/tax/form-16" className="inline-flex items-center gap-2 text-sm text-blue-600 hover:underline">
            <FileText className="h-4 w-4" /> Manage Form 16
          </Link>
        </div>
      </div>

      {/* Books vs Form 16 (official) — the certificate is final; tax is
          computed from it. Books stay visible for comparison. */}
      {form16 && (
        <div className="overflow-hidden rounded-lg border bg-white">
          <div className="border-b bg-gray-50 px-4 py-2">
            <h2 className="text-sm font-bold text-gray-900">Books vs Form 16 (official)</h2>
            <p className="text-xs text-gray-500">
              Form 16 is the final certificate — tax is computed from these figures. Books are kept for reference.
            </p>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-4 py-2 text-left">Metric</th>
                <th className="px-4 py-2 text-right">Books (imported)</th>
                <th className="px-4 py-2 text-right">Form 16 (final)</th>
                <th className="px-4 py-2 text-right">Difference</th>
              </tr>
            </thead>
            <tbody>
              {([
                ['Gross salary', booksGross, form16.grossSalaryPaisa],
                ['Taxable salary', booksTaxable, form16.taxableSalaryPaisa],
                ['TDS', booksTds, form16.totalTdsPaisa],
              ] as Array<[string, number, number]>).map(([label, books, official]) => {
                const delta = official - books;
                return (
                  <tr key={label} className="border-t">
                    <td className="px-4 py-2 font-medium text-gray-900">{label}</td>
                    <td className="px-4 py-2 text-right font-mono text-gray-600">{formatINR(books)}</td>
                    <td className="px-4 py-2 text-right font-mono font-bold text-gray-900">{formatINR(official)}</td>
                    <td className={`px-4 py-2 text-right font-mono ${delta === 0 ? 'text-gray-400' : delta > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {delta === 0 ? '—' : `${delta > 0 ? '+' : '−'}${formatINR(Math.abs(delta))}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border bg-white">
        <div className="border-b bg-gray-50 px-4 py-2">
          <h2 className="text-sm font-bold text-gray-900">Books — salary entries</h2>
          <p className="text-xs text-gray-500">
            {form16Count > 0
              ? 'Imported/manual records. The official Form 16 above overrides these in the tax calculation.'
              : 'Imported/manual records. Upload a Form 16 to reconcile against the official certificate.'}
          </p>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs">
            <tr>
              <th className="px-3 py-2 text-left">Employer</th>
              <th className="px-3 py-2 text-left">TAN</th>
              <th className="px-3 py-2 text-right">Gross</th>
              <th className="px-3 py-2 text-right">Taxable</th>
              <th className="px-3 py-2 text-right">TDS</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400">No entries yet</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2 font-medium">{r.employerName}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.employerTan}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatINR(r.grossSalaryPaisa)}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatINR(r.taxableSalaryPaisa)}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatINR(r.tdsPaisa)}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => remove(r.id)} className="rounded p-1 hover:bg-red-50">
                      <Trash2 className="h-3 w-3 text-red-500" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
