'use client';

/** News & "in-play" panel — RSS headlines tagged to tracked instruments with
 *  LLM sentiment, plus the fresh high-impact names feeding the intraday experiment. */

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Card, CardHeader, CardContent, Badge, Button } from '@dxp/ui';
import { Newspaper, RefreshCw, Loader2 } from 'lucide-react';

interface NewsItem { id: number; source: string; title: string; url: string | null; publishedAt: string | null; symbols: string[] | null; sentiment: string | null }
interface InPlay { symbol: string; headlines: number; topTitle: string; sentiment: string | null }

const sentVariant = (s: string | null): 'success' | 'warning' | 'info' => (s === 'POSITIVE' ? 'success' : s === 'NEGATIVE' ? 'warning' : 'info');
const ago = (iso: string | null) => {
  if (!iso) return '';
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 3600000);
  return h < 1 ? 'now' : h < 24 ? `${h}h` : `${Math.round(h / 24)}d`;
};

export function NewsPanel() {
  const [recent, setRecent] = useState<NewsItem[]>([]);
  const [inPlay, setInPlay] = useState<InPlay[]>([]);
  const [loading, setLoading] = useState(true);
  const [ingesting, setIngesting] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/agent/news').then((r) => r.json());
      setRecent(r.recent ?? []); setInPlay(r.inPlay ?? []);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const ingest = async () => {
    setIngesting(true);
    try {
      const r = await fetch('/api/agent/news/ingest', { method: 'POST' }).then((r) => r.json());
      if (r.error) throw new Error(r.error);
      toast.success(`Ingested ${r.inserted} new (${r.tagged} tagged, ${r.scored} scored)`);
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Ingest failed'); }
    finally { setIngesting(false); }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
            <Newspaper className="h-5 w-5 text-[var(--dxp-brand)]" /> News & in-play
          </h3>
          <Button variant="ghost" size="sm" onClick={ingest} disabled={ingesting}>
            {ingesting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}Poll feeds
          </Button>
        </div>
        <p className="text-xs text-[var(--dxp-text-muted)]">RSS + LLM sentiment, tagged to your instruments. In-play feeds the intraday experiment.</p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex h-20 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-[var(--dxp-text-muted)]" /></div>
        ) : (
          <>
            {inPlay.length > 0 && (
              <div className="mb-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">In play (fresh, high-impact)</span>
                <div className="mt-1 flex flex-wrap gap-2">
                  {inPlay.slice(0, 12).map((p) => (
                    <span key={p.symbol} className="inline-flex items-center gap-1 rounded border border-[var(--dxp-border-light)] px-2 py-0.5 text-xs">
                      <Badge variant={sentVariant(p.sentiment)} className="text-[10px]">{p.symbol}</Badge>
                      <span className="text-[var(--dxp-text-muted)]">×{p.headlines}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
            {recent.length === 0 ? (
              <p className="py-4 text-center text-sm text-[var(--dxp-text-muted)]">No tagged news yet — click “Poll feeds”.</p>
            ) : (
              <ul className="space-y-1.5 max-h-80 overflow-auto">
                {recent.slice(0, 30).map((n) => (
                  <li key={n.id} className="flex items-start gap-2 text-sm">
                    {n.sentiment && <Badge variant={sentVariant(n.sentiment)} className="mt-0.5 text-[10px]">{n.sentiment[0]}</Badge>}
                    <div className="min-w-0">
                      <a href={n.url ?? '#'} target="_blank" rel="noreferrer" className="text-[var(--dxp-text)] hover:underline">{n.title}</a>
                      <span className="ml-2 text-[10px] text-[var(--dxp-text-muted)]">{n.source} · {ago(n.publishedAt)}{n.symbols?.length ? ' · ' + n.symbols.join(', ') : ''}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
