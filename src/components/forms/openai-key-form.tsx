'use client';

/**
 * OpenAI key card — Settings (self-host only).
 *
 * Paste an OpenAI API key to enable the Transformation tracker's nutrition
 * estimator. Validated + stored server-side (volume secrets), applied live.
 * Renders nothing on the public SaaS (key managed via env there).
 */

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export function OpenAiKeyForm() {
  const [selfHost, setSelfHost] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [keyInput, setKeyInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/settings/openai-key', { cache: 'no-store' });
      if (r.ok) {
        const j = (await r.json()) as { configured?: boolean; selfHost?: boolean };
        setSelfHost(Boolean(j.selfHost));
        setConfigured(Boolean(j.configured));
      }
    } catch (err) {
      console.error('[openai-key]', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const r = await fetch('/api/settings/openai-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: keyInput.trim() }),
      });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? `Failed (HTTP ${r.status})`);
      setConfigured(true);
      setKeyInput('');
      toast.success('OpenAI key saved — nutrition estimates enabled');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save key');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    try {
      const r = await fetch('/api/settings/openai-key', { method: 'DELETE' });
      if (!r.ok) throw new Error(`Failed (HTTP ${r.status})`);
      setConfigured(false);
      toast.success('OpenAI key removed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove');
    } finally {
      setRemoving(false);
    }
  };

  // Self-host only — the SaaS manages OPENAI_API_KEY via env.
  if (loading || !selfHost) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle>AI nutrition estimates</CardTitle>
            <CardDescription>
              Optional. Add an OpenAI key to auto-estimate calories &amp; protein from meals
              logged in the Transformation tracker. Without it the tracker works fine —
              estimates are just skipped.
            </CardDescription>
          </div>
          <Badge variant={configured ? 'default' : 'outline'}>{configured ? 'On' : 'Off'}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {configured ? (
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              Key configured — meal nutrition is estimated automatically.
            </p>
            <Button type="button" variant="secondary" onClick={handleRemove} disabled={removing}>
              {removing ? 'Removing…' : 'Remove'}
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Get a key at{' '}
              <a
                href="https://platform.openai.com/api-keys"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                platform.openai.com/api-keys
              </a>
              . Stored on this server only; uses the cheap gpt-4o-mini model.
            </p>
            <div className="flex items-center gap-2">
              <Input
                type="password"
                placeholder="sk-…"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                className="font-mono"
              />
              <Button
                type="button"
                onClick={handleSave}
                disabled={saving || keyInput.trim().length < 20}
              >
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
