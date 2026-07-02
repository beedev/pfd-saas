'use client';

/**
 * News-signal learning — read-only view of the self-curating phrase dictionary
 * (Bayesian hit-rate + trust status) and recent EOD review summaries. Config
 * (gates/toggles) lives on the analyst settings page; this is monitoring.
 */

import { useCallback, useEffect, useState } from 'react';
import { Card, CardHeader, CardContent } from '@dxp/ui';
import { Loader2 } from 'lucide-react';

interface Phrase {
  phrase: string; direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; description: string | null;
  status: 'MONITORING' | 'TRUSTED' | 'DEMOTED'; weight: number; observedDays: number;
  appearCount: number; hitCount: number; examples: string[];
}
interface Review { reviewDate: string; summary: string | null; coverageGaps: string[] }
interface Counts { total: number; trusted: number; monitoring: number; demoted: number }

const statusStyle: Record<string, string> = {
  TRUSTED: 'bg-green-500/15 text-green-600', MONITORING: 'bg-amber-500/15 text-amber-600', DEMOTED: 'bg-red-500/15 text-red-600',
};

export function SignalLearningCard() {
  const [loaded, setLoaded] = useState(false);
  const [phrases, setPhrases] = useState<Phrase[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [counts, setCounts] = useState<Counts>({ total: 0, trusted: 0, monitoring: 0, demoted: 0 });

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/agent/signals').then((x) => x.json());
      setPhrases(r.phrases ?? []); setReviews(r.reviews ?? []); setCounts(r.counts ?? { total: 0, trusted: 0, monitoring: 0, demoted: 0 });
    } catch { /* leave */ }
    setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!loaded) return <Card><CardContent><div className="flex h-24 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[var(--dxp-text-muted)]" /></div></CardContent></Card>;

  return (
    <>
      <Card>
        <CardHeader>
          <h3 className="text-base font-bold text-[var(--dxp-text)]">News-signal dictionary</h3>
          <p className="mt-1 text-xs text-[var(--dxp-text-muted)]">
            Self-learned news patterns, weighted by how often they precede a tradeable move (Bayesian hit-rate).
            A phrase becomes <strong>TRUSTED</strong> at ≥0.6 hit-rate over ≥5 observed days.
            {' '}{counts.total} phrases · <span className="text-green-600">{counts.trusted} trusted</span> · {counts.monitoring} monitoring · {counts.demoted} demoted.
          </p>
        </CardHeader>
        <CardContent>
          {!phrases.length ? (
            <p className="text-sm text-[var(--dxp-text-muted)]">The dictionary builds as news is tagged (every 30 min). Weights update at the 16:30 IST EOD review — check back after a few sessions.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--dxp-border)] text-left text-xs uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                    <th className="py-2 pr-3">Signal</th><th className="pr-3">Dir</th><th className="pr-3">Status</th>
                    <th className="pr-3 text-right">Hit-rate</th><th className="pr-3 text-right">Days</th><th className="text-right">Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {phrases.map((p) => (
                    <tr key={p.phrase} className="border-b border-[var(--dxp-border)]/50">
                      <td className="py-2 pr-3 font-medium text-[var(--dxp-text)]" title={p.examples.join('\n')}>{p.phrase}</td>
                      <td className={`pr-3 ${p.direction === 'BULLISH' ? 'text-green-600' : 'text-red-600'}`}>{p.direction === 'BULLISH' ? '▲' : '▼'}</td>
                      <td className="pr-3"><span className={`rounded px-1.5 py-0.5 text-xs font-bold ${statusStyle[p.status] ?? ''}`}>{p.status}</span></td>
                      <td className="pr-3 text-right tabular-nums">{(p.weight * 100).toFixed(0)}%</td>
                      <td className="pr-3 text-right tabular-nums">{p.observedDays}</td>
                      <td className="text-right tabular-nums text-[var(--dxp-text-muted)]">{p.appearCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><h3 className="text-base font-bold text-[var(--dxp-text)]">EOD signal reviews</h3></CardHeader>
        <CardContent>
          {!reviews.length ? (
            <p className="text-sm text-[var(--dxp-text-muted)]">The first review runs at 16:30 IST — it scores each day&apos;s tags against the Nifty 500 movers and flags stocks that moved with no news in our feed (coverage gaps).</p>
          ) : (
            <div className="space-y-3">
              {reviews.map((r) => (
                <div key={r.reviewDate} className="text-sm">
                  <div className="font-medium text-[var(--dxp-text)]">{r.reviewDate}</div>
                  {r.summary && <div className="text-xs text-[var(--dxp-text-muted)]">{r.summary}</div>}
                  {r.coverageGaps.length > 0 && (
                    <div className="mt-0.5 text-xs text-amber-600">Coverage gaps: {r.coverageGaps.slice(0, 10).join(', ')}{r.coverageGaps.length > 10 ? ` +${r.coverageGaps.length - 10}` : ''}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
