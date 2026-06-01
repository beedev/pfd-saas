'use client';

/**
 * Personal modules toggle — settings card.
 *
 * Surfaces the optional "Transformation tracker" module that lives at
 * /health/transformation. The toggle flips user_preferences.habits_enabled;
 * when off, the sidebar entry disappears (handled in the dashboard layout
 * on the next navigation/refresh).
 */

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export function PersonalModulesForm() {
  const router = useRouter();
  const [habitsEnabled, setHabitsEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/user-preferences');
        if (!r.ok) throw new Error(await r.text());
        const j = await r.json();
        setHabitsEnabled(Boolean(j.preferences?.habitsEnabled));
      } catch (err) {
        console.error(err);
        toast.error('Could not load preferences');
        setHabitsEnabled(false);
      }
    })();
  }, []);

  const toggle = async (next: boolean) => {
    setSaving(true);
    const prev = habitsEnabled;
    setHabitsEnabled(next); // optimistic
    try {
      const r = await fetch('/api/user-preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ habitsEnabled: next }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || 'save failed');
      }
      toast.success(next ? 'Transformation tracker enabled' : 'Transformation tracker disabled');
      // Refresh server components so the sidebar re-renders with the new flag.
      router.refresh();
    } catch (err) {
      setHabitsEnabled(prev);
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Personal modules</CardTitle>
        <CardDescription>
          Optional, non-finance tools. Off by default so the sidebar stays focused.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-medium text-sm">Transformation tracker</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Daily habits, weight log, journal, and a calorie/protein checklist for
              a 100-day reset.
            </p>
          </div>
          <Button
            type="button"
            variant={habitsEnabled ? 'secondary' : 'default'}
            disabled={saving || habitsEnabled == null}
            onClick={() => toggle(!habitsEnabled)}
          >
            {habitsEnabled == null
              ? 'Loading…'
              : habitsEnabled
                ? 'Disable'
                : 'Enable'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
