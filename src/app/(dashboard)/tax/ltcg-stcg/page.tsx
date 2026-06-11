'use client';

/**
 * Capital gains — pre/post reform grouping + cutoff banner.
 *
 * Sprint 5.2 commit 3 items G + U6.
 *
 * • Banner explains the 23 July 2024 cutoff (Budget 2024).
 * • Rows grouped into two sections:
 *     – Post-reform (saleDate >= 2024-07-23) at the new rates
 *     – Pre-reform  (saleDate <  2024-07-23) at legacy rates
 * • Each row shows the inferred applicable rate inline ("@ 12.5%", etc.)
 * • U6 — "Elect pre-reform indexed treatment" toggle on LTCG rows for
 *   DEBT_MF / REAL_ESTATE / GOLD with saleDate >= cutoff. Persistence
 *   deferred (would need migration 0027) — election is in-memory only
 *   in this commit; a banner explains.
 */

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Button, Card, CardHeader, CardContent, StatsDisplay, Badge, Input, Select } from '@dxp/ui';
import { Plus, Loader2, Trash2, Calendar, Info } from 'lucide-react';
import { useFinancialYear } from '@/components/providers/financial-year-provider';
import { ContextualImport } from '@/components/import/contextual-import';

interface CgParsed {
  type: 'cg-statement';
  broker: string;
  fy: string | null;
  rows: Array<{ assetType: string; holdingPeriod: 'LTCG' | 'STCG'; capitalGainPaisa: number; scrip: string | null }>;
  totalStcgPaisa: number;
  totalLtcgPaisa: number;
  warnings: string[];
}

