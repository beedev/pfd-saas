'use client';

/**
 * Settings card — wipe DEMO-SEED rows for the current user.
 *
 * Sprint 6.1.6 — companion to the "Load demo data" CTA on the home
 * page. POSTs /api/dev/wipe-demo-data after a confirmation prompt;
 * deletes only rows where notes LIKE 'DEMO-SEED:%' AND user_id matches
 * the session. Real data inserted by the user is never touched.
 */

import { useState } from 'react';
import { Card, CardHeader, CardContent, Button } from '@dxp/ui';
import { Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export function WipeDemoDataCard() {
  const [wiping, setWiping] = useState(false);

  async function handleWipe() {
    if (
      !window.confirm(
        'Delete all demo data for your account? This only removes rows marked DEMO-SEED — your own entries are untouched.',
      )
    ) {
      return;
    }
    setWiping(true);
    try {
      const r = await fetch('/api/dev/wipe-demo-data', { method: 'POST' });
      if (!r.ok) throw new Error('Failed');
      const body = await r.json();
      toast.success(`Removed ${body.total} demo rows`);
      // Give the user a beat to see the toast before reload.
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      console.error(e);
      toast.error('Failed to wipe demo data');
      setWiping(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="text-lg font-semibold">Demo data</h2>
        <p className="text-sm text-[var(--dxp-text-secondary)]">
          Remove rows seeded by the home-page &ldquo;Load demo data&rdquo; button.
          Marker: <code>notes LIKE &lsquo;DEMO-SEED:%&rsquo;</code>.
        </p>
      </CardHeader>
      <CardContent>
        <Button variant="danger" onClick={handleWipe} disabled={wiping}>
          {wiping ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="mr-2 h-4 w-4" />
          )}
          Wipe demo data
        </Button>
      </CardContent>
    </Card>
  );
}
