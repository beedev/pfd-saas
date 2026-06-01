'use client';

/**
 * Tax Setup form — Sprint 5.1a.
 *
 * Eight user-preference toggles that feed the regime-compare math:
 *
 *   • metroCity            → HRA exemption uses 50% (metro) vs 40%
 *   • isSrCitizen          → 80D self-family ceiling ₹50k vs ₹25k
 *   • spouseIsSrCitizen    → (currently informational; reserved for
 *                            future joint-filing scenarios)
 *   • parentsAreSrCitizens → 80D parents ceiling ₹50k vs ₹25k
 *   • hasPermanentDisability + disabilitySeverity → 80U / 80DD bumps
 *   • isFamilyPensioner    → sec 57(iia) family-pension deduction
 *   • isGovtEmployeeForNps → 80CCD(1)/80CCD(2) cap 14% vs 10% of
 *                            salary (govt employees get the higher cap
 *                            under NEW regime)
 *
 * Reads/writes via /api/user-preferences. The form is intentionally
 * pure-toggle — no validation, no destructive operations.
 */

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, Button } from '@dxp/ui';
import { Loader2, Settings2 } from 'lucide-react';
import { toast } from 'sonner';

interface Preferences {
  metroCity: boolean;
  isSrCitizen: boolean;
  spouseIsSrCitizen: boolean;
  parentsAreSrCitizens: boolean;
  hasPermanentDisability: boolean;
  disabilitySeverity: 'REGULAR' | 'SEVERE' | null;
  isFamilyPensioner: boolean;
  isGovtEmployeeForNps: boolean;
}

export function TaxSetupForm() {
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/user-preferences')
      .then((r) => r.json())
      .then((d) => {
        if (d.preferences) {
          setPrefs({
            metroCity: d.preferences.metroCity ?? true,
            isSrCitizen: d.preferences.isSrCitizen ?? false,
            spouseIsSrCitizen: d.preferences.spouseIsSrCitizen ?? false,
            parentsAreSrCitizens: d.preferences.parentsAreSrCitizens ?? false,
            hasPermanentDisability: d.preferences.hasPermanentDisability ?? false,
            disabilitySeverity: d.preferences.disabilitySeverity ?? null,
            isFamilyPensioner: d.preferences.isFamilyPensioner ?? false,
            isGovtEmployeeForNps: d.preferences.isGovtEmployeeForNps ?? false,
          });
        }
      })
      .catch(() => toast.error('Failed to load tax setup'))
      .finally(() => setLoading(false));
  }, []);

  const setField = <K extends keyof Preferences>(key: K, value: Preferences[K]) =>
    setPrefs((prev) => (prev ? { ...prev, [key]: value } : prev));

  const save = async () => {
    if (!prefs) return;
    setSaving(true);
    try {
      const r = await fetch('/api/user-preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prefs),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'Save failed');
      toast.success('Tax setup saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent>
          <div className="flex items-center gap-2 py-4 text-[var(--dxp-text-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading tax setup…
          </div>
        </CardContent>
      </Card>
    );
  }
  if (!prefs) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Settings2 className="h-5 w-5 text-[var(--dxp-brand)]" />
          <h3 className="text-base font-bold text-[var(--dxp-text)]">Tax setup</h3>
        </div>
        <p className="text-xs text-[var(--dxp-text-secondary)]">
          These parameters drive the OLD-regime exemption math (HRA, 80D ceilings, 80U bumps)
          and the 80CCD(2) NEW-regime cap. They rarely change FY-to-FY.
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Toggle
            label="Metro city"
            hint="Mumbai / Delhi / Kolkata / Chennai. 50% HRA exemption vs 40% non-metro."
            checked={prefs.metroCity}
            onChange={(v) => setField('metroCity', v)}
          />
          <Toggle
            label="Senior citizen (age 60+)"
            hint="Raises 80D self-family ceiling from ₹25k to ₹50k."
            checked={prefs.isSrCitizen}
            onChange={(v) => setField('isSrCitizen', v)}
          />
          <Toggle
            label="Spouse is senior citizen"
            hint="Currently informational — reserved for joint-filing scenarios."
            checked={prefs.spouseIsSrCitizen}
            onChange={(v) => setField('spouseIsSrCitizen', v)}
          />
          <Toggle
            label="Parents are senior citizens"
            hint="Raises 80D parents ceiling from ₹25k to ₹50k."
            checked={prefs.parentsAreSrCitizens}
            onChange={(v) => setField('parentsAreSrCitizens', v)}
          />
          <Toggle
            label="Has permanent disability (sec 80U)"
            hint="Disability ≥40% — ₹75k REGULAR / ₹1.25L SEVERE under sec 80U."
            checked={prefs.hasPermanentDisability}
            onChange={(v) => {
              setField('hasPermanentDisability', v);
              if (!v) setField('disabilitySeverity', null);
              else if (prefs.disabilitySeverity === null) setField('disabilitySeverity', 'REGULAR');
            }}
          />
          {prefs.hasPermanentDisability && (
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                Disability severity
              </label>
              <select
                value={prefs.disabilitySeverity ?? 'REGULAR'}
                onChange={(e) => setField('disabilitySeverity', e.target.value as 'REGULAR' | 'SEVERE')}
                className="w-full rounded border border-[var(--dxp-border)] bg-[var(--dxp-surface)] px-2 py-1.5 text-sm text-[var(--dxp-text)]"
              >
                <option value="REGULAR">REGULAR — 40–80% disability (₹75k)</option>
                <option value="SEVERE">SEVERE — &gt;80% disability (₹1.25L)</option>
              </select>
            </div>
          )}
          <Toggle
            label="Family pensioner"
            hint="Sec 57(iia) deduction — lesser of ⅓ pension or ₹15k OLD / ₹25k NEW."
            checked={prefs.isFamilyPensioner}
            onChange={(v) => setField('isFamilyPensioner', v)}
          />
          <Toggle
            label="Govt employee (for NPS cap)"
            hint="Govt employees: 80CCD(2) cap = 14% of salary vs 10% for private."
            checked={prefs.isGovtEmployeeForNps}
            onChange={(v) => setField('isGovtEmployeeForNps', v)}
          />
        </div>

        <div className="mt-4 flex justify-end">
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            Save tax setup
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-[var(--dxp-border)]"
      />
      <div>
        <p className="text-sm font-semibold text-[var(--dxp-text)]">{label}</p>
        {hint && <p className="text-[11px] text-[var(--dxp-text-muted)]">{hint}</p>}
      </div>
    </label>
  );
}
