'use client';

/**
 * Strategy Workbench — describe a strategy in plain English, watch the LLM compile
 * it to the DSL, confirm the English explain-back, save it, and run it through the
 * same Masters validation gate every strategy faces. Analyst-isolated.
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button, Card, CardHeader, CardContent, Badge } from '@dxp/ui';
import { ArrowLeft, Sparkles, Loader2, Save, FlaskConical, Trash2, ChevronDown, ChevronRight, Newspaper, ListChecks, Search } from 'lucide-react';

interface Verdict {
  verdict: 'PROMISING' | 'REJECTED';
  metrics: { trades: number; winRate: number; expectancy: number; profitFactor: number; medianHold: number; worstTrade: number };
  permutation: { pValue: number; beatByReal: number; shuffles: number };
  benchmark: { benchCagr: number; benchMaxDD: number };
  plateau: boolean;
  pass: { profit: boolean; profitFactor: boolean; notLuck: boolean; robust: boolean };
  universeSize: number;
}
interface Strat { id: number; name: string; description: string; sourceNl: string; status: string; specJson: unknown; validationJson: Verdict | null }

interface Report {
  symbol: string; character: 'REVERTS' | 'TRENDS' | 'NEUTRAL'; autocorr: number;
  reversion: { netPct: number; winRate: number; trades: number };
  momentum: { netPct: number; winRate: number; trades: number };
  rangeStatus: string; recommended: 'MEAN_REVERSION' | 'MOMENTUM' | 'AVOID'; verdict: 'YES' | 'NO'; note: string;
}

const pct = (x: number) => (x * 100).toFixed(1) + '%';

export default function WorkbenchPage() {
  const [nl, setNl] = useState('');
  const [authoring, setAuthoring] = useState(false);
  const [preview, setPreview] = useState<{ spec: unknown; explain: string; warnings: string[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const [strategies, setStrategies] = useState<Strat[]>([]);
  const [validating, setValidating] = useState<number | null>(null);
  const [candInput, setCandInput] = useState('');
  const [checking, setChecking] = useState(false);
  const [reports, setReports] = useState<Report[] | null>(null);

  const checkCandidates = async (body: { symbols?: string[]; source?: string }) => {
    setChecking(true); setReports(null);
    try {
      const r = await fetch('/api/agent/workbench/character', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setReports(j.reports ?? []);
      if (!j.reports?.length) toast.info(j.note || 'No candidates found');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Check failed'); } finally { setChecking(false); }
  };

  const load = useCallback(async () => {
    const r = await fetch('/api/agent/workbench/strategies').then((r) => r.json());
    setStrategies(r.strategies ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    if (nl.trim().length < 8) { toast.info('Describe the strategy in a sentence'); return; }
    setAuthoring(true); setPreview(null);
    try {
      const r = await fetch('/api/agent/workbench/author', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nl }) }).then((r) => r.json());
      if (!r.spec) { toast.error(r.warnings?.join('; ') || r.error || 'Could not author'); setPreview(r.warnings?.length ? { spec: null, explain: '', warnings: r.warnings } : null); return; }
      setPreview(r);
    } catch { toast.error('Author failed'); } finally { setAuthoring(false); }
  };

  const save = async () => {
    if (!preview?.spec) return;
    setSaving(true);
    try {
      const r = await fetch('/api/agent/workbench/strategies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spec: preview.spec, sourceNl: nl }) });
      if (!r.ok) throw new Error((await r.json()).error);
      toast.success('Strategy saved'); setPreview(null); setNl(''); await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Save failed'); } finally { setSaving(false); }
  };

  const validate = async (id: number) => {
    setValidating(id);
    try {
      const r = await fetch(`/api/agent/workbench/strategies/${id}/validate`, { method: 'POST' });
      if (!r.ok) throw new Error((await r.json()).error);
      const { verdict } = await r.json();
      toast[verdict.verdict === 'PROMISING' ? 'success' : 'info'](`Verdict: ${verdict.verdict}`);
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Validation failed'); } finally { setValidating(null); }
  };

  const remove = async (id: number) => { await fetch(`/api/agent/workbench/strategies?id=${id}`, { method: 'DELETE' }); await load(); };

  return (
    <div className="space-y-6">
      <Link href="/investments/analyst" className="inline-flex items-center gap-1 text-sm text-[var(--dxp-text-muted)] hover:text-[var(--dxp-text)]"><ArrowLeft className="h-4 w-4" /> Back to analyst</Link>
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">Strategy Workbench</h1>
        <p className="text-[var(--dxp-text-secondary)]">Describe a strategy in plain English → it compiles to a runnable rule → validate it through the Masters gate.</p>
      </div>

      <Card>
        <CardHeader><h3 className="text-base font-bold text-[var(--dxp-text)]">Describe a strategy</h3></CardHeader>
        <CardContent>
          <textarea value={nl} onChange={(e) => setNl(e.target.value)} rows={3}
            placeholder='e.g. "Buy after 3 down days, sell when it closes above the previous day&apos;s high, 3×ATR stop, max hold 5 days."'
            className="w-full rounded border border-[var(--dxp-border-light)] bg-[var(--dxp-surface)] p-3 text-sm text-[var(--dxp-text)]" />
          <div className="mt-3">
            <Button variant="primary" onClick={generate} disabled={authoring}>
              {authoring ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}Generate strategy
            </Button>
          </div>

          {preview && (
            <div className="mt-4 space-y-3 rounded border border-[var(--dxp-border-light)] p-3">
              {preview.warnings.length > 0 && <p className="text-sm text-amber-600">⚠ {preview.warnings.join('; ')}</p>}
              {preview.explain && <>
                <p className="text-[10px] uppercase tracking-wider text-[var(--dxp-text-muted)]">Confirm what will run</p>
                <p className="font-mono text-sm text-[var(--dxp-text)]">{preview.explain}</p>
                <button onClick={() => setShowJson((s) => !s)} className="flex items-center gap-1 text-xs text-[var(--dxp-text-muted)]">
                  {showJson ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />} DSL spec
                </button>
                {showJson && <pre className="overflow-x-auto rounded bg-[var(--dxp-surface-secondary)] p-2 text-[11px] text-[var(--dxp-text-secondary)]">{JSON.stringify(preview.spec, null, 2)}</pre>}
                <Button variant="secondary" onClick={save} disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save strategy</Button>
              </>}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><h3 className="text-base font-bold text-[var(--dxp-text)]">Candidate check — does a stock trend or revert?</h3></CardHeader>
        <CardContent>
          <p className="mb-2 text-sm text-[var(--dxp-text-muted)]">Vet stocks before trading them. Type names, or pull today&apos;s news candidates / your watchlist. It tests each stock&apos;s character and which strategy actually paid on it — then says yes/no.</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <input value={candInput} onChange={(e) => setCandInput(e.target.value)} placeholder="e.g. RELIANCE, ITC, ADANIPOWER"
              className="flex-1 rounded border border-[var(--dxp-border-light)] bg-[var(--dxp-surface)] p-2 text-sm text-[var(--dxp-text)]"
              onKeyDown={(e) => e.key === 'Enter' && checkCandidates({ symbols: candInput.split(/[,\s]+/).filter(Boolean) })} />
            <Button variant="primary" onClick={() => checkCandidates({ symbols: candInput.split(/[,\s]+/).filter(Boolean) })} disabled={checking}>
              {checking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}Check
            </Button>
            <Button variant="secondary" onClick={() => checkCandidates({ source: 'news' })} disabled={checking}><Newspaper className="mr-2 h-4 w-4" />News candidates</Button>
            <Button variant="secondary" onClick={() => checkCandidates({ source: 'watchlist' })} disabled={checking}><ListChecks className="mr-2 h-4 w-4" />My watchlist</Button>
          </div>

          {reports && (
            <ul className="mt-4 space-y-2">
              {reports.length === 0 && <li className="text-sm text-[var(--dxp-text-muted)]">No candidates.</li>}
              {reports.map((r) => (
                <li key={r.symbol} className="rounded border border-[var(--dxp-border-light)] p-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={r.verdict === 'YES' ? 'success' : 'warning'}>{r.verdict}</Badge>
                    <span className="font-semibold text-[var(--dxp-text)]">{r.symbol}</span>
                    <Badge variant="info">{r.character}</Badge>
                    {r.recommended !== 'AVOID' && <Badge variant="success">{r.recommended === 'MOMENTUM' ? 'ride strength' : 'buy dips'}</Badge>}
                    {r.rangeStatus !== 'in-range' && <span className="text-xs text-amber-600">range {r.rangeStatus}</span>}
                  </div>
                  <p className="mt-1 text-xs text-[var(--dxp-text-secondary)]">{r.note}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-[var(--dxp-text-muted)]">
                    dip-buy {r.reversion.netPct.toFixed(0)}% ({r.reversion.trades} trades) · momentum {r.momentum.netPct.toFixed(0)}% ({r.momentum.trades} trades) · autocorr {r.autocorr}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><h3 className="text-base font-bold text-[var(--dxp-text)]">Your strategies ({strategies.length})</h3></CardHeader>
        <CardContent>
          {strategies.length === 0 ? <p className="py-6 text-center text-[var(--dxp-text-muted)]">None yet — describe one above.</p> : (
            <ul className="space-y-3">
              {strategies.map((s) => {
                const v = s.validationJson;
                return (
                  <li key={s.id} className="rounded border border-[var(--dxp-border-light)] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="font-semibold text-[var(--dxp-text)]">{s.name}</span>
                        <Badge variant={s.status === 'VALIDATED' ? 'success' : s.status === 'REJECTED' ? 'warning' : 'info'} className="ml-2">{s.status}</Badge>
                        {s.sourceNl && <p className="mt-0.5 text-xs text-[var(--dxp-text-muted)]">“{s.sourceNl}”</p>}
                      </div>
                      <div className="flex gap-2">
                        <Button variant="secondary" size="sm" onClick={() => validate(s.id)} disabled={validating === s.id}>
                          {validating === s.id ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FlaskConical className="mr-1 h-4 w-4" />}Validate
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => remove(s.id)}><Trash2 className="h-4 w-4 text-rose-500" /></Button>
                      </div>
                    </div>
                    {v && (
                      <div className="mt-3 rounded bg-[var(--dxp-surface-secondary)] p-2 text-xs">
                        <p className={`font-bold ${v.verdict === 'PROMISING' ? 'text-emerald-700' : 'text-rose-600'}`}>Verdict: {v.verdict} · {v.metrics.trades} trades over {v.universeSize} names</p>
                        <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-[var(--dxp-text-secondary)] sm:grid-cols-4">
                          <span>{v.pass.profit ? '✅' : '❌'} expectancy {pct(v.metrics.expectancy)}</span>
                          <span>{v.pass.profitFactor ? '✅' : '❌'} PF {v.metrics.profitFactor.toFixed(2)}</span>
                          <span>{v.pass.notLuck ? '✅' : '❌'} perm p={v.permutation.pValue.toFixed(3)}</span>
                          <span>{v.pass.robust ? '✅' : '❌'} plateau</span>
                          <span>win {pct(v.metrics.winRate)}</span>
                          <span>median hold {v.metrics.medianHold}d</span>
                          <span>worst {pct(v.metrics.worstTrade)}</span>
                          <span>Nifty {pct(v.benchmark.benchCagr)} CAGR</span>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
