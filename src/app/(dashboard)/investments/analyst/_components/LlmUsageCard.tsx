'use client';

/**
 * LLM usage + cost — tokens and $ spent on the analyst's OpenAI calls (gpt-4.1),
 * by task and by day. Read-only monitoring on the analyst Settings tab.
 */

import { useCallback, useEffect, useState } from 'react';
import { Card, CardHeader, CardContent } from '@dxp/ui';
import { Loader2 } from 'lucide-react';

interface TaskRow { task: string; calls: number; promptTokens: number; completionTokens: number; costUsd: number }
interface DayRow { day: string; calls: number; costUsd: number }
interface Summary {
  totals: { calls: number; promptTokens: number; completionTokens: number; costUsd: number };
  byTask: TaskRow[]; byDay: DayRow[]; last30dCostUsd: number;
  pricing: Record<string, { inputPerM: number; outputPerM: number }>;
}

const usd = (n: number) => '$' + n.toFixed(n < 1 ? 4 : 2);
const tok = (n: number) => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
const TASK_LABEL: Record<string, string> = {
  news_sentiment: 'News sentiment', premarket_brief: 'Pre-market brief', signal_tagging: 'Signal tagging',
  tuning_explain: 'Tuning explain', advisory: 'Daily advisory',
};

export function LlmUsageCard() {
  const [loaded, setLoaded] = useState(false);
  const [s, setS] = useState<Summary | null>(null);

  const load = useCallback(async () => {
    try { setS(await fetch('/api/agent/llm-usage').then((r) => r.json())); } catch { /* leave */ }
    setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!loaded) return <Card><CardContent><div className="flex h-24 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[var(--dxp-text-muted)]" /></div></CardContent></Card>;
  if (!s) return null;
  const g41 = s.pricing?.['gpt-4.1'];

  return (
    <Card>
      <CardHeader>
        <h3 className="text-base font-bold text-[var(--dxp-text)]">LLM usage &amp; cost</h3>
        <p className="mt-1 text-xs text-[var(--dxp-text-muted)]">
          OpenAI gpt-4.1{g41 ? ` (in $${g41.inputPerM}/1M · out $${g41.outputPerM}/1M)` : ''} across the analyst&apos;s calls.
          Total <strong>{usd(s.totals.costUsd)}</strong> over {s.totals.calls} call(s) ·
          {' '}{tok(s.totals.promptTokens)} in / {tok(s.totals.completionTokens)} out ·
          last 30d <strong>{usd(s.last30dCostUsd)}</strong>.
        </p>
      </CardHeader>
      <CardContent>
        {!s.totals.calls ? (
          <p className="text-sm text-[var(--dxp-text-muted)]">No LLM calls recorded yet — usage logs as the news/brief/tagging jobs run.</p>
        ) : (
          <div className="space-y-5">
            <div>
              <div className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">By task</div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--dxp-border)] text-left text-xs uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                    <th className="py-1 pr-3">Task</th><th className="pr-3 text-right">Calls</th>
                    <th className="pr-3 text-right">Tokens (in/out)</th><th className="text-right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {s.byTask.map((t) => (
                    <tr key={t.task} className="border-b border-[var(--dxp-border)]/50">
                      <td className="py-1.5 pr-3 text-[var(--dxp-text)]">{TASK_LABEL[t.task] ?? t.task}</td>
                      <td className="pr-3 text-right tabular-nums">{t.calls}</td>
                      <td className="pr-3 text-right tabular-nums text-[var(--dxp-text-muted)]">{tok(t.promptTokens)} / {tok(t.completionTokens)}</td>
                      <td className="text-right tabular-nums font-medium">{usd(t.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {s.byDay.length > 0 && (
              <div>
                <div className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Recent days</div>
                <div className="space-y-1 text-sm">
                  {s.byDay.slice(0, 10).map((d) => (
                    <div key={d.day} className="flex justify-between">
                      <span className="text-[var(--dxp-text-muted)]">{d.day} · {d.calls} call(s)</span>
                      <span className="tabular-nums">{usd(d.costUsd)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
