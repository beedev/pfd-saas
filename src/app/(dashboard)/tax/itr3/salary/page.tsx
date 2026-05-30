'use client';
export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Plus, Trash2, ArrowLeft } from 'lucide-react';
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

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(paisa / 100);

export default function SalaryListPage() {
  return <Suspense fallback={<div className="p-6 text-gray-400">Loading…</div>}><Inner /></Suspense>;
}

function Inner() {
  const sp = useSearchParams();
  const fy = sp.get('fy') ?? '2025-26';
  const [rows, setRows] = useState<SalaryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/tax/itr3/salary?fy=${fy}`);
      const data = await r.json();
      setRows(data.entries || []);
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

  return (
    <div className="max-w-5xl space-y-4">
      <Link href={`/tax/itr3?fy=${fy}`} className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline">
        <ArrowLeft className="h-3 w-3" /> ITR-3 Hub
      </Link>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Salary Income (Form 16)</h1>
          <p className="text-sm text-gray-500">FY {fy} — one entry per employer</p>
        </div>
        <Link href={`/tax/itr3/salary/new?fy=${fy}`}>
          <button className="inline-flex items-center gap-2 rounded bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700">
            <Plus className="h-4 w-4" /> Add Form 16
          </button>
        </Link>
      </div>

      <div className="overflow-hidden rounded-lg border bg-white">
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
