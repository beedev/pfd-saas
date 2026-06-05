'use client';

/**
 * /tax/form-16 — Sprint B (saas back-port).
 *
 * Lists Form 16 uploads grouped by FY. Two upload paths in the header:
 *   - Upload PDF (multipart) — best-effort parse, user edits afterwards
 *   - Add manually — inline form that posts the JSON shape
 *
 * Each row links to /tax/form-16/[id] for inspection + edit. Server
 * scopes everything to session.user.id; this page just consumes the
 * scoped response.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Button,
  Card,
  CardHeader,
  CardContent,
  Badge,
  Select,
  Input,
} from '@dxp/ui';
import {
  ArrowLeft,
  Loader2,
  Upload as UploadIcon,
  Trash2,
  FileText,
  Pencil,
  Plus,
} from 'lucide-react';
import { toast } from 'sonner';
import { getCurrentFinancialYear } from '@/lib/finance/tax-constants';

interface Form16Upload {
  id: number;
  fy: string;
  employerName: string;
  employerTan: string;
  uploadedAt: string | null;
  sourceFilename: string | null;
  sourceKind: 'PDF' | 'MANUAL';
  grossSalaryPaisa: number | null;
  exemptAllowancesPaisa: number | null;
  standardDeductionPaisa: number | null;
  professionalTaxPaisa: number | null;
  taxableSalaryPaisa: number | null;
  totalTdsPaisa: number | null;
  quarterlyTdsQ1Paisa: number | null;
  quarterlyTdsQ2Paisa: number | null;
  quarterlyTdsQ3Paisa: number | null;
  quarterlyTdsQ4Paisa: number | null;
  notes: string | null;
}

interface Resp {
  uploads: Form16Upload[];
  totals: {
    grossSalaryPaisa: number;
    taxableSalaryPaisa: number;
    totalTdsPaisa: number;
  };
}

const fmtINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

function previousFy(): string {
  const current = getCurrentFinancialYear();
  const startYear = Number(current.split('-')[0]) - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

function generateFyOptions(): { value: string; label: string }[] {
  const current = getCurrentFinancialYear();
  const startYear = Number(current.split('-')[0]);
  const out: { value: string; label: string }[] = [];
  for (let i = -2; i <= 2; i++) {
    const s = startYear + i;
    const e = String((s + 1) % 100).padStart(2, '0');
    out.push({ value: `${s}-${e}`, label: `FY ${s}-${e}` });
  }
  return out;
}

export default function Form16ListPage() {
  const [fy, setFy] = useState(previousFy());
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Manual entry form state — kept inline for simplicity.
  const [showManual, setShowManual] = useState(false);
  const [mEmployerName, setMEmployerName] = useState('');
  const [mEmployerTan, setMEmployerTan] = useState('');
  const [mGross, setMGross] = useState('');
  const [mTaxable, setMTaxable] = useState('');
  const [mTds, setMTds] = useState('');
  const [savingManual, setSavingManual] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/tax/form-16?fy=${encodeURIComponent(fy)}`);
      if (!r.ok) {
        toast.error('Failed to load');
        setData(null);
      } else {
        setData(await r.json());
      }
    } finally {
      setLoading(false);
    }
  }, [fy]);

  useEffect(() => {
    load();
  }, [load]);

  const upload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast.error('Pick a PDF file first');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('fy', fy);
      const r = await fetch('/api/tax/form-16/upload', { method: 'POST', body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || 'Upload failed');
      toast.success('Uploaded — review the parsed fields and correct any 0s.');
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setUploading(false);
    }
  };

  const submitManual = async () => {
    if (!mEmployerName.trim() || !mEmployerTan.trim()) {
      toast.error('Employer name + TAN required');
      return;
    }
    setSavingManual(true);
    try {
      const r = await fetch('/api/tax/form-16/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fy,
          employerName: mEmployerName.trim(),
          employerTan: mEmployerTan.trim().toUpperCase(),
          grossSalaryRupees: mGross ? Number(mGross) : 0,
          taxableSalaryRupees: mTaxable ? Number(mTaxable) : 0,
          totalTdsRupees: mTds ? Number(mTds) : 0,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || 'Failed');
      toast.success('Saved — open the row to fill quarterly TDS + other fields.');
      setShowManual(false);
      setMEmployerName('');
      setMEmployerTan('');
      setMGross('');
      setMTaxable('');
      setMTds('');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setSavingManual(false);
    }
  };

  const deleteUpload = async (id: number) => {
    if (!confirm('Delete this Form 16 record?')) return;
    const r = await fetch(`/api/tax/form-16/${id}`, { method: 'DELETE' });
    if (!r.ok) {
      toast.error((await r.json()).error || 'Failed');
      return;
    }
    toast.success('Deleted');
    await load();
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Link
            href="/tax"
            className="text-sm text-[var(--dxp-text-muted)] hover:underline inline-flex items-center gap-1 mb-2"
          >
            <ArrowLeft className="h-3 w-3" /> Back to Tax
          </Link>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <FileText className="h-7 w-7" /> Form 16
          </h1>
          <p className="text-sm text-[var(--dxp-text-muted)] mt-1">
            Upload your Form 16 PDF or enter the figures manually. Each upload
            participates in the unified tax reconciliation.
          </p>
        </div>
        <div className="w-40">
          <Select options={generateFyOptions()} value={fy} onChange={(v) => setFy(v)} />
        </div>
      </div>

      {/* Totals + upload UI */}
      <Card>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3 mb-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--dxp-text-muted)]">Gross salary</p>
              <p className="font-mono text-xl font-bold">{fmtINR(data?.totals.grossSalaryPaisa ?? 0)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--dxp-text-muted)]">Taxable salary</p>
              <p className="font-mono text-xl font-bold">{fmtINR(data?.totals.taxableSalaryPaisa ?? 0)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--dxp-text-muted)]">Total TDS</p>
              <p className="font-mono text-xl font-bold">{fmtINR(data?.totals.totalTdsPaisa ?? 0)}</p>
            </div>
          </div>

          <div className="rounded border border-[var(--dxp-border)] p-3 flex flex-wrap items-center gap-2">
            <Input ref={fileRef} type="file" accept="application/pdf" className="flex-1 min-w-[200px]" />
            <Button onClick={upload} disabled={uploading} variant="primary">
              <UploadIcon className="h-3 w-3 mr-1" />
              {uploading ? 'Uploading…' : `Upload PDF for FY ${fy}`}
            </Button>
            <Button onClick={() => setShowManual((s) => !s)} variant="secondary">
              <Plus className="h-3 w-3 mr-1" /> Add manually
            </Button>
          </div>

          {showManual && (
            <div className="mt-3 rounded border border-[var(--dxp-border)] p-3 space-y-3">
              <p className="text-sm font-bold">Manual entry for FY {fy}</p>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="text-xs font-bold uppercase text-[var(--dxp-text-secondary)] mb-1 block">
                    Employer name
                  </label>
                  <Input value={mEmployerName} onChange={(e) => setMEmployerName(e.target.value)} placeholder="HTC Global Services" />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-[var(--dxp-text-secondary)] mb-1 block">
                    Employer TAN
                  </label>
                  <Input value={mEmployerTan} onChange={(e) => setMEmployerTan(e.target.value.toUpperCase())} placeholder="CHEH04123A" />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-[var(--dxp-text-secondary)] mb-1 block">
                    Gross salary (₹)
                  </label>
                  <Input type="number" value={mGross} onChange={(e) => setMGross(e.target.value)} placeholder="2400000" />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-[var(--dxp-text-secondary)] mb-1 block">
                    Taxable salary (₹)
                  </label>
                  <Input type="number" value={mTaxable} onChange={(e) => setMTaxable(e.target.value)} placeholder="1981255" />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-[var(--dxp-text-secondary)] mb-1 block">
                    Total TDS (₹)
                  </label>
                  <Input type="number" value={mTds} onChange={(e) => setMTds(e.target.value)} placeholder="460000" />
                </div>
              </div>
              <p className="text-xs text-[var(--dxp-text-muted)]">
                Quarterly breakdown + standard deduction + Part B detail can be added from the edit page.
              </p>
              <div className="flex gap-2">
                <Button onClick={submitManual} disabled={savingManual} variant="primary" size="sm">
                  {savingManual && <Loader2 className="h-3 w-3 mr-1 animate-spin" />} Save
                </Button>
                <Button onClick={() => setShowManual(false)} variant="ghost" size="sm">Cancel</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {loading && (
        <div className="flex items-center justify-center py-12 text-[var(--dxp-text-muted)]">
          <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading…
        </div>
      )}

      {!loading && data && (
        <Card>
          <CardHeader>
            <h2 className="text-lg font-bold">Uploads ({data.uploads.length})</h2>
          </CardHeader>
          <CardContent>
            {data.uploads.length === 0 ? (
              <p className="text-sm text-[var(--dxp-text-muted)]">
                No Form 16 records for FY {fy} yet — upload a PDF or add one manually above.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-[var(--dxp-text-muted)] border-b border-[var(--dxp-border)]">
                      <th className="py-2 pr-2">Employer</th>
                      <th className="py-2 pr-2">TAN</th>
                      <th className="py-2 pr-2">Source</th>
                      <th className="py-2 pr-2 text-right">Gross</th>
                      <th className="py-2 pr-2 text-right">Taxable</th>
                      <th className="py-2 pr-2 text-right">TDS</th>
                      <th className="py-2 pr-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.uploads.map((u) => (
                      <tr key={u.id} className="border-b border-[var(--dxp-border)]">
                        <td className="py-2 pr-2">
                          <Link href={`/tax/form-16/${u.id}`} className="text-[var(--dxp-brand)] hover:underline font-medium">
                            {u.employerName}
                          </Link>
                        </td>
                        <td className="py-2 pr-2 font-mono text-xs">{u.employerTan}</td>
                        <td className="py-2 pr-2">
                          <Badge variant={u.sourceKind === 'PDF' ? 'info' : 'success'}>{u.sourceKind}</Badge>
                        </td>
                        <td className="py-2 pr-2 text-right font-mono">{fmtINR(u.grossSalaryPaisa ?? 0)}</td>
                        <td className="py-2 pr-2 text-right font-mono">{fmtINR(u.taxableSalaryPaisa ?? 0)}</td>
                        <td className="py-2 pr-2 text-right font-mono">{fmtINR(u.totalTdsPaisa ?? 0)}</td>
                        <td className="py-2 pr-2">
                          <div className="flex gap-1">
                            <Link href={`/tax/form-16/${u.id}`}>
                              <Button variant="ghost" size="sm" title="Edit">
                                <Pencil className="h-3 w-3" />
                              </Button>
                            </Link>
                            <Button variant="ghost" size="sm" title="Delete" onClick={() => deleteUpload(u.id)}>
                              <Trash2 className="h-3 w-3 text-rose-500" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
