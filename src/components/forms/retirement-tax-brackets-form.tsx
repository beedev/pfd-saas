'use client';

/**
 * Retirement tax brackets — Settings card. Sprint 5.8d.
 *
 * Lets the user edit the slab brackets used by the /retirement
 * page's year-by-year Tax column. Default seed: 0% up to ₹10L, 15%
 * ₹10L-₹30L, 25% above ₹30L.
 *
 * UI conventions:
 *   • Table of {threshold (₹), rate (%)} rows + delete button.
 *   • First row's threshold is locked at 0 (slab math invariant).
 *   • "+ Add bracket" appends a new row with threshold = previous +
 *     ₹10L and rate = previous + 5pp (sensible starting point).
 *   • "Save brackets" commits to /api/user-preferences in one go
 *     (avoids the partial-save mess of per-row commits when the
 *     order/values are interdependent).
 *   • "Reset to defaults" restores the seed JSON.
 *   • Validation client-side: thresholds ascending, rates 0..100,
 *     max 8 brackets. Server re-validates.
 */

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardHeader, CardContent, Button, Input, Badge } from '@dxp/ui';
import { Receipt, Loader2, Plus, Trash2, RotateCcw } from 'lucide-react';
import {
  DEFAULT_RETIREMENT_TAX_BRACKETS,
  type RetirementTaxBracket,
} from '@/lib/finance/retirement-tax';

interface Row {
  threshold: string;
  ratePct: string;
}

const MAX_BRACKETS = 8;

function bracketsToRows(bs: RetirementTaxBracket[]): Row[] {
  return bs.map((b) => ({
    threshold: String(b.threshold),
    ratePct: String(b.ratePct),
  }));
}

function rowsToBrackets(rows: Row[]): RetirementTaxBracket[] {
  return rows.map((r) => ({
    threshold: Math.max(0, parseFloat(r.threshold) || 0),
    ratePct: Math.max(0, Math.min(100, parseFloat(r.ratePct) || 0)),
  }));
}

