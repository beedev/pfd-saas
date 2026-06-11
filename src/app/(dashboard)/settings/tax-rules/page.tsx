'use client';

/**
 * Tax rates / rules EDITOR.
 *
 * Lets the user keep India's tax parameters current from incometax.gov.in
 * when the budget revises them, without a code change. Edits the global
 * (govt-data) tables: tax_slabs, tax_regime_config and tax_rules. All money
 * is shown in RUPEES and converted to paisa on save.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button, Card, CardHeader, CardContent, Input, Select } from '@dxp/ui';
import { Loader2, Plus, Trash2, Save } from 'lucide-react';

type Regime = 'OLD' | 'NEW';

interface SlabRow {
  regime: Regime;
  slabOrder: number;
  lowerPaisa: number;
  upperPaisa: number | null;
  ratePct: number;
}
interface RegimeConfigRow {
  regime: Regime;
  standardDeductionPaisa: number;
  rebate87aThresholdPaisa: number;
  rebate87aMaxPaisa: number;
  cessPct: number;
}
interface SurchargeBracket {
  lowerPaisa: number;
  ratePct: number;
}
interface CapitalGains {
  reformCutoff: string;
  sec112aExemptionPrePaisa: number;
  sec112aExemptionPostPaisa: number;
  ltcgEquityRatePrePct: number;
  ltcgEquityRatePostPct: number;
  stcgEquityRatePrePct: number;
  stcgEquityRatePostPct: number;
  ltcgGeneralRatePct: number;
}
interface Presumptive {
  ad: { digitalPct: number; cashPct: number; turnoverLimitPaisa: number };
  ada: { pct: number; receiptLimitPaisa: number };
}
interface RulesState {
  eightyCCapPaisa: number;
  eightyCcd1bCapPaisa: number;
  eightyDBaseCapPaisa: number;
  eightyDSeniorCapPaisa: number;
  sec24bSelfOccupiedCapPaisa: number;
  sec24bPre1999CapPaisa: number;
  sec80eeaCapPaisa: number;
  surchargeOldBrackets: SurchargeBracket[];
  surchargeNewBrackets: SurchargeBracket[];
  capitalGainsRules: CapitalGains;
  presumptiveRules: Presumptive;
}

interface ApiResponse {
  fy: string;
  rules: RulesState;
  rulesSeeded: boolean;
  regimeConfig: RegimeConfigRow[];
  slabs: SlabRow[];
}

// ── rupee ⇄ paisa helpers ──
const toRupees = (paisa: number | null | undefined): string =>
  paisa === null || paisa === undefined ? '' : String(Math.round(paisa) / 100);
const toPaisa = (rupees: string | number): number => Math.round(Number(rupees || 0) * 100);
const num = (v: string | number): number => Number(v || 0);

/** Input + label wrapper (the @dxp Input has no built-in label slot). */
function LabeledInput({ label, ...props }: React.ComponentProps<typeof Input> & { label: string }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-[var(--dxp-text)]">{label}</label>
      <Input {...props} />
    </div>
  );
}

const FY_OPTIONS = [
  { value: '2024-25', label: 'FY 2024-25' },
  { value: '2025-26', label: 'FY 2025-26' },
  { value: '2026-27', label: 'FY 2026-27' },
];

const EMPTY_REGIME_CONFIG = (regime: Regime): RegimeConfigRow => ({
  regime,
  standardDeductionPaisa: 0,
  rebate87aThresholdPaisa: 0,
  rebate87aMaxPaisa: 0,
  cessPct: 4,
});

