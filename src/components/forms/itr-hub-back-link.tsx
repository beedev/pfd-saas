'use client';

/**
 * Back-link from an ITR schedule sub-page to its return hub — labelled by the
 * form actually selected for the financial year (via the ITR Wizard), instead
 * of a hardcoded "ITR-3 Hub". Falls back to the Wizard when no form is chosen yet.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export function ItrHubBackLink({ fy }: { fy: string }) {
  const [form, setForm] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`/api/tax/itr-form-selection?fy=${fy}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (active) setForm(j?.selection?.selectedForm ?? null);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [fy]);

  const href = form
    ? `/tax/${form.toLowerCase().replace('-', '')}?fy=${fy}`
    : `/tax/itr-wizard?fy=${fy}`;
  const label = form ? `${form} Hub` : loaded ? 'ITR Wizard' : 'Back';

  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
    >
      <ArrowLeft className="h-3 w-3" /> {label}
    </Link>
  );
}
