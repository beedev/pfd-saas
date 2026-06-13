'use client';

/**
 * Route-segment error boundary for /daily-digest.
 *
 * If anything in the digest page throws during render, Next renders this
 * instead of the bare global "This page couldn't load" screen — scoped to
 * the segment, with a Retry that re-runs the page. Defense-in-depth behind
 * the page's fail-soft data defaults: the defaults stop known crashes; this
 * catches any future unexpected throw so the page degrades gracefully.
 */

import { useEffect } from 'react';
import { Button } from '@dxp/ui';
import { AlertTriangle } from 'lucide-react';

export default function DailyDigestError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[daily-digest] page error:', error);
  }, [error]);

  return (
    <div className="flex h-64 flex-col items-center justify-center gap-4 text-center">
      <AlertTriangle className="h-10 w-10 text-[var(--dxp-text-muted)]" />
      <div className="space-y-1">
        <p className="text-lg font-semibold text-[var(--dxp-text)]">
          Couldn&rsquo;t load the digest
        </p>
        <p className="text-sm text-[var(--dxp-text-muted)]">
          Something went wrong building your snapshot. Try again.
        </p>
      </div>
      <Button onClick={() => reset()}>Retry</Button>
    </div>
  );
}
