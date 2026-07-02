'use client';

/** Analyst settings — starting capital, risk profile, benchmark, automation toggles. */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';

import { Button, Card, CardHeader, CardContent, Input, Select } from '@dxp/ui';
import { ArrowLeft, Save, Loader2 } from 'lucide-react';
import { Disclaimer } from '../_components/Disclaimer';
import { SelfTuningCard } from '../_components/SelfTuningCard';
import { SignalLearningCard } from '../_components/SignalLearningCard';

const RISK_OPTIONS = [
  { value: 'CONSERVATIVE', label: 'Conservative' },
  { value: 'BALANCED', label: 'Balanced' },
  { value: 'AGGRESSIVE', label: 'Aggressive' },
];

export default function AnalystSettingsPage() {
  const [loaded, setLoaded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasPositions, setHasPositions] = useState(false);

  const [startingCapital, setStartingCapital] = useState('1000000');
  const [riskProfile, setRiskProfile] = useState('BALANCED');
  const [benchmarkSymbol, setBenchmarkSymbol] = useState('^NSEI');
  const [maxPositions, setMaxPositions] = useState('12');
  const [perPositionPct, setPerPositionPct] = useState('8');
  const [cashBufferPct, setCashBufferPct] = useState('10');
  const [enabled, setEnabled] = useState(false);
  const [telegramEnabled, setTelegramEnabled] = useState(true);

  const load = useCallback(async () => {
    const [p, pos] = await Promise.all([
      fetch('/api/agent/portfolio').then((r) => r.json()),
      fetch('/api/agent/positions').then((r) => r.json()),
    ]);
    setHasPositions((pos.positions ?? []).length > 0);
    const pf = p.portfolio;
    if (pf) {
      setStartingCapital(String(Math.round(pf.startingCapitalPaisa / 100)));
      setRiskProfile(pf.riskProfile);
      setBenchmarkSymbol(pf.benchmarkSymbol);
      setMaxPositions(String(pf.maxPositions));
      setPerPositionPct(String(pf.perPositionPct));
      setCashBufferPct(String(pf.cashBufferPct));
      setEnabled(pf.enabled);
      setTelegramEnabled(pf.telegramEnabled);
    }
    setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setIsSaving(true);
    try {
      const body: Record<string, unknown> = {
        riskProfile,
        benchmarkSymbol: benchmarkSymbol.trim() || '^NSEI',
        maxPositions: parseInt(maxPositions, 10) || 12,
        perPositionPct: parseFloat(perPositionPct) || 8,
        cashBufferPct: parseFloat(cashBufferPct) || 10,
        enabled,
        telegramEnabled,
      };
      // Starting capital only applies before any positions exist (server enforces too).
      if (!hasPositions) body.startingCapital = parseFloat(startingCapital) || 1000000;
      const r = await fetch('/api/agent/portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error('save failed');
      toast.success('Settings saved');
      await load();
    } catch { toast.error('Failed to save'); }
    finally { setIsSaving(false); }
  };

  if (!loaded) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-[var(--dxp-text-muted)]" /></div>;

  return (
    <div className="space-y-6">
      <Link href="/investments/analyst" className="inline-flex items-center gap-1 text-sm text-[var(--dxp-text-muted)] hover:text-[var(--dxp-text)]">
        <ArrowLeft className="h-4 w-4" /> Back to analyst
      </Link>
      <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">Analyst settings</h1>
      <Disclaimer />

      <Card>
        <CardHeader><h3 className="text-base font-bold text-[var(--dxp-text)]">Portfolio</h3></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label={`Starting capital (₹)${hasPositions ? ' — locked (trades exist)' : ''}`}>
              <Input type="number" min="0" value={startingCapital} disabled={hasPositions} onChange={(e) => setStartingCapital(e.target.value)} />
            </Field>
            <Field label="Risk profile">
              <Select value={riskProfile} onChange={setRiskProfile} options={RISK_OPTIONS} />
            </Field>
            <Field label="Benchmark symbol (Yahoo)">
              <Input value={benchmarkSymbol} onChange={(e) => setBenchmarkSymbol(e.target.value)} placeholder="^NSEI" />
            </Field>
            <Field label="Max positions">
              <Input type="number" min="1" value={maxPositions} onChange={(e) => setMaxPositions(e.target.value)} />
            </Field>
            <Field label="Per-position size (% of capital)">
              <Input type="number" min="1" value={perPositionPct} onChange={(e) => setPerPositionPct(e.target.value)} />
            </Field>
            <Field label="Cash buffer (% of capital)">
              <Input type="number" min="0" value={cashBufferPct} onChange={(e) => setCashBufferPct(e.target.value)} />
            </Field>
            <div className="flex items-center gap-4 sm:col-span-2">
              <label className="flex items-center gap-2 text-sm text-[var(--dxp-text)]">
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4" />
                Enable daily auto-run (cron)
              </label>
              <label className="flex items-center gap-2 text-sm text-[var(--dxp-text)]">
                <input type="checkbox" checked={telegramEnabled} onChange={(e) => setTelegramEnabled(e.target.checked)} className="h-4 w-4" />
                Telegram digest
              </label>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <Button variant="primary" onClick={save} disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save
            </Button>
          </div>
        </CardContent>
      </Card>

      <SelfTuningCard />
      <SignalLearningCard />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">{label}</label>
      {children}
    </div>
  );
}
