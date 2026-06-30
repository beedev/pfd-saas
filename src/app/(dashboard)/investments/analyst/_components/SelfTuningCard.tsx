'use client';

/**
 * Self-tuning (L3) card — shows the ORB sleeve's two opt-in gates, current
 * params, any active promotion, and the recent nightly proposals/promotions
 * from the self-tune loop. Toggling a gate PATCHes /api/agent/tuning.
 */

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardHeader, CardContent } from '@dxp/ui';
import { Loader2 } from 'lucide-react';

interface Experiment {
  id: number; runDate: string; decision: string; reason: string | null;
  sessions: number; rationale: string | null;
  championNetPaisa: number | null; challengerNetPaisa: number | null;
}
interface TuningSleeve {
  sleeveId: number; key: string; name: string;
  tuningEnabled: boolean; tuningAutoPromote: boolean;
  params: Record<string, number>;
  experiments: Experiment[];
  activePromotion: { fromParams: Record<string, number>; toParams: Record<string, number>; promotedAt: string } | null;
}

const inr = (p: number | null) => p == null ? '—' : '₹' + Math.round(p / 100).toLocaleString('en-IN');
const decisionStyle: Record<string, string> = {
  PROMOTED: 'bg-green-500/15 text-green-600', PROPOSED: 'bg-amber-500/15 text-amber-600',
  HELD: 'bg-[var(--dxp-surface-2)] text-[var(--dxp-text-muted)]', REJECTED: 'bg-red-500/15 text-red-600',
  SKIPPED: 'bg-[var(--dxp-surface-2)] text-[var(--dxp-text-muted)]',
};

export function SelfTuningCard() {
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [sleeves, setSleeves] = useState<TuningSleeve[]>([]);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/agent/tuning').then((x) => x.json());
      setSleeves(r.sleeves ?? []);
    } catch { /* leave empty */ }
    setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggle = async (sleeveId: number, field: 'tuningEnabled' | 'tuningAutoPromote', value: boolean) => {
    setBusy(sleeveId);
    try {
      const r = await fetch('/api/agent/tuning', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sleeveId, [field]: value }),
      });
      if (!r.ok) throw new Error();
      toast.success('Tuning updated');
      await load();
    } catch { toast.error('Failed to update'); }
    finally { setBusy(null); }
  };

  if (!loaded) return <Card><CardContent><div className="flex h-24 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[var(--dxp-text-muted)]" /></div></CardContent></Card>;
  if (!sleeves.length) return null; // no ORB sleeve → nothing to tune

  return (
    <Card>
      <CardHeader>
        <h3 className="text-base font-bold text-[var(--dxp-text)]">Self-tuning (L3)</h3>
        <p className="mt-1 text-xs text-[var(--dxp-text-muted)]">
          The agent measures its own net-of-cost edge and tunes the ORB params (targetR / risk% / max
          concurrent). <strong>Enable self-tuning</strong> = nightly archive + proposals (no live changes).
          <strong> Auto-promote</strong> = it writes the params itself, behind guardrails (≥5 sessions &amp;
          ≥10 trades, bootstrap-significant, 5-session cool-down, auto-rollback on degradation).
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {sleeves.map((s) => (
            <div key={s.sleeveId} className="rounded-lg border border-[var(--dxp-border)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-bold text-[var(--dxp-text)]">{s.name}</div>
                  <div className="text-xs text-[var(--dxp-text-muted)]">
                    targetR {s.params.targetR ?? 1.5} · risk {s.params.riskPctPerTrade ?? 0.75}% · max {s.params.maxConcurrent ?? 5}
                    {s.activePromotion && <span className="ml-2 text-green-600">· auto-tuned</span>}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-sm text-[var(--dxp-text)]">
                    <input type="checkbox" className="h-4 w-4" disabled={busy === s.sleeveId}
                      checked={s.tuningEnabled} onChange={(e) => toggle(s.sleeveId, 'tuningEnabled', e.target.checked)} />
                    Enable self-tuning
                  </label>
                  <label className={`flex items-center gap-2 text-sm ${s.tuningEnabled ? 'text-[var(--dxp-text)]' : 'text-[var(--dxp-text-muted)]'}`}>
                    <input type="checkbox" className="h-4 w-4" disabled={busy === s.sleeveId || !s.tuningEnabled}
                      checked={s.tuningAutoPromote} onChange={(e) => toggle(s.sleeveId, 'tuningAutoPromote', e.target.checked)} />
                    Auto-promote
                  </label>
                </div>
              </div>

              {s.experiments.length > 0 && (
                <div className="mt-4 border-t border-[var(--dxp-border)] pt-3">
                  <div className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Recent runs</div>
                  <div className="space-y-2">
                    {s.experiments.map((e) => (
                      <div key={e.id} className="text-xs">
                        <div className="flex items-center gap-2">
                          <span className="text-[var(--dxp-text-muted)]">{e.runDate}</span>
                          <span className={`rounded px-1.5 py-0.5 font-bold ${decisionStyle[e.decision] ?? ''}`}>{e.decision}</span>
                          <span className="text-[var(--dxp-text-muted)]">
                            {e.sessions} session(s) · live {inr(e.championNetPaisa)} → cand {inr(e.challengerNetPaisa)}
                          </span>
                        </div>
                        {e.rationale && <div className="mt-0.5 text-[var(--dxp-text-muted)]">{e.rationale}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {s.tuningEnabled && s.experiments.length === 0 && (
                <div className="mt-3 text-xs text-[var(--dxp-text-muted)]">Enabled — first proposal lands after the next post-close run (16:00 IST).</div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
