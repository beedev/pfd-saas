'use client';

/**
 * Income-Tax Gap Check — one place to compare what the Income-Tax department
 * has on you (AIS / TIS) against what's recorded in the app, at the
 * category-total level. Upload the PAN+DOB-encrypted AIS/TIS PDFs (decrypted
 * automatically from your tax identity), and the page flags every category
 * where the department's figure exceeds your books — with the rupee gap and
 * an indicative tax impact. Refresh re-parses and updates the gaps.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Button, Card, CardHeader, CardContent, Input } from '@dxp/ui';
import {
  Loader2,
  Upload,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  FileText,
  Info,
  ShieldCheck,
  ChevronRight,
  ChevronDown,
  PlusCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { useFinancialYear } from '@/components/providers/financial-year-provider';

type GapStatus = 'matched' | 'mismatch' | 'missing' | 'awaiting_docs';

interface GapRow {
  key: string;
  label: string;
  group: 'income' | 'tax_paid' | 'completeness';
  certPaisa: number | null; // Form 16 / 16A — the actual anchor
  aisPaisa: number | null; // AIS / TIS (department)
  form26asPaisa: number | null; // 26AS (department)
  booksPaisa: number; // provisional estimate
  status: GapStatus;
  note?: string;
  aisDetail?: { source: string; amountPaisa: number }[];
  acceptableResidualPaisa?: number;
  acceptFamily?: 'interest' | 'dividend';
}

interface GapResult {
  fy: string;
  has: { form16: boolean; form16a: boolean; tis: boolean; ais: boolean; form26as: boolean };
  rows: GapRow[];
  summary: { flagged: number };
}

const inr = (p: number | null) =>
  p == null ? '—' : '₹' + (p / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 });

const STATUS: Record<GapStatus, { label: string; cls: string }> = {
  matched: { label: 'Matches', cls: 'bg-emerald-100 text-emerald-700' },
  mismatch: { label: 'Differs from Form 16', cls: 'bg-red-100 text-red-700' },
  missing: { label: 'Gap — in AIS, not recorded', cls: 'bg-red-100 text-red-700' },
  awaiting_docs: { label: 'Awaiting docs', cls: 'bg-slate-100 text-slate-500' },
};

export default function GapCheckPage() {
  const { fy } = useFinancialYear();
  const [data, setData] = useState<GapResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [password, setPassword] = useState('');
  const [needPw, setNeedPw] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const file26asRef = useRef<HTMLInputElement>(null);
  const [pan, setPan] = useState<string | null>(null);
  const [dob, setDob] = useState('');
  const [savingDob, setSavingDob] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [accepting, setAccepting] = useState<string | null>(null);

  const toggleRow = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const acceptFromAis = async (family: 'interest' | 'dividend') => {
    setAccepting(family);
    try {
      const res = await fetch('/api/tax/gap-check/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fy, family }),
      });
      const j = await res.json();
      if (!res.ok) {
        toast.error(j.error || 'Accept failed');
        return;
      }
      toast.success(
        j.created
          ? `Booked ${inr(j.residualPaisa)} ${family} from AIS into other income`
          : 'Nothing left to accept — your records already cover the AIS figure',
      );
      await load();
    } catch {
      toast.error('Accept failed');
    } finally {
      setAccepting(null);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tax/gap-check?fy=${fy}`);
      if (res.ok) setData(await res.json());
    } catch {
      toast.error('Failed to load the gap check');
    } finally {
      setLoading(false);
    }
  }, [fy]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetch('/api/business-profile')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.profile) {
          setPan(j.profile.pan ?? null);
          setDob(j.profile.dob ?? '');
        }
      })
      .catch(() => {});
  }, []);

  const saveDob = async () => {
    setSavingDob(true);
    try {
      const res = await fetch('/api/business-profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dob }),
      });
      const j = await res.json();
      if (res.ok) toast.success('Date of birth saved — AIS/TIS will auto-unlock');
      else toast.error(j.error || 'Failed to save');
    } catch {
      toast.error('Failed to save');
    } finally {
      setSavingDob(false);
    }
  };

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('fy', fy);
      if (password) fd.append('password', password);
      const res = await fetch('/api/tax/ais-tis/upload', { method: 'POST', body: fd });
      const j = await res.json();
      if (!res.ok) {
        if (j.needsPassword) setNeedPw(true);
        toast.error(j.error || 'Upload failed');
        return;
      }
      toast.success(`${j.kind} imported for FY ${j.fy} — gaps refreshed`);
      setNeedPw(false);
      setPassword('');
      await load();
    } catch {
      toast.error('Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) upload(f);
  };

  // 26AS (TRACES) — not encrypted; reuse the existing parse-and-store endpoint.
  const upload26as = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('fy', fy);
      const res = await fetch('/api/tax/form-26as/upload', { method: 'POST', body: fd });
      const j = await res.json();
      if (!res.ok) {
        toast.error(j.error || '26AS upload failed');
        return;
      }
      toast.success(`26AS imported for FY ${fy} — gaps refreshed`);
      await load();
    } catch {
      toast.error('26AS upload failed');
    } finally {
      setUploading(false);
      if (file26asRef.current) file26asRef.current.value = '';
    }
  };
  const on26as = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) upload26as(f);
  };

  const anyDocs =
    !!data &&
    (data.has.form16 || data.has.form16a || data.has.tis || data.has.ais || data.has.form26as);

  return (
    <div className="space-y-6 p-1">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Income-Tax Gap Check</h1>
          <p className="text-sm text-muted-foreground">
            Form 16 / 16A (your actual) vs the IT department (AIS · TIS · 26AS) · FY {fy}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          <span className="ml-2">Refresh</span>
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Gaps flagged</div>
            <div className="mt-1 text-3xl font-semibold">{data?.summary.flagged ?? '—'}</div>
            <div className="text-xs text-muted-foreground">
              differs from Form 16, or in AIS/TIS but not recorded
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Documents loaded</div>
            <div className="mt-2 flex flex-wrap gap-3 text-sm">
              {(
                [
                  ['Form 16', data?.has.form16],
                  ['Form 16A', data?.has.form16a],
                  ['TIS', data?.has.tis],
                  ['AIS', data?.has.ais],
                  ['26AS', data?.has.form26as],
                ] as const
              ).map(([name, on]) => (
                <span key={name} className={on ? 'text-emerald-600' : 'text-slate-400'}>
                  {on ? '✓' : '○'} {name}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Upload */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 font-medium">
            <Upload className="h-4 w-4" /> Upload department documents (AIS · TIS · 26AS)
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            Unlocked automatically from your PAN + Date of Birth. The password is used only to
            decrypt — never stored.
          </p>
          {/* Tax identity — PAN (from GST profile) + DOB for auto-unlock */}
          <div className="flex flex-wrap items-end gap-3 rounded-md border bg-muted/30 p-3">
            <div className="text-sm">
              <div className="text-xs text-muted-foreground">PAN</div>
              <div className="font-mono font-medium">{pan ?? '— set up your profile —'}</div>
            </div>
            <div className="text-sm">
              <label className="text-xs text-muted-foreground">Date of birth</label>
              <Input
                type="date"
                value={/^\d{4}-\d{2}-\d{2}$/.test(dob) ? dob : ''}
                onChange={(e) => setDob(e.target.value)}
                className="w-44"
              />
            </div>
            <Button variant="secondary" size="sm" onClick={saveDob} disabled={savingDob || !dob}>
              {savingDob ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
            </Button>
          </div>
          {needPw && (
            <Input
              type="password"
              placeholder="PDF password (PAN + DOB, DDMMYYYY)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="max-w-sm"
            />
          )}
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">AIS / TIS PDF (auto-decrypted)</label>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf"
                onChange={onPick}
                disabled={uploading}
                className="mt-1 block text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-primary-foreground"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">26AS PDF (TRACES)</label>
              <div className="mt-1 flex items-center gap-3">
                <input
                  ref={file26asRef}
                  type="file"
                  accept="application/pdf"
                  onChange={on26as}
                  disabled={uploading}
                  className="block text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-primary-foreground"
                />
                {uploading && <Loader2 className="h-4 w-4 animate-spin" />}
              </div>
            </div>
          </div>
          <p className="flex items-start gap-1 text-xs text-muted-foreground">
            <FileText className="mt-0.5 h-3 w-3 shrink-0" />
            <span>
              Form 16 / 16A — your official records — are uploaded on their own page and anchor this
              reconciliation:{' '}
              <Link href="/tax/form-16" className="text-primary hover:underline">Form 16 / 16A</Link>.
            </span>
          </p>
        </CardContent>
      </Card>

      {/* Reconciliation */}
      {data && !anyDocs ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-10 text-muted-foreground">
            <Info className="h-5 w-5" />
            Upload your AIS / TIS / 26AS above and Form 16 / 16A on its page to reconcile what the
            department has against your certificates.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4" /> Form 16 vs the department
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2 pr-4">Item</th>
                    <th className="px-4 py-2 text-right">Form 16/16A (actual)</th>
                    <th className="px-4 py-2 text-right">AIS / TIS</th>
                    <th className="px-4 py-2 text-right">26AS</th>
                    <th className="px-4 py-2 text-right">Your books (prov.)</th>
                    <th className="px-4 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.rows.map((r) => {
                    const hasDetail = !!r.aisDetail && r.aisDetail.length > 0;
                    const canAccept = (r.acceptableResidualPaisa ?? 0) > 10_000 && !!r.acceptFamily;
                    const isOpen = expanded.has(r.key);
                    return (
                      <React.Fragment key={r.key}>
                        <tr className="border-b last:border-0 align-top">
                          <td className="py-3 pr-4">
                            <div className="flex items-start gap-1.5">
                              {hasDetail ? (
                                <button
                                  type="button"
                                  onClick={() => toggleRow(r.key)}
                                  className="mt-0.5 text-muted-foreground hover:text-foreground"
                                  aria-label={isOpen ? 'Collapse' : 'Expand'}
                                >
                                  {isOpen ? (
                                    <ChevronDown className="h-4 w-4" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4" />
                                  )}
                                </button>
                              ) : (
                                <span className="w-4" />
                              )}
                              <div>
                                <div className="font-medium">{r.label}</div>
                                {r.note && (
                                  <div className="text-xs text-muted-foreground">{r.note}</div>
                                )}
                                {hasDetail && (
                                  <button
                                    type="button"
                                    onClick={() => toggleRow(r.key)}
                                    className="text-xs text-primary hover:underline"
                                  >
                                    {isOpen ? 'Hide' : 'Show'} {r.aisDetail!.length} source
                                    {r.aisDetail!.length > 1 ? 's' : ''} from AIS
                                  </button>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-medium tabular-nums">
                            {inr(r.certPaisa)}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">{inr(r.aisPaisa)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {inr(r.form26asPaisa)}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                            {inr(r.booksPaisa)}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-col items-start gap-1.5">
                              <span
                                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[r.status].cls}`}
                              >
                                {r.status === 'matched' && <CheckCircle2 className="h-3 w-3" />}
                                {STATUS[r.status].label}
                              </span>
                              {canAccept && (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  className="h-7 px-2 text-xs"
                                  disabled={accepting === r.acceptFamily}
                                  onClick={() => acceptFromAis(r.acceptFamily!)}
                                >
                                  {accepting === r.acceptFamily ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <PlusCircle className="h-3 w-3" />
                                  )}
                                  <span className="ml-1">
                                    Accept {inr(r.acceptableResidualPaisa ?? null)} from AIS
                                  </span>
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {hasDetail && isOpen && (
                          <tr className="border-b bg-muted/30 last:border-0">
                            <td colSpan={6} className="px-4 py-2">
                              <div className="ml-5 text-xs text-muted-foreground">
                                Per-source breakdown the department (AIS/TIS) reports — use it to
                                reconcile against your records:
                              </div>
                              <table className="ml-5 mt-1 w-auto text-xs">
                                <tbody>
                                  {r.aisDetail!.map((d, i) => (
                                    <tr key={`${r.key}-${i}`}>
                                      <td className="py-0.5 pr-6">{d.source}</td>
                                      <td className="py-0.5 text-right tabular-nums">
                                        {inr(d.amountPaisa)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {data && data.summary.flagged === 0 && (
              <p className="mt-4 flex items-center gap-2 text-sm text-emerald-600">
                <CheckCircle2 className="h-4 w-4" /> No gaps — the department&apos;s figures agree with
                your Form 16 / 16A and everything is recorded.
              </p>
            )}
            <p className="mt-4 text-xs text-muted-foreground">
              Anchored on your Form 16 / 16A (the actual). A flag means a department source (AIS/TIS
              or 26AS) disagrees with the certificate. &ldquo;Your books&rdquo; is your provisional
              estimate and never drives a flag.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 border-t pt-4 text-sm">
              <Link href="/tax/form-16" className="text-primary hover:underline">
                Form 16 / 16A →
              </Link>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
