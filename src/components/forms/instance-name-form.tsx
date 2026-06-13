'use client';

/**
 * Personalize card — Settings (self-host only).
 *
 * Sets the instance owner name so the app shows "<Name>’s Artha". Persists to
 * the volume + applies live (no APP_OWNER env needed). Renders nothing on the
 * public SaaS (fixed brand).
 */

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export function InstanceNameForm() {
  const router = useRouter();
  const [selfHost, setSelfHost] = useState(false);
  const [loading, setLoading] = useState(true);
  const [owner, setOwner] = useState('');
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/settings/app-owner', { cache: 'no-store' });
      if (r.ok) {
        const j = (await r.json()) as { owner?: string; selfHost?: boolean };
        setSelfHost(Boolean(j.selfHost));
        setOwner(j.owner ?? '');
        setInput(j.owner ?? '');
      }
    } catch (err) {
      console.error('[app-owner]', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch('/api/settings/app-owner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner: input.trim() }),
      });
      const j = (await r.json()) as { appName?: string; error?: string };
      if (!r.ok) throw new Error(j.error ?? `Failed (HTTP ${r.status})`);
      setOwner(input.trim());
      toast.success(`Saved — shows as “${j.appName}”`);
      router.refresh(); // re-render the sidebar + title with the new name
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setSaving(true);
    try {
      const r = await fetch('/api/settings/app-owner', { method: 'DELETE' });
      if (!r.ok) throw new Error('Failed');
      setOwner('');
      setInput('');
      toast.success('Reset to “Artha”');
      router.refresh();
    } catch {
      toast.error('Reset failed');
    } finally {
      setSaving(false);
    }
  };

  // Self-host only — the SaaS keeps a fixed brand.
  if (loading || !selfHost) return null;

  const preview = input.trim() ? `${input.trim()}’s Artha` : 'Artha';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Personalize</CardTitle>
        <CardDescription>
          Your name personalises the app — it shows as “{preview}” in the sidebar
          and browser tab. Leave blank for plain “Artha”.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Your name (e.g. Bharath)"
            value={input}
            maxLength={40}
            onChange={(e) => setInput(e.target.value)}
          />
          <Button
            type="button"
            onClick={save}
            disabled={saving || input.trim().length < 1 || input.trim() === owner}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
          {owner && (
            <Button type="button" variant="secondary" onClick={reset} disabled={saving}>
              Reset
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
