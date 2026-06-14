'use client';

/**
 * Assistant APIs card — Settings (Phase 1.4).
 *
 * Curate which capabilities the Telegram assistant may use and how:
 *  • In assistant — include/exclude the capability from the conversation
 *    (manages registry drift; off → unreachable by slash or AI).
 *  • Slash-only — the data-integrity flag. On → write needs a slash command +
 *    is deduped (no accidental double-write). Off → also AI/free-text eligible.
 *
 * Reads/writes /api/settings/assistant-apis; the worker enforces these live.
 */

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

interface Cap {
  id: string;
  summary: string;
  kind: 'read' | 'write';
  slashCommand: string | null;
  registryDefaultIntegrity: boolean;
  included: boolean;
  dataIntegrity: boolean;
}

export function AssistantApisForm() {
  const [caps, setCaps] = useState<Cap[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/settings/assistant-apis', { cache: 'no-store' });
      if (r.ok) {
        const j = (await r.json()) as { capabilities?: Cap[] };
        setCaps(j.capabilities ?? []);
      }
    } catch (err) {
      console.error('[assistant-apis]', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const patch = async (id: string, change: Partial<Pick<Cap, 'included' | 'dataIntegrity'>>) => {
    setBusy(id);
    // optimistic
    setCaps((prev) => prev.map((c) => (c.id === id ? { ...c, ...change } : c)));
    try {
      const r = await fetch('/api/settings/assistant-apis', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capabilityId: id, ...change }),
      });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? `Failed (HTTP ${r.status})`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update');
      await refresh(); // revert to server truth
    } finally {
      setBusy(null);
    }
  };

  if (loading) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Assistant APIs</CardTitle>
        <CardDescription>
          Control what the Telegram assistant can do. <strong>In assistant</strong> includes a
          capability in the conversation; <strong>Slash-only</strong> requires a slash command for
          writes (deduped, no double-writes) instead of free-text AI.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="divide-y">
          {caps.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{c.summary}</span>
                  <Badge variant={c.kind === 'write' ? 'destructive' : 'secondary'}>{c.kind}</Badge>
                  {c.slashCommand && (
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{c.slashCommand}</code>
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground">{c.id}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={c.included ? 'default' : 'outline'}
                  disabled={busy === c.id}
                  onClick={() => patch(c.id, { included: !c.included })}
                >
                  {c.included ? 'In assistant' : 'Excluded'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={c.dataIntegrity ? 'secondary' : 'outline'}
                  disabled={busy === c.id || !c.included}
                  title="Require a slash command (deduped) for this action instead of free-text AI"
                  onClick={() => patch(c.id, { dataIntegrity: !c.dataIntegrity })}
                >
                  {c.dataIntegrity ? 'Slash-only' : 'AI-eligible'}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