export function RetirementTaxBracketsForm() {
  const [rows, setRows] = useState<Row[]>(bracketsToRows(DEFAULT_RETIREMENT_TAX_BRACKETS));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/user-preferences')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const bs = d?.preferences?.retirementTaxBrackets;
        if (Array.isArray(bs) && bs.length > 0) {
          setRows(bracketsToRows(bs as RetirementTaxBracket[]));
        }
      })
      .catch(() => toast.error('Failed to load retirement tax brackets'))
      .finally(() => setLoading(false));
  }, []);

  const updateRow = (idx: number, key: keyof Row, value: string) => {
    setRows((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [key]: value };
      return next;
    });
  };

  const addBracket = () => {
    if (rows.length >= MAX_BRACKETS) {
      toast.error(`Maximum ${MAX_BRACKETS} brackets`);
      return;
    }
    setRows((prev) => {
      const last = prev[prev.length - 1];
      const lastThreshold = parseFloat(last?.threshold ?? '0') || 0;
      const lastRate = parseFloat(last?.ratePct ?? '0') || 0;
      return [
        ...prev,
        {
          threshold: String(lastThreshold + 1000000),
          ratePct: String(Math.min(100, lastRate + 5)),
        },
      ];
    });
  };

  const deleteRow = (idx: number) => {
    if (idx === 0) {
      toast.error('First row (threshold 0) cannot be deleted');
      return;
    }
    setRows((prev) => prev.filter((_, i) => i !== idx));
  };

  const resetDefaults = () => {
    setRows(bracketsToRows(DEFAULT_RETIREMENT_TAX_BRACKETS));
    toast.info('Restored default brackets — click Save to commit.');
  };

  const validate = (bs: RetirementTaxBracket[]): string | null => {
    if (bs.length < 1) return 'At least one bracket required';
    if (bs.length > MAX_BRACKETS) return `Maximum ${MAX_BRACKETS} brackets`;
    if (bs[0].threshold !== 0) return 'First bracket threshold must be 0';
    for (let i = 1; i < bs.length; i++) {
      if (bs[i].threshold <= bs[i - 1].threshold) {
        return `Bracket ${i + 1} threshold must be greater than bracket ${i}`;
      }
    }
    for (const b of bs) {
      if (b.ratePct < 0 || b.ratePct > 100) return 'Rate must be between 0 and 100';
    }
    return null;
  };

  const save = async () => {
    const bs = rowsToBrackets(rows);
    const err = validate(bs);
    if (err) {
      toast.error(err);
      return;
    }
    setSaving(true);
    try {
      const r = await fetch('/api/user-preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retirementTaxBrackets: bs }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error || 'Save failed');
      }
      toast.success('Retirement tax brackets saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <h2 className="flex items-center gap-2 text-lg font-bold text-[var(--dxp-text)]">
          <Receipt className="h-5 w-5 text-[var(--dxp-brand)]" />
          Retirement tax brackets
        </h2>
        <p className="text-sm text-[var(--dxp-text-secondary)]">
          Marginal slabs applied to your retirement-year TAXABLE income (rental + annuity +
          NPS pension). Ladder maturities are tax-free under Section 10(10D). These
          aren&apos;t real tax slabs — they&apos;re your planning proxy for how much of
          retirement income survives tax.
        </p>
        <p className="mt-1 text-xs text-[var(--dxp-text-muted)]">
          Threshold is the LOWER bound of each band in rupees. First row must be 0.
          Thresholds must be strictly ascending. Max {MAX_BRACKETS} brackets.
        </p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-[var(--dxp-text-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <div className="mb-3 grid grid-cols-[1fr_140px_auto] items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
              <span>Threshold (₹)</span>
              <span>Rate (%)</span>
              <span className="text-right">Actions</span>
            </div>
            <div className="space-y-2">
              {rows.map((row, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-[1fr_140px_auto] items-center gap-2 rounded border border-[var(--dxp-border)] px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      step={50000}
                      value={row.threshold}
                      onChange={(e) => updateRow(idx, 'threshold', e.target.value)}
                      disabled={idx === 0}
                      className="font-mono"
                    />
                    {idx === 0 && <Badge variant="info">First (locked)</Badge>}
                  </div>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={row.ratePct}
                    onChange={(e) => updateRow(idx, 'ratePct', e.target.value)}
                    className="font-mono"
                  />
                  <div className="flex justify-end">
                    <Button
                      variant="ghost"
                      onClick={() => deleteRow(idx)}
                      disabled={idx === 0}
                      title={idx === 0 ? 'Cannot delete first row' : 'Delete bracket'}
                    >
                      <Trash2 className="h-4 w-4 text-rose-600" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={addBracket} disabled={rows.length >= MAX_BRACKETS}>
                <Plus className="mr-1 h-4 w-4" /> Add bracket
              </Button>
              <Button variant="ghost" onClick={resetDefaults}>
                <RotateCcw className="mr-1 h-4 w-4" /> Reset to defaults
              </Button>
              <div className="grow" />
              <Button variant="primary" onClick={save} disabled={saving}>
                {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                Save brackets
              </Button>
            </div>
            <p className="mt-3 text-xs text-[var(--dxp-text-muted)]">
              Preview:{' '}
              {rowsToBrackets(rows).map((b, i, arr) => {
                const next = arr[i + 1];
                const upper = next ? next.threshold : null;
                return (
                  <span key={i}>
                    {b.ratePct}%{' '}
                    {i === 0 && upper != null
                      ? `up to ₹${(upper / 100000).toFixed(0)}L`
                      : ''}
                    {i > 0 && upper != null
                      ? `₹${(b.threshold / 100000).toFixed(0)}L-₹${(upper / 100000).toFixed(0)}L`
                      : ''}
                    {upper == null ? `above ₹${(b.threshold / 100000).toFixed(0)}L` : ''}
                    {i < arr.length - 1 ? ', ' : ''}
                  </span>
                );
              })}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