const fmtINR = (p: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(p / 100);

interface CapGainEntry {
  id: number;
  assetType: string;
  assetName: string;
  purchaseDate: string | null;
  saleDate: string;
  purchasePrice: number;
  salePrice: number;
  capitalGain: number;
  holdingPeriod: string; // LTCG | STCG
  exemptionApplied: number;
  taxableGain: number;
  taxRate: number;
  taxAmount: number;
  notes: string | null;
}

interface Summary {
  ltcgTotal: number;
  stcgTotal: number;
  totalTax: number;
  totalExemption: number;
  /** Aggregate-correct CG tax (equity netted, sec-112A exemption applied
   *  once per FY). Falls back to per-row `totalTax` when absent. */
  aggregateTaxPaisa?: number;
}

const CG_CUTOFF = '2024-07-23';

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

const ASSET_TYPE_OPTIONS = [
  { value: 'STOCKS', label: 'Stocks' },
  { value: 'EQUITY_MF', label: 'Equity Mutual Funds' },
  { value: 'DEBT_MF', label: 'Debt Mutual Funds' },
  { value: 'GOLD', label: 'Gold' },
  { value: 'REAL_ESTATE', label: 'Real Estate' },
  { value: 'OTHER', label: 'Other' },
];

const HOLDING_OPTIONS = [
  { value: 'LTCG', label: 'Long Term (LTCG)' },
  { value: 'STCG', label: 'Short Term (STCG)' },
];

/** Asset classes that can elect pre-reform indexed treatment when sold
 *  on/after the cutoff — see Finance (No.2) Act 2024 transitional
 *  provision. */
const INDEX_ELECTION_TYPES = new Set(['DEBT_MF', 'REAL_ESTATE', 'GOLD']);

/** Derive a human-readable rate label for a row. */
function rateLabel(row: CapGainEntry): string {
  if (row.taxRate > 0) return `@ ${row.taxRate}%`;
  if (row.holdingPeriod === 'LTCG') return '@ 12.5%';
  return '@ 20%';
}

export default function CapitalGainsPage() {
  const { fy } = useFinancialYear();
  const [entries, setEntries] = useState<CapGainEntry[]>([]);
  const [summary, setSummary] = useState<Summary>({
    ltcgTotal: 0,
    stcgTotal: 0,
    totalTax: 0,
    totalExemption: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  // U6 — election state (in-memory only, persistence deferred)
  const [elections, setElections] = useState<Record<number, boolean>>({});

  // Form state
  const [formAssetType, setFormAssetType] = useState('STOCKS');
  const [formAssetName, setFormAssetName] = useState('');
  const [formPurchaseDate, setFormPurchaseDate] = useState('');
  const [formSaleDate, setFormSaleDate] = useState('');
  const [formPurchasePrice, setFormPurchasePrice] = useState('');
  const [formSalePrice, setFormSalePrice] = useState('');
  const [formHolding, setFormHolding] = useState('LTCG');
  const [formExemption, setFormExemption] = useState('0');
  const [formTaxRate, setFormTaxRate] = useState('12.5');
  const [formNotes, setFormNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const r = await fetch(`/api/tax/capital-gains?fy=${fy}`).then((r) => r.json());
      setEntries(r.entries ?? []);
      setSummary(r.summary ?? { ltcgTotal: 0, stcgTotal: 0, totalTax: 0, totalExemption: 0 });
    } finally {
      setIsLoading(false);
    }
  }, [fy]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setFormTaxRate(formHolding === 'LTCG' ? '12.5' : '20');
  }, [formHolding]);

  const addEntry = async () => {
    const purchase = Number(formPurchasePrice);
    const sale = Number(formSalePrice);
    if (!formAssetName || !formSaleDate || !purchase || !sale) {
      toast.error('Fill in asset name, sale date, purchase price, and sale price');
      return;
    }
    setIsSaving(true);
    try {
      const r = await fetch('/api/tax/capital-gains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          financialYear: fy,
          assetType: formAssetType,
          assetName: formAssetName,
          purchaseDate: formPurchaseDate || null,
          saleDate: formSaleDate,
          purchasePrice: purchase,
          salePrice: sale,
          holdingPeriod: formHolding,
          exemption: Number(formExemption) || 0,
          taxRate: Number(formTaxRate),
          notes: formNotes || null,
        }),
      });
      if (!r.ok) throw new Error('Failed');
      toast.success('Capital gain entry added');
      setShowForm(false);
      setFormAssetName('');
      setFormPurchaseDate('');
      setFormSaleDate('');
      setFormPurchasePrice('');
      setFormSalePrice('');
      setFormExemption('0');
      setFormNotes('');
      load();
    } catch {
      toast.error('Failed to add entry');
    } finally {
      setIsSaving(false);
    }
  };

  const deleteEntry = async (id: number) => {
    if (!confirm('Delete this entry?')) return;
    await fetch(`/api/tax/capital-gains?id=${id}`, { method: 'DELETE' });
    toast.success('Deleted');
    load();
  };

  const toggleElection = (id: number) => {
    setElections((prev) => ({ ...prev, [id]: !prev[id] }));
    toast.info('Election applied for this session — persistence ships in a follow-up.');
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--dxp-text-muted)]" />
      </div>
    );
  }

  const postReform = entries.filter((e) => e.saleDate >= CG_CUTOFF);
  const preReform = entries.filter((e) => e.saleDate < CG_CUTOFF);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
            Capital Gains
          </h1>
          <p className="text-[var(--dxp-text-secondary)]">Realized capital gains for FY {fy}</p>
        </div>
        <div className="flex gap-3">
          <ContextualImport<CgParsed>
            buttonLabel="Import statement"
            title="Import a capital-gains statement"
            subtitle="KFINTECH / CAMS capital-gains PDF, or a Zerodha tax-P&L .xlsx"
            accept=".pdf,.xlsx"
            canImport={(p) => p?.type === 'cg-statement' && p.rows.length > 0 && !!(p.fy || fy)}
            commit={async (p) => {
              const r = await fetch('/api/investments/import/commit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'cg-statement', fy: p.fy || fy, rows: p.rows }),
              });
              const d = await r.json();
              if (!r.ok) throw new Error(d?.error || 'Import failed');
            }}
            onImported={load}
            renderPreview={(p) => (
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <Badge variant="info">{p.broker}</Badge>
                  {p.fy && <span className="text-xs text-[var(--dxp-text-muted)]">FY {p.fy}</span>}
                  <span className="ml-auto text-xs">
                    STCG <strong>{fmtINR(p.totalStcgPaisa)}</strong> · LTCG <strong>{fmtINR(p.totalLtcgPaisa)}</strong>
                  </span>
                </div>
                {p.rows.map((row, i) => (
                  <div key={i} className="flex items-center justify-between border-t border-[var(--dxp-border-light)] pt-1 text-xs">
                    <span>{row.scrip || row.assetType} · {row.holdingPeriod}</span>
                    <span className={`font-mono ${row.capitalGainPaisa < 0 ? 'text-red-600' : ''}`}>{fmtINR(row.capitalGainPaisa)}</span>
                  </div>
                ))}
                {p.warnings.map((w, i) => (
                  <p key={i} className="rounded bg-amber-50 p-2 text-xs text-amber-800">⚠ {w}</p>
                ))}
                {p.rows.length === 0 && (
                  <p className="text-xs text-[var(--dxp-text-muted)]">Nothing to import — add manually instead.</p>
                )}
              </div>
            )}
          />
          <Button variant="primary" onClick={() => setShowForm(true)}>
            <Plus className="mr-2 h-4 w-4" /> Add entry
          </Button>
        </div>
      </div>

      {/* G — Cutoff banner */}
      <div className="rounded-md border border-sky-300 bg-sky-50/40 p-3">
        <div className="flex items-start gap-2">
          <Calendar className="mt-0.5 h-4 w-4 flex-shrink-0 text-sky-700" />
          <div className="text-sm text-[var(--dxp-text)]">
            <p className="font-bold">
              23 July 2024 reform — capital gains tax brackets changed mid-FY 2024-25.
            </p>
            <p className="mt-0.5 text-xs text-[var(--dxp-text-secondary)]">
              Sales <strong>before</strong> the cutoff use legacy rates (LTCG eq 10% / debt slab /
              real estate 20% with indexation). Sales <strong>on/after</strong> use the new
              flat rates (LTCG 12.5% across asset classes, STCG eq 20%, debt MF slab). Indexation
              was withdrawn for LTCG on debt MF / real estate / gold sold on/after the cutoff
              (with a one-time election option for property bought before 23 Jul 2024).
            </p>
          </div>
        </div>
      </div>

      <StatsDisplay
        currency="INR"
        locale="en-IN"
        columns={4}
        stats={[
          { label: 'LTCG Total', value: summary.ltcgTotal / 100, format: 'currency' },
          { label: 'STCG Total', value: summary.stcgTotal / 100, format: 'currency' },
          { label: 'Exemptions Applied', value: summary.totalExemption / 100, format: 'currency' },
          { label: 'Total Tax on Gains', value: (summary.aggregateTaxPaisa ?? summary.totalTax) / 100, format: 'currency' },
        ]}
      />

      {showForm && (
        <Card>
          <CardHeader>
            <h3 className="text-base font-bold text-[var(--dxp-text)]">New Capital Gain Entry</h3>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                  Asset Type
                </label>
                <Select options={ASSET_TYPE_OPTIONS} value={formAssetType} onChange={setFormAssetType} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                  Asset Name
                </label>
                <Input
                  value={formAssetName}
                  onChange={(e) => setFormAssetName(e.target.value)}
                  placeholder="e.g., Reliance Industries"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                  Holding Period
                </label>
                <Select options={HOLDING_OPTIONS} value={formHolding} onChange={setFormHolding} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                  Purchase Date
                </label>
                <Input
                  type="date"
                  value={formPurchaseDate}
                  onChange={(e) => setFormPurchaseDate(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                  Sale Date
                </label>
                <Input
                  type="date"
                  value={formSaleDate}
                  onChange={(e) => setFormSaleDate(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                  Purchase Price (₹)
                </label>
                <Input
                  type="number"
                  value={formPurchasePrice}
                  onChange={(e) => setFormPurchasePrice(e.target.value)}
                  placeholder="e.g., 100000"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                  Sale Price (₹)
                </label>
                <Input
                  type="number"
                  value={formSalePrice}
                  onChange={(e) => setFormSalePrice(e.target.value)}
                  placeholder="e.g., 150000"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                  Exemption (₹)
                </label>
                <Input
                  type="number"
                  value={formExemption}
                  onChange={(e) => setFormExemption(e.target.value)}
                  placeholder="e.g., 125000"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                  Tax Rate (%)
                </label>
                <Input
                  type="number"
                  step="0.1"
                  value={formTaxRate}
                  onChange={(e) => setFormTaxRate(e.target.value)}
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={addEntry} disabled={isSaving}>
                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Add Entry
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* U6 — election persistence note */}
      {entries.some((e) => INDEX_ELECTION_TYPES.has(e.assetType) && e.holdingPeriod === 'LTCG' && e.saleDate >= CG_CUTOFF) && (
        <div className="rounded-md border border-amber-300 bg-amber-50/40 p-3 text-xs text-[var(--dxp-text-secondary)]">
          <Info className="mr-1 inline h-3 w-3" />
          Per-row "elect pre-reform indexed treatment" is available below for eligible LTCG rows
          on debt MF / real estate / gold sold on/after the cutoff. Election is in-memory in this
          iteration; <strong>persistence ships in a follow-up migration</strong>.
        </div>
      )}

      <SectionTable
        title={`Post-reform sales (on/after ${CG_CUTOFF})`}
        rows={postReform}
        elections={elections}
        onElect={toggleElection}
        showElectionToggle
        onDelete={deleteEntry}
      />
      <SectionTable
        title={`Pre-reform sales (before ${CG_CUTOFF})`}
        rows={preReform}
        elections={elections}
        onElect={toggleElection}
        showElectionToggle={false}
        onDelete={deleteEntry}
      />

      <Card>
        <CardHeader>
          <h3 className="text-base font-bold text-[var(--dxp-text)]">
            Tax Rates (post-23 Jul 2024)
          </h3>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1 text-sm text-[var(--dxp-text-secondary)]">
            <li>• Equity LTCG (&gt;12 months): 12.5% above ₹1.25L exemption per year</li>
            <li>• Equity STCG (≤12 months): 20%</li>
            <li>• Debt MF: Taxed at slab rate (no indexation from April 2023)</li>
            <li>• Gold LTCG (&gt;24 months physical, &gt;12 months ETF): 12.5%</li>
            <li>• Real Estate LTCG (&gt;24 months): 12.5% without indexation (election to use 20% w/ indexation if purchased pre-23 Jul 2024)</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function SectionTable({
  title,
  rows,
  elections,
  onElect,
  showElectionToggle,
  onDelete,
}: {
  title: string;
  rows: CapGainEntry[];
  elections: Record<number, boolean>;
  onElect: (id: number) => void;
  showElectionToggle: boolean;
  onDelete: (id: number) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <h2 className="text-base font-bold text-[var(--dxp-text)]">
          {title} ({rows.length})
        </h2>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-3 text-center text-sm text-[var(--dxp-text-muted)]">No entries.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--dxp-border)] text-left text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                  <th className="pb-2 pr-3">Asset</th>
                  <th className="pb-2 pr-3">Type</th>
                  <th className="pb-2 pr-3">Sale Date</th>
                  <th className="pb-2 pr-3 text-right">Purchase</th>
                  <th className="pb-2 pr-3 text-right">Sale</th>
                  <th className="pb-2 pr-3 text-right">Gain</th>
                  <th className="pb-2 pr-3 text-right">Tax</th>
                  <th className="pb-2 pr-3">Rate</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => {
                  const electionEligible =
                    showElectionToggle &&
                    INDEX_ELECTION_TYPES.has(e.assetType) &&
                    e.holdingPeriod === 'LTCG';
                  const elected = Boolean(elections[e.id]);
                  return (
                    <tr key={e.id} className="border-b border-[var(--dxp-border-light)]">
                      <td className="py-2 pr-3 font-medium text-[var(--dxp-text)]">
                        {e.assetName}
                        <p className="text-[10px] text-[var(--dxp-text-muted)]">{e.assetType}</p>
                      </td>
                      <td className="py-2 pr-3">
                        <Badge variant={e.holdingPeriod === 'LTCG' ? 'info' : 'warning'}>
                          {e.holdingPeriod}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3 text-[var(--dxp-text-secondary)]">{e.saleDate}</td>
                      <td className="py-2 pr-3 text-right font-mono">
                        {formatINR(e.purchasePrice)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono">{formatINR(e.salePrice)}</td>
                      <td
                        className={`py-2 pr-3 text-right font-mono font-bold ${
                          e.capitalGain >= 0 ? 'text-emerald-600' : 'text-rose-600'
                        }`}
                      >
                        {formatINR(e.capitalGain)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-rose-600">
                        {formatINR(e.taxAmount)}
                      </td>
                      <td className="py-2 pr-3 text-xs font-mono text-[var(--dxp-text-secondary)]">
                        {rateLabel(e)}
                        {electionEligible && (
                          <label className="ml-2 inline-flex items-center gap-1 text-[10px] text-amber-700">
                            <input
                              type="checkbox"
                              checked={elected}
                              onChange={() => onElect(e.id)}
                              className="h-3 w-3"
                            />
                            <span>elect pre-reform indexed</span>
                          </label>
                        )}
                      </td>
                      <td className="py-2 flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => onDelete(e.id)} title="Delete">
                          <Trash2 className="h-3 w-3 text-rose-500" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
