'use client';

/**
 * Assistant activity card — Settings (Phase 3.5).
 *
 * Read-only window over telegram_command_log: what the assistant was asked and
 * what it did (route, capability, outcome). Helps trust + debugging.
 */

import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

interface Entry {
  id: number;
  at: string | null;
  route: string | null;
  capabilityId: string | null;
  resultStatus: string;
  confirmed: boolean;
  executed: boolean;
  rawText: string | null;
}

const OK = new Set(['ok']);
const WARN = new Set(['awaiting-confirm', 'awaiting-slot', 'cancelled', 'no-match', 'missing-params', 'rate-limited']);

function statusVariant(s: string): 'default' | 'secondary' | 'destructive' {
  if (OK.has(s)) return 'default';
  if (WARN.has(s)) return 'secondary';
  return 'destructive'; // error, blocked-integrity, rejected
}

export function AssistantActivityCard() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/settings/assistant-log?limit=20', { cache: 'no-store' });
      if (r.ok) {
        const j = (await r.json()) as { entries?: Entry[] };
        setEntries(j.entries ?? []);
      }
    } catch (err) {
      console.error('[assistant-log]', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle>Assistant activity</CardTitle>
            <CardDescription>Recent Telegram requests and what the assistant did with them.</CardDescription>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={refresh} disabled={loading}>
            {loading ? '…' : 'Refresh'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No assistant activity yet.</p>
        ) : (
          <div className="divide-y text-sm">
            {entries.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate">{e.rawText || <span className="text-muted-foreground">(no text)</span>}</p>
                  <p className="text-xs text-muted-foreground">
                    {e.route ?? '—'}
                    {e.capabilityId ? ` · ${e.capabilityId}` : ''}
                    {e.at ? ` · ${new Date(e.at).toLocaleString('en-IN')}` : ''}
                  </p>
                </div>
                <Badge variant={statusVariant(e.resultStatus)}>{e.resultStatus}</Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