export default function TaxRulesPage() {
  const [fy, setFy] = useState('2025-26');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [rulesSeeded, setRulesSeeded] = useState(false);

  const [slabs, setSlabs] = useState<SlabRow[]>([]);
  const [regimeConfig, setRegimeConfig] = useState<RegimeConfigRow[]>([]);
  const [rules, setRules] = useState<RulesState | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const r = (await fetch(`/api/settings/tax-rules?fy=${encodeURIComponent(fy)}`).then((res) =>
        res.json(),
      )) as ApiResponse & { error?: string };
      if (r.error) throw new Error(r.error);

      setRulesSeeded(r.rulesSeeded);
      setRules(r.rules);
      setSlabs(r.slabs);

      // Ensure both regimes always have an editable config row.
      const byRegime = new Map(r.regimeConfig.map((c) => [c.regime, c]));
      setRegimeConfig(
        (['OLD', 'NEW'] as Regime[]).map((rg) => byRegime.get(rg) ?? EMPTY_REGIME_CONFIG(rg)),
      );
    } catch (e) {
      console.error(e);
      toast.error('Failed to load tax rules');
    } finally {
      setIsLoading(false);
    }
  }, [fy]);

  useEffect(() => {
    load();
  }, [load]);

  // ── slab editing ──
  const slabsFor = useCallback(
    (regime: Regime) =>
      slabs
        .map((s, idx) => ({ s, idx }))
        .filter(({ s }) => s.regime === regime)
        .sort((a, b) => a.s.slabOrder - b.s.slabOrder),
    [slabs],
  );

  const updateSlab = (globalIdx: number, field: keyof SlabRow, value: string) => {
    setSlabs((prev) =>
      prev.map((s, i) => {
        if (i !== globalIdx) return s;
        if (field === 'upperPaisa') {
          return { ...s, upperPaisa: value === '' ? null : toPaisa(value) };
        }
        if (field === 'lowerPaisa') return { ...s, lowerPaisa: toPaisa(value) };
        if (field === 'ratePct') return { ...s, ratePct: num(value) };
        return s;
      }),
    );
  };

  const addSlab = (regime: Regime) => {
    setSlabs((prev) => {
      const orders = prev.filter((s) => s.regime === regime).map((s) => s.slabOrder);
      const nextOrder = orders.length ? Math.max(...orders) + 1 : 0;
      return [...prev, { regime, slabOrder: nextOrder, lowerPaisa: 0, upperPaisa: null, ratePct: 0 }];
    });
  };

  const removeSlab = (globalIdx: number) => {
    setSlabs((prev) => prev.filter((_, i) => i !== globalIdx));
  };

  // ── regime config editing ──
  const updateRegimeConfig = (regime: Regime, field: keyof RegimeConfigRow, value: string) => {
    setRegimeConfig((prev) =>
      prev.map((c) => {
        if (c.regime !== regime) return c;
        if (field === 'cessPct') return { ...c, cessPct: num(value) };
        if (field === 'regime') return c;
        return { ...c, [field]: toPaisa(value) };
      }),
    );
  };

  // ── deduction-cap + CG + presumptive editing ──
  const updateRule = <K extends keyof RulesState>(field: K, value: RulesState[K]) => {
    setRules((prev) => (prev ? { ...prev, [field]: value } : prev));
  };
  const updateCapPaisa = (field: keyof RulesState, rupees: string) => {
    updateRule(field, toPaisa(rupees) as never);
  };
  const updateCg = (field: keyof CapitalGains, value: number | string) => {
    setRules((prev) =>
      prev ? { ...prev, capitalGainsRules: { ...prev.capitalGainsRules, [field]: value } } : prev,
    );
  };
  const updatePresumptive = (
    branch: 'ad' | 'ada',
    field: string,
    value: number,
  ) => {
    setRules((prev) =>
      prev
        ? {
            ...prev,
            presumptiveRules: {
              ...prev.presumptiveRules,
              [branch]: { ...prev.presumptiveRules[branch], [field]: value },
            },
          }
        : prev,
    );
  };

  // ── surcharge editing ──
  const surchargeKey = (regime: Regime) =>
    regime === 'OLD' ? 'surchargeOldBrackets' : 'surchargeNewBrackets';
  const updateSurcharge = (regime: Regime, idx: number, field: keyof SurchargeBracket, value: string) => {
    const key = surchargeKey(regime);
    setRules((prev) => {
      if (!prev) return prev;
      const list = [...prev[key]];
      list[idx] = {
        ...list[idx],
        [field]: field === 'lowerPaisa' ? toPaisa(value) : num(value),
      };
      return { ...prev, [key]: list };
    });
  };
  const addSurcharge = (regime: Regime) => {
    const key = surchargeKey(regime);
    setRules((prev) => (prev ? { ...prev, [key]: [...prev[key], { lowerPaisa: 0, ratePct: 0 }] } : prev));
  };
  const removeSurcharge = (regime: Regime, idx: number) => {
    const key = surchargeKey(regime);
    setRules((prev) => (prev ? { ...prev, [key]: prev[key].filter((_, i) => i !== idx) } : prev));
  };

  const save = async () => {
    if (!rules) return;
    setIsSaving(true);
    try {
      const r = await fetch(`/api/settings/tax-rules?fy=${encodeURIComponent(fy)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rules,
          regimeConfig,
          // Re-number slabOrder per regime so the stored order is contiguous.
          slabs: (['OLD', 'NEW'] as Regime[]).flatMap((rg) =>
            slabs
              .filter((s) => s.regime === rg)
              .sort((a, b) => a.slabOrder - b.slabOrder)
              .map((s, i) => ({ ...s, slabOrder: i })),
          ),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || 'Save failed');
      toast.success(`Tax rules saved for FY ${fy}`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  const oldConfig = useMemo(() => regimeConfig.find((c) => c.regime === 'OLD'), [regimeConfig]);
  const newConfig = useMemo(() => regimeConfig.find((c) => c.regime === 'NEW'), [regimeConfig]);

  if (isLoading || !rules) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--dxp-text-muted)]" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">Tax Rates &amp; Rules</h1>
          <p className="text-[var(--dxp-text-secondary)]">
            Keep India&apos;s tax parameters current from incometax.gov.in. Edits apply globally for the
            selected financial year — no code change needed.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-40">
            <Select options={FY_OPTIONS} value={fy} onChange={setFy} />
          </div>
          <Button variant="primary" onClick={save} disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save changes
          </Button>
        </div>
      </div>

      {!rulesSeeded && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No saved rules row for FY {fy} yet — showing the built-in defaults. Click <strong>Save changes</strong> to
          persist them for this year.
        </div>
      )}

      {/* ── 1. Slabs ── */}
      {(['OLD', 'NEW'] as Regime[]).map((regime) => (
        <Card key={`slabs-${regime}`}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-[var(--dxp-text)]">
                  Income Tax Slabs — {regime === 'OLD' ? 'Old' : 'New'} Regime
                </h2>
                <p className="text-xs text-[var(--dxp-text-muted)]">
                  Tax bands applied to taxable income. Leave <em>Upper</em> blank for the top open-ended band.
                </p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => addSlab(regime)}>
                <Plus className="mr-1 h-3 w-3" /> Add band
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-[1fr_1fr_120px_auto] gap-2 px-2 pb-1 text-xs font-medium text-[var(--dxp-text-muted)]">
              <span>Lower (₹)</span>
              <span>Upper (₹, blank = open)</span>
              <span>Rate %</span>
              <span className="text-right">Actions</span>
            </div>
            <div className="space-y-2">
              {slabsFor(regime).map(({ s, idx }) => (
                <div
                  key={idx}
                  className="grid grid-cols-[1fr_1fr_120px_auto] items-center gap-2 rounded border border-[var(--dxp-border)] px-2 py-2"
                >
                  <Input
                    type="number"
                    min={0}
                    step={10000}
                    value={toRupees(s.lowerPaisa)}
                    onChange={(e) => updateSlab(idx, 'lowerPaisa', e.target.value)}
                    className="font-mono"
                  />
                  <Input
                    type="number"
                    min={0}
                    step={10000}
                    placeholder="open-ended"
                    value={s.upperPaisa === null ? '' : toRupees(s.upperPaisa)}
                    onChange={(e) => updateSlab(idx, 'upperPaisa', e.target.value)}
                    className="font-mono"
                  />
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={s.ratePct}
                    onChange={(e) => updateSlab(idx, 'ratePct', e.target.value)}
                    className="font-mono"
                  />
                  <div className="flex justify-end">
                    <Button variant="ghost" onClick={() => removeSlab(idx)} title="Remove band">
                      <Trash2 className="h-4 w-4 text-rose-600" />
                    </Button>
                  </div>
                </div>
              ))}
              {slabsFor(regime).length === 0 && (
                <p className="px-2 py-4 text-sm text-[var(--dxp-text-muted)]">
                  No bands yet — add the first one.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      ))}

      {/* ── 2. Regime config ── */}
      <Card>
        <CardHeader>
          <h2 className="text-base font-bold text-[var(--dxp-text)]">Regime Constants</h2>
          <p className="text-xs text-[var(--dxp-text-muted)]">
            Once-per-return values: standard deduction, the Section 87A rebate (income threshold + max
            rebate), and the health &amp; education cess.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-2">
            {([
              ['OLD', oldConfig],
              ['NEW', newConfig],
            ] as [Regime, RegimeConfigRow | undefined][]).map(([regime, cfg]) =>
              cfg ? (
                <div key={regime} className="space-y-3 rounded-lg border border-[var(--dxp-border)] p-4">
                  <h3 className="text-sm font-semibold text-[var(--dxp-text)]">
                    {regime === 'OLD' ? 'Old' : 'New'} Regime
                  </h3>
                  <LabeledInput
                    label="Standard deduction (₹)"
                    type="number"
                    value={toRupees(cfg.standardDeductionPaisa)}
                    onChange={(e) => updateRegimeConfig(regime, 'standardDeductionPaisa', e.target.value)}
                    className="font-mono"
                  />
                  <LabeledInput
                    label="87A rebate threshold (₹)"
                    type="number"
                    value={toRupees(cfg.rebate87aThresholdPaisa)}
                    onChange={(e) => updateRegimeConfig(regime, 'rebate87aThresholdPaisa', e.target.value)}
                    className="font-mono"
                  />
                  <LabeledInput
                    label="87A rebate max (₹)"
                    type="number"
                    value={toRupees(cfg.rebate87aMaxPaisa)}
                    onChange={(e) => updateRegimeConfig(regime, 'rebate87aMaxPaisa', e.target.value)}
                    className="font-mono"
                  />
                  <LabeledInput
                    label="Cess %"
                    type="number"
                    step={0.5}
                    value={cfg.cessPct}
                    onChange={(e) => updateRegimeConfig(regime, 'cessPct', e.target.value)}
                    className="font-mono"
                  />
                </div>
              ) : null,
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── 3. Deduction caps ── */}
      <Card>
        <CardHeader>
          <h2 className="text-base font-bold text-[var(--dxp-text)]">Deduction Caps</h2>
          <p className="text-xs text-[var(--dxp-text-muted)]">
            Maximum claimable amounts for Chapter VI-A and house-property sections (Old regime).
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <LabeledInput
              label="80C (₹)"
              type="number"
              value={toRupees(rules.eightyCCapPaisa)}
              onChange={(e) => updateCapPaisa('eightyCCapPaisa', e.target.value)}
              className="font-mono"
            />
            <LabeledInput
              label="80CCD(1B) — NPS (₹)"
              type="number"
              value={toRupees(rules.eightyCcd1bCapPaisa)}
              onChange={(e) => updateCapPaisa('eightyCcd1bCapPaisa', e.target.value)}
              className="font-mono"
            />
            <LabeledInput
              label="80D base (₹)"
              type="number"
              value={toRupees(rules.eightyDBaseCapPaisa)}
              onChange={(e) => updateCapPaisa('eightyDBaseCapPaisa', e.target.value)}
              className="font-mono"
            />
            <LabeledInput
              label="80D senior (₹)"
              type="number"
              value={toRupees(rules.eightyDSeniorCapPaisa)}
              onChange={(e) => updateCapPaisa('eightyDSeniorCapPaisa', e.target.value)}
              className="font-mono"
            />
            <LabeledInput
              label="Sec 24(b) self-occupied (₹)"
              type="number"
              value={toRupees(rules.sec24bSelfOccupiedCapPaisa)}
              onChange={(e) => updateCapPaisa('sec24bSelfOccupiedCapPaisa', e.target.value)}
              className="font-mono"
            />
            <LabeledInput
              label="Sec 24(b) pre-1999 (₹)"
              type="number"
              value={toRupees(rules.sec24bPre1999CapPaisa)}
              onChange={(e) => updateCapPaisa('sec24bPre1999CapPaisa', e.target.value)}
              className="font-mono"
            />
            <LabeledInput
              label="80EEA (₹)"
              type="number"
              value={toRupees(rules.sec80eeaCapPaisa)}
              onChange={(e) => updateCapPaisa('sec80eeaCapPaisa', e.target.value)}
              className="font-mono"
            />
          </div>
        </CardContent>
      </Card>

      {/* ── 4. Capital gains ── */}
      <Card>
        <CardHeader>
          <h2 className="text-base font-bold text-[var(--dxp-text)]">Capital Gains</h2>
          <p className="text-xs text-[var(--dxp-text-muted)]">
            Rates split around the July 2024 reform cutoff. Sales on/after the cutoff use the &ldquo;post&rdquo;
            rates; earlier sales use &ldquo;pre&rdquo;.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <LabeledInput
              label="Reform cutoff date"
              type="date"
              value={rules.capitalGainsRules.reformCutoff}
              onChange={(e) => updateCg('reformCutoff', e.target.value)}
              className="font-mono"
            />
            <LabeledInput
              label="112A exemption — pre (₹)"
              type="number"
              value={toRupees(rules.capitalGainsRules.sec112aExemptionPrePaisa)}
              onChange={(e) => updateCg('sec112aExemptionPrePaisa', toPaisa(e.target.value))}
              className="font-mono"
            />
            <LabeledInput
              label="112A exemption — post (₹)"
              type="number"
              value={toRupees(rules.capitalGainsRules.sec112aExemptionPostPaisa)}
              onChange={(e) => updateCg('sec112aExemptionPostPaisa', toPaisa(e.target.value))}
              className="font-mono"
            />
            <LabeledInput
              label="LTCG equity rate — pre %"
              type="number"
              step={0.5}
              value={rules.capitalGainsRules.ltcgEquityRatePrePct}
              onChange={(e) => updateCg('ltcgEquityRatePrePct', num(e.target.value))}
              className="font-mono"
            />
            <LabeledInput
              label="LTCG equity rate — post %"
              type="number"
              step={0.5}
              value={rules.capitalGainsRules.ltcgEquityRatePostPct}
              onChange={(e) => updateCg('ltcgEquityRatePostPct', num(e.target.value))}
              className="font-mono"
            />
            <LabeledInput
              label="LTCG general rate %"
              type="number"
              step={0.5}
              value={rules.capitalGainsRules.ltcgGeneralRatePct}
              onChange={(e) => updateCg('ltcgGeneralRatePct', num(e.target.value))}
              className="font-mono"
            />
            <LabeledInput
              label="STCG equity rate — pre %"
              type="number"
              step={0.5}
              value={rules.capitalGainsRules.stcgEquityRatePrePct}
              onChange={(e) => updateCg('stcgEquityRatePrePct', num(e.target.value))}
              className="font-mono"
            />
            <LabeledInput
              label="STCG equity rate — post %"
              type="number"
              step={0.5}
              value={rules.capitalGainsRules.stcgEquityRatePostPct}
              onChange={(e) => updateCg('stcgEquityRatePostPct', num(e.target.value))}
              className="font-mono"
            />
          </div>
        </CardContent>
      </Card>

      {/* ── 5. Surcharge brackets ── */}
      {(['OLD', 'NEW'] as Regime[]).map((regime) => {
        const list = regime === 'OLD' ? rules.surchargeOldBrackets : rules.surchargeNewBrackets;
        return (
          <Card key={`surcharge-${regime}`}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-[var(--dxp-text)]">
                    Surcharge — {regime === 'OLD' ? 'Old' : 'New'} Regime
                  </h2>
                  <p className="text-xs text-[var(--dxp-text-muted)]">
                    Additional surcharge on tax for high incomes. Each row is the income from which the rate
                    applies.
                  </p>
                </div>
                <Button variant="secondary" size="sm" onClick={() => addSurcharge(regime)}>
                  <Plus className="mr-1 h-3 w-3" /> Add bracket
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-[1fr_120px_auto] gap-2 px-2 pb-1 text-xs font-medium text-[var(--dxp-text-muted)]">
                <span>Income from (₹)</span>
                <span>Rate %</span>
                <span className="text-right">Actions</span>
              </div>
              <div className="space-y-2">
                {list.map((b, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-[1fr_120px_auto] items-center gap-2 rounded border border-[var(--dxp-border)] px-2 py-2"
                  >
                    <Input
                      type="number"
                      min={0}
                      step={100000}
                      value={toRupees(b.lowerPaisa)}
                      onChange={(e) => updateSurcharge(regime, idx, 'lowerPaisa', e.target.value)}
                      className="font-mono"
                    />
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={b.ratePct}
                      onChange={(e) => updateSurcharge(regime, idx, 'ratePct', e.target.value)}
                      className="font-mono"
                    />
                    <div className="flex justify-end">
                      <Button variant="ghost" onClick={() => removeSurcharge(regime, idx)} title="Remove">
                        <Trash2 className="h-4 w-4 text-rose-600" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })}

      {/* ── 6. Presumptive ── */}
      <Card>
        <CardHeader>
          <h2 className="text-base font-bold text-[var(--dxp-text)]">Presumptive Taxation</h2>
          <p className="text-xs text-[var(--dxp-text-muted)]">
            Sections 44AD (business) and 44ADA (professionals) — presumed-income percentages and turnover /
            receipt eligibility limits.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-3 rounded-lg border border-[var(--dxp-border)] p-4">
              <h3 className="text-sm font-semibold text-[var(--dxp-text)]">44AD — Business</h3>
              <LabeledInput
                label="Digital receipts %"
                type="number"
                step={0.5}
                value={rules.presumptiveRules.ad.digitalPct}
                onChange={(e) => updatePresumptive('ad', 'digitalPct', num(e.target.value))}
                className="font-mono"
              />
              <LabeledInput
                label="Cash receipts %"
                type="number"
                step={0.5}
                value={rules.presumptiveRules.ad.cashPct}
                onChange={(e) => updatePresumptive('ad', 'cashPct', num(e.target.value))}
                className="font-mono"
              />
              <LabeledInput
                label="Turnover limit (₹)"
                type="number"
                value={toRupees(rules.presumptiveRules.ad.turnoverLimitPaisa)}
                onChange={(e) => updatePresumptive('ad', 'turnoverLimitPaisa', toPaisa(e.target.value))}
                className="font-mono"
              />
            </div>
            <div className="space-y-3 rounded-lg border border-[var(--dxp-border)] p-4">
              <h3 className="text-sm font-semibold text-[var(--dxp-text)]">44ADA — Professionals</h3>
              <LabeledInput
                label="Presumed income %"
                type="number"
                step={0.5}
                value={rules.presumptiveRules.ada.pct}
                onChange={(e) => updatePresumptive('ada', 'pct', num(e.target.value))}
                className="font-mono"
              />
              <LabeledInput
                label="Receipt limit (₹)"
                type="number"
                value={toRupees(rules.presumptiveRules.ada.receiptLimitPaisa)}
                onChange={(e) => updatePresumptive('ada', 'receiptLimitPaisa', toPaisa(e.target.value))}
                className="font-mono"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Footer save */}
      <div className="flex justify-end">
        <Button variant="primary" onClick={save} disabled={isSaving}>
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save changes
        </Button>
      </div>
    </div>
  );
}
