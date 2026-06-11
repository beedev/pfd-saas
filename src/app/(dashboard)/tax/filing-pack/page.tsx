'use client';

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Button, Card, CardHeader, CardContent, Badge } from '@dxp/ui';
import { Loader2, Package, CheckCircle, AlertCircle } from 'lucide-react';
import { useFinancialYear } from '@/components/providers/financial-year-provider';

interface Summary {
  buckets: Array<{ section: string; label: string; totalPaisa: number; sources: unknown[] }>;
  totalDeductionsPaisa: number;
  documentCoveragePercent: number;
}

export default function FilingPackPage() {
  const { fy } = useFinancialYear();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [docCount, setDocCount] = useState(0);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [s, d] = await Promise.all([
        fetch(`/api/tax/summary?fy=${fy}`).then((r) => r.json()),
        fetch(`/api/tax/documents?fy=${fy}`).then((r) => r.json()),
      ]);
      setSummary(s);
      setDocCount((d.documents || []).length);
    } finally {
      setIsLoading(false);
    }
  }, [fy]);

  useEffect(() => {
    load();
  }, [load]);

  const generate = async () => {
    setIsGenerating(true);
    try {
      const r = await fetch(`/api/tax/filing-pack/generate?fy=${fy}`, { method: 'POST' });
      if (!r.ok) throw new Error('Generation failed');
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fy}-tax-pack.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Filing pack downloaded');
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setIsGenerating(false);
    }
  };

  const withEntries = summary?.buckets.filter((b) => b.sources.length > 0) || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">Tax Filing Pack</h1>
        <p className="text-[var(--dxp-text-secondary)]">Generate a ZIP bundle of deductions and supporting documents</p>
      </div>

      {isLoading ? (
        <div className="flex h-24 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--dxp-text-muted)]" />
        </div>
      ) : (
        <Card>
          <CardHeader>
            <h3 className="text-base font-bold text-[var(--dxp-text)]">What's included</h3>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              {withEntries.length === 0 ? (
                <p className="text-[var(--dxp-text-muted)]">No deductions for {fy} yet.</p>
              ) : (
                withEntries.map((b) => (
                  <div
                    key={b.section}
                    className="flex items-center justify-between rounded border border-[var(--dxp-border-light)] px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-emerald-500" />
                      <span className="font-semibold text-[var(--dxp-text)]">{b.label}</span>
                    </div>
                    <Badge variant="info">{b.sources.length} sources</Badge>
                  </div>
                ))
              )}
              <div className="flex items-center justify-between rounded border border-[var(--dxp-border-light)] px-3 py-2">
                <div className="flex items-center gap-2">
                  {docCount > 0 ? (
                    <CheckCircle className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-amber-500" />
                  )}
                  <span className="font-semibold text-[var(--dxp-text)]">Supporting documents</span>
                </div>
                <Badge variant={docCount > 0 ? 'success' : 'warning'}>{docCount} files</Badge>
              </div>
              <div className="flex items-center justify-between rounded border border-[var(--dxp-border-light)] px-3 py-2">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-emerald-500" />
                  <span className="font-semibold text-[var(--dxp-text)]">summary.csv</span>
                </div>
                <Badge variant="info">auto-generated</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-center">
        <Button variant="primary" onClick={generate} disabled={isGenerating || isLoading}>
          {isGenerating ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Package className="mr-2 h-5 w-5" />}
          Generate Filing Pack ({fy})
        </Button>
      </div>
    </div>
  );
}
