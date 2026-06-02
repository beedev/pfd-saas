'use client';

/**
 * Tax profile inline chips — Sprint 5.2 commit 1 (U7).
 *
 * Single horizontal row of 4 toggle chips for the most-impactful tax
 * setup flags:
 *   • Metro city (HRA exemption rate)
 *   • Sr citizen — self (slab, 80D, 80TTB)
 *   • Sr citizen — parents (80D bump)
 *   • Family pensioner (std deduction on family pension)
 *
 * Click → PATCH /api/user-preferences → re-fetch + toast +
 * invoke onChange so the parent can refresh regime-compare.
 */

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@dxp/ui';
import { Loader2, MapPin, User, Users, HandCoins } from 'lucide-react';
import { toast } from 'sonner';

interface Prefs {
  metroCity?: boolean;
  isSrCitizen?: boolean;
  parentsAreSrCitizens?: boolean;
  isFamilyPensioner?: boolean;
}

type FlagKey = keyof Required<Prefs>;

interface Props {
  onChange?: () => void;
}

const CHIPS: Array<{
  key: FlagKey;
  label: string;
  icon: React.ReactNode;
  hint: string;
}> = [
  {
    key: 'metroCity',
    label: 'Metro city',
    icon: <MapPin className="h-3.5 w-3.5" />,
    hint: 'HRA exemption uses 50% (metro) vs 40% (non-metro) of basic + DA',
  },
  {
    key: 'isSrCitizen',
    label: 'Sr citizen — self',
    icon: <User className="h-3.5 w-3.5" />,
    hint: 'Higher slab thresholds + 80D bump (₹50k) + 80TTB instead of 80TTA',
  },
  {
    key: 'parentsAreSrCitizens',
    label: 'Sr citizen — parents',
    icon: <Users className="h-3.5 w-3.5" />,
    hint: '80D cap for parents premium goes from ₹25k to ₹50k',
  },
  {
    key: 'isFamilyPensioner',
    label: 'Family pensioner',
    icon: <HandCoins className="h-3.5 w-3.5" />,
    hint: 'Std deduction on family pension under Other Sources',
  },
];

export function TaxProfileInline({ onChange }: Props) {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<FlagKey | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/user-preferences')
      .then((r) => (r.ok ? r.json() : { preferences: null }))
      .then((d) => {
        if (!cancelled) setPrefs(d.preferences ?? {});
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = async (key: FlagKey) => {
    if (!prefs) return;
    const next = !prefs[key];
    setSavingKey(key);
    try {
      const r = await fetch('/api/user-preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: next }),
      });
      if (!r.ok) throw new Error('Save failed');
      setPrefs({ ...prefs, [key]: next });
      toast.success(`${labelFor(key)} → ${next ? 'on' : 'off'}`);
      onChange?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSavingKey(null);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent>
          <div className="flex items-center gap-2 py-2 text-[var(--dxp-text-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading tax profile…
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent>
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
            Tax profile
          </span>
          {CHIPS.map((c) => {
            const active = Boolean(prefs?.[c.key]);
            const isSaving = savingKey === c.key;
            return (
              <button
                key={c.key}
                onClick={() => toggle(c.key)}
                title={c.hint}
                disabled={isSaving}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  active
                    ? 'border-emerald-400 bg-emerald-50/60 text-emerald-900 hover:bg-emerald-100/60'
                    : 'border-[var(--dxp-border)] bg-[var(--dxp-surface)] text-[var(--dxp-text-secondary)] hover:bg-[var(--dxp-surface-alt,var(--dxp-surface))]'
                }`}
              >
                {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : c.icon}
                <span>{c.label}</span>
                <span className={active ? 'text-emerald-700' : 'text-[var(--dxp-text-muted)]'}>
                  {active ? '✓' : '○'}
                </span>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function labelFor(key: FlagKey): string {
  return CHIPS.find((c) => c.key === key)?.label ?? key;
}
