'use client';

/**
 * Analyst (Paper) — multi-sleeve dashboard. Shows the 4 strategy sleeves, the
 * total equity curve vs benchmark, and a decision feed where each decision
 * expands to the REAL DATA that produced it (rule, inputs, sizing, source).
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';

import { Button, Card, CardHeader, CardContent, Badge, StatsDisplay } from '@dxp/ui';
import { Bot, Play, Loader2, ListPlus, Settings, ChevronDown, ChevronRight, FlaskConical, CandlestickChart, Receipt, Sparkles, Wallet } from 'lucide-react';

import { Disclaimer } from './_components/Disclaimer';
import { NewsPanel } from './_components/NewsPanel';
import { BriefPanel } from './_components/BriefPanel';

interface Sleeve {
  id: number; key: string; name: string; strategy: string; cadence: string;
  allocationPaisa: number; cashPaisa: number; equityPaisa: number;
  positionsValuePaisa: number; unrealizedPnlPaisa: number;
  returnPct: number; openPositions: number; enabled: boolean;
}
interface Evidence {
  rule: string;
  inputs: Record<string, number | string>;
  thresholds?: Record<string, number>;
  sizing?: Record<string, number>;
  source?: string;
  dataAsOf?: string;
}
interface Decision {
  id: number; sleeveId: number | null; action: string; assetClass: string; symbol: string; name: string;
  amountPaisa: number | null; rationale: string | null; evidenceJson: Evidence | null;
}

const inr = (p: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(p / 100);
const actionVariant = (a: string): 'success' | 'warning' | 'info' => (a === 'BUY' ? 'success' : a === 'SELL' ? 'warning' : 'info');
const STRATEGY_LABEL: Record<string, string> = { MEAN_REVERSION: 'My picks · combined trigger', XS_MOMENTUM: 'My picks · combined trigger', TREND: 'Trend / breakout', RS_ROTATION: 'RS rotation', INTRADAY_ORB: 'Intraday ORB (same-day)', VWAP_REVERSION: 'VWAP reversion', GAP_AND_GO: 'Gap-and-go', NEWS_SIGNAL: 'News signal', WATCHLIST: 'My picks · combined trigger' };

export default function AnalystPage() {
  const [sleeves, setSleeves] = useState<Sleeve[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [startingCapitalPaisa, setStarting] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [sl, dec] = await Promise.all([
        fetch('/api/agent/sleeves').then((r) => r.json()),
        fetch('/api/agent/decisions').then((r) => r.json()),
      ]);
      setSleeves(sl.sleeves ?? []);
      setStarting(sl.portfolio?.startingCapitalPaisa ?? 0);
      setDecisions(dec.decisions ?? []);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load analyst data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const runNow = async () => {
    setIsRunning(true);
    try {
      const r = await fetch('/api/agent/run', { method: 'POST' }).then((r) => r.json());
      if (r.status === 'COMPLETED') toast.success(`Run complete — equity ${inr(r.totalEquityPaisa ?? 0)}`);
      else if (r.status === 'SKIPPED') toast.info(`Skipped: ${r.reason}`);
      else toast.error(`Run failed: ${r.reason ?? 'unknown'}`);
      await load();
    } catch { toast.error('Run failed'); }
    finally { setIsRunning(false); }
  };

  // Only ACTIVE buckets count — retired (disabled) sleeves drop off the dashboard
  // and out of the totals, so equity/return reflect the live portfolio.
  const active = sleeves.filter((s) => s.enabled);
  const totalEquity = active.reduce((s, x) => s + x.equityPaisa, 0);
  const totalAllocation = active.reduce((s, x) => s + x.allocationPaisa, 0);
  const totalReturn = totalAllocation > 0 ? ((totalEquity - totalAllocation) / totalAllocation) * 100 : 0;
  const sleeveName = (id: number | null) => sleeves.find((s) => s.id === id)?.name ?? '—';

  if (isLoading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-[var(--dxp-text-muted)]" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Bot className="h-7 w-7 text-[var(--dxp-brand)]" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">Analyst (Paper)</h1>
            <p className="text-[var(--dxp-text-secondary)]">Strategy buckets trading virtual money — tracked vs benchmark</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href="/investments/analyst/watchlist"><Button variant="secondary"><ListPlus className="mr-2 h-4 w-4" />Watchlist · Picks</Button></Link>
          <Link href="/investments/analyst/study"><Button variant="secondary"><FlaskConical className="mr-2 h-4 w-4" />Study</Button></Link>
          <Link href="/investments/analyst/pnl"><Button variant="secondary"><Wallet className="mr-2 h-4 w-4" />P&amp;L</Button></Link>
          <Link href="/investments/analyst/exit-review"><Button variant="secondary"><ListPlus className="mr-2 h-4 w-4" />Exit Review</Button></Link>
          <Link href="/investments/analyst/backtest"><Button variant="secondary"><FlaskConical className="mr-2 h-4 w-4" />Backtest</Button></Link>
          <Link href="/investments/analyst/workbench"><Button variant="secondary"><Sparkles className="mr-2 h-4 w-4" />Workbench</Button></Link>
          <Link href="/investments/analyst/chart"><Button variant="secondary"><CandlestickChart className="mr-2 h-4 w-4" />Chart</Button></Link>
          <Link href="/investments/analyst/transactions"><Button variant="secondary"><Receipt className="mr-2 h-4 w-4" />Transactions</Button></Link>
          <Link href="/investments/analyst/settings"><Button variant="secondary"><Settings className="mr-2 h-4 w-4" />Settings</Button></Link>
          <Button variant="primary" onClick={runNow} disabled={isRunning}>
            {isRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}Run now
          </Button>
        </div>
      </div>

      <Disclaimer />

      <StatsDisplay currency="INR" locale="en-IN" columns={3} stats={[
        { label: 'Total equity', value: totalEquity / 100, format: 'currency' },
        { label: 'Total P&L', value: (totalEquity - totalAllocation) / 100, format: 'currency' },
        { label: 'Return %', value: Number(totalReturn.toFixed(2)), format: 'number' },
      ]} />

      {/* Sleeve cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {active.map((s) => {
          // Bucket equity (cash + positions) and P&L vs its allocation — one
          // consistent base across ALL buckets, so the numbers compare cleanly.
          const equity = s.equityPaisa;
          const pnl = equity - s.allocationPaisa;               // realized + unrealized since inception
          const pnlPct = s.allocationPaisa > 0 ? (pnl / s.allocationPaisa) * 100 : 0;
          const idle = s.openPositions === 0;
          return (
            <Card key={s.id}>
              <CardContent>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-[var(--dxp-text)]">{s.name}</span>
                  <Badge variant="info" className="text-[10px]">{s.cadence === 'INTRADAY' ? 'intraday' : 'daily'}</Badge>
                </div>
                <p className="text-[10px] uppercase tracking-wider text-[var(--dxp-text-muted)]">{STRATEGY_LABEL[s.strategy] ?? s.strategy}</p>
                <p className="mt-2 text-[10px] uppercase tracking-wider text-[var(--dxp-text-muted)]">Value</p>
                <p className="font-mono text-lg font-bold text-[var(--dxp-text)]">{inr(equity)}</p>
                <p className={`font-mono text-sm ${pnl > 0 ? 'text-emerald-700' : pnl < 0 ? 'text-rose-600' : 'text-[var(--dxp-text-muted)]'}`}>
                  {pnl >= 0 ? '+' : ''}{inr(pnl)} ({pnl >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)
                </p>
                <p className="mt-1 text-xs text-[var(--dxp-text-muted)]">
                  {s.openPositions} pos{idle ? ' · idle' : ''} · cash {inr(s.cashPaisa)} of {inr(s.allocationPaisa)}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <BriefPanel />

      <NewsPanel />

      {/* Decision feed with real-data evidence */}
      <Card>
        <CardHeader>
          <h3 className="text-base font-bold text-[var(--dxp-text)]">Decisions</h3>
          <p className="text-xs text-[var(--dxp-text-muted)]">Every decision shows the real data behind it — click to expand.</p>
        </CardHeader>
        <CardContent>
          {decisions.length === 0 ? (
            <p className="py-6 text-center text-[var(--dxp-text-muted)]">No decisions yet — run the agent.</p>
          ) : (
            <ul className="space-y-2">
              {decisions.slice(0, 40).map((d) => {
                const open = expanded === d.id;
                const ev = d.evidenceJson;
                return (
                  <li key={d.id} className="rounded border border-[var(--dxp-border-light)]">
                    <button className="flex w-full items-start gap-3 p-3 text-left" onClick={() => setExpanded(open ? null : d.id)}>
                      {open ? <ChevronDown className="mt-0.5 h-4 w-4 text-[var(--dxp-text-muted)]" /> : <ChevronRight className="mt-0.5 h-4 w-4 text-[var(--dxp-text-muted)]" />}
                      <Badge variant={actionVariant(d.action)}>{d.action}</Badge>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-[var(--dxp-text)]">
                          {d.name} <span className="font-mono text-xs text-[var(--dxp-text-muted)]">{d.symbol || d.assetClass}</span>
                          <span className="ml-2 text-[10px] uppercase tracking-wider text-[var(--dxp-text-muted)]">{sleeveName(d.sleeveId)}</span>
                          {d.amountPaisa ? <span className="ml-2 text-xs text-[var(--dxp-text-secondary)]">{inr(d.amountPaisa)}</span> : null}
                        </div>
                        {d.rationale && <p className="text-xs text-[var(--dxp-text-secondary)]">{d.rationale}</p>}
                      </div>
                    </button>
                    {open && ev && (
                      <div className="border-t border-[var(--dxp-border-light)] bg-[var(--dxp-surface)] p-3 text-xs">
                        <p className="mb-1 font-semibold text-[var(--dxp-text)]">Rule: <span className="font-normal">{ev.rule}</span></p>
                        <EvidenceGrid title="Inputs (real data)" obj={ev.inputs} />
                        {ev.thresholds && <EvidenceGrid title="Thresholds" obj={ev.thresholds} />}
                        {ev.sizing && <EvidenceGrid title="Sizing" obj={ev.sizing} />}
                        <p className="mt-1 text-[10px] text-[var(--dxp-text-muted)]">source: {ev.source ?? '—'}{ev.dataAsOf ? ` · as of ${ev.dataAsOf}` : ''}</p>
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

function EvidenceGrid({ title, obj }: { title: string; obj: Record<string, number | string> }) {
  const fmt = (k: string, v: number | string) =>
    typeof v === 'number' && /paisa$/i.test(k) ? inr(v) : typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(2) : String(v);
  return (
    <div className="mb-1">
      <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">{title}</span>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 font-mono">
        {Object.entries(obj).map(([k, v]) => (
          <span key={k} className="text-[var(--dxp-text)]">{k.replace(/Paisa$/, '')}: {fmt(k, v)}</span>
        ))}
      </div>
    </div>
  );
}
