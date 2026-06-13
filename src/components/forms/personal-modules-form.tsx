'use client';

/**
 * Optional modules — settings card.
 *
 * Toggles opt-in sidebar sections that are off by default:
 *   - Transformation tracker (user_preferences.habits_enabled) → /health/transformation
 *   - GST / business billing  (user_preferences.gst_enabled)   → the GST section
 * Flipping a toggle PATCHes the flag and refreshes server components so the
 * sidebar re-renders with the section shown/hidden.
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

type Flag = 'habitsEnabled' | 'gstEnabled';

export function PersonalModulesForm() {
  const router = useRouter();
  const [habitsEnabled, setHabitsEnabled] = useState<boolean | null>(null);
  const [gstEnabled, setGstEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/user-preferences');
        if (!r.ok) throw new Error(await r.text());
        const j = await r.json();
        setHabitsEnabled(Boolean(j.preferences?.habitsEnabled));
        setGstEnabled(Boolean(j.preferences?.gstEnabled));
      } catch (err) {
        console.error(err);
        toast.error('Could not load preferences');
        setHabitsEnabled(false);
        setGstEnabled(false);
      }
    })();
  }, []);

  const toggle = async (
    field: Flag,
    next: boolean,
    setter: (v: boolean | null) => void,
    prev: boolean | null,
    label: string,
  ) => {
    setSaving(true);
    setter(next); // optimistic
    try {
      const r = await fetch('/api/user-preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: next }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || 'save failed');
      }
      toast.success(`${label} ${next ? 'enabled' : 'disabled'}`);
      // Refresh server components so the sidebar re-renders with the new flag.
      router.refresh();
    } catch (err) {
      setter(prev);
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Optional modules</CardTitle>
        <CardDescription>
          Off by default so the sidebar stays focused. Enable what you need.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
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
            onClick={() =>
              toggle('habitsEnabled', !habitsEnabled, setHabitsEnabled, habitsEnabled, 'Transformation tracker')
            }
          >
            {habitsEnabled == null ? 'Loading…' : habitsEnabled ? 'Disable' : 'Enable'}
          </Button>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-medium text-sm">GST / business billing</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Sales &amp; purchase invoices, GSTR-1 / GSTR-3B, customers and vendors.
              Turn on if you file GST.
            </p>
          </div>
          <Button
            type="button"
            variant={gstEnabled ? 'secondary' : 'default'}
            disabled={saving || gstEnabled == null}
            onClick={() => toggle('gstEnabled', !gstEnabled, setGstEnabled, gstEnabled, 'GST module')}
          >
            {gstEnabled == null ? 'Loading…' : gstEnabled ? 'Disable' : 'Enable'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
