'use client';

/**
 * Income-Tax Gap Check — one place to compare what the Income-Tax department
 * has on you (AIS / TIS) against what's recorded in the app, at the
 * category-total level. Upload the PAN+DOB-encrypted AIS/TIS PDFs (decrypted
 * automatically from your tax identity), and the page flags every category
 * where the department's figure exceeds your books — with the rupee gap and
 * an indicative tax impact. Refresh re-parses and updates the gaps.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
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
} from 'lucide-react';
import { toast } from 'sonner';
import { useFinancialYear } from '@/components/providers/financial-year-provider';

type GapStatus = 'missing' | 'under_recorded' | 'matched' | 'app_extra' | 'no_it_data';

interface GapRow {
  key: string;
  label: string;
  source: 'TIS' | 'AIS';
  category: 'income' | 'tax_paid' | 'consideration';
  itDeptPaisa: number | null;
  bookedPaisa: number;
  gapPaisa: number;
  estTaxImpactPaisa: number | null;
  status: GapStatus;
  note?: string;
}

interface GapResult {
  fy: string;
  hasTis: boolean;
  hasAis: boolean;
  uploadedAt: { tis: string | null; ais: string | null };
  rows: GapRow[];
  summary: { flagged: number; totalGapPaisa: number; estTaxAtRiskPaisa: number };
}

const inr = (p: number | null) =>
  p == null ? '—' : '₹' + (p / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 });

const STATUS: Record<GapStatus, { label: string; cls: string }> = {
  missing: { label: 'Missing', cls: 'bg-red-100 text-red-700' },
  under_recorded: { label: 'Under-recorded', cls: 'bg-amber-100 text-amber-800' },
  matched: { label: 'Matched', cls: 'bg-emerald-100 text-emerald-700' },
  app_extra: { label: 'App has more', cls: 'bg-slate-100 text-slate-600' },
  no_it_data: { label: 'No AIS/TIS', cls: 'bg-slate-100 text-slate-500' },
};

export default function GapCheckPage() {
  const { fy } = useFinancialYear();
  const [data, setData] = useState<GapResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [password, setPassword] = useState('');
  const [needPw, setNeedPw] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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

  const flagged = data?.rows.filter((r) => r.status === 'missing' || r.status === 'under_recorded');

  return (
    <div className="space-y-6 p-1">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Income-Tax Gap Check</h1>
          <p className="text-sm text-muted-foreground">
            What the department has (AIS / TIS) vs what you&apos;ve recorded · FY {fy}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          <span className="ml-2">Refresh</span>
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Categories flagged</div>
            <div className="mt-1 text-3xl font-semibold">{data?.summary.flagged ?? '—'}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Est. tax at risk</div>
            <div className="mt-1 text-3xl font-semibold">{inr(data?.summary.estTaxAtRiskPaisa ?? null)}</div>
            <div className="text-xs text-muted-foreground">indicative — income gaps × 30%</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Documents loaded</div>
            <div className="mt-2 flex gap-3 text-sm">
              <span className={data?.hasTis ? 'text-emerald-600' : 'text-slate-400'}>
                {data?.hasTis ? '✓' : '○'} TIS
              </span>
              <span className={data?.hasAis ? 'text-emerald-600' : 'text-slate-400'}>
                {data?.hasAis ? '✓' : '○'} AIS
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Upload */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 font-medium">
            <Upload className="h-4 w-4" /> Upload AIS / TIS
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            Unlocked automatically from your PAN + Date of Birth (set them in Profile). The password
            is used only to decrypt — never stored.
          </p>
          {needPw && (
            <Input
              type="password"
              placeholder="PDF password (PAN + DOB, DDMMYYYY)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="max-w-sm"
            />
          )}
          <div className="flex items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf"
              onChange={onPick}
              disabled={uploading}
              className="block text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-primary-foreground"
            />
            {uploading && <Loader2 className="h-4 w-4 animate-spin" />}
          </div>
          {data?.uploadedAt.tis && (
            <p className="text-xs text-muted-foreground">
              <FileText className="mr-1 inline h-3 w-3" />
              TIS uploaded {new Date(data.uploadedAt.tis).toLocaleString('en-IN')}
            </p>
          )}
          {data?.uploadedAt.ais && (
            <p className="text-xs text-muted-foreground">
              <FileText className="mr-1 inline h-3 w-3" />
              AIS uploaded {new Date(data.uploadedAt.ais).toLocaleString('en-IN')}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Gaps */}
      {!data?.hasTis && !data?.hasAis ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-10 text-muted-foreground">
            <Info className="h-5 w-5" />
            Upload your AIS and TIS to see what the department has that isn&apos;t in your books yet.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4" /> Category gaps
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2 pr-4">Category</th>
                    <th className="px-4 py-2 text-right">Income-Tax dept</th>
                    <th className="px-4 py-2 text-right">Your books</th>
                    <th className="px-4 py-2 text-right">Gap</th>
                    <th className="px-4 py-2 text-right">Tax impact</th>
                    <th className="px-4 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.rows.map((r) => (
                    <tr key={r.key} className="border-b last:border-0 align-top">
                      <td className="py-3 pr-4">
                        <div className="font-medium">{r.label}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.source}
                          {r.note ? ` · ${r.note}` : ''}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{inr(r.itDeptPaisa)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{inr(r.bookedPaisa)}</td>
                      <td
                        className={`px-4 py-3 text-right font-medium tabular-nums ${
                          r.gapPaisa > 1000 ? 'text-red-600' : 'text-muted-foreground'
                        }`}
                      >
                        {r.itDeptPaisa == null ? '—' : inr(r.gapPaisa)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {inr(r.estTaxImpactPaisa)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[r.status].cls}`}
                        >
                          {r.status === 'matched' && <CheckCircle2 className="h-3 w-3" />}
                          {STATUS[r.status].label}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {flagged && flagged.length === 0 && (
              <p className="mt-4 flex items-center gap-2 text-sm text-emerald-600">
                <CheckCircle2 className="h-4 w-4" /> No gaps — your books match the department&apos;s data.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
