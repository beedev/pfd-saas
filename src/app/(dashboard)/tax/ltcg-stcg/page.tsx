'use client';

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Button, Card, CardHeader, CardContent, StatsDisplay, Badge, Input, Select } from '@dxp/ui';
import { Plus, Loader2, TrendingUp, TrendingDown, Trash2 } from 'lucide-react';
import { getCurrentFinancialYear } from '@/lib/finance/tax-constants';

interface CapGainEntry {
  id: number;
  assetType: string;
  assetName: string;
  purchaseDate: string | null;
  saleDate: string;
  purchasePrice: number;
  salePrice: number;
  capitalGain: number;
  holdingPeriod: string;
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
}

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(paisa / 100);

function previousFy(): string {
  const current = getCurrentFinancialYear();
  const s = Number(current.split('-')[0]) - 1;
  return `${s}-${String((s + 1) % 100).padStart(2, '0')}`;
}

function generateFyOptions(): Array<{ value: string; label: string }> {
  const currentStart = Number(getCurrentFinancialYear().split('-')[0]);
  return Array.from({ length: 4 }, (_, i) => {
    const s = currentStart - 3 + i;
    return { value: `${s}-${String((s + 1) % 100).padStart(2, '0')}`, label: `FY ${s}-${String((s + 1) % 100).padStart(2, '0')}` };
  });
}

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

export default function CapitalGainsPage() {
  const [fy, setFy] = useState(previousFy());
  const [entries, setEntries] = useState<CapGainEntry[]>([]);
  const [summary, setSummary] = useState<Summary>({ ltcgTotal: 0, stcgTotal: 0, totalTax: 0, totalExemption: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

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

  useEffect(() => { load(); }, [load]);

  // Auto-set tax rate based on holding period
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
      setFormAssetName(''); setFormPurchaseDate(''); setFormSaleDate('');
      setFormPurchasePrice(''); setFormSalePrice(''); setFormExemption('0'); setFormNotes('');
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

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-[var(--dxp-text-muted)]" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">Capital Gains</h1>
          <p className="text-[var(--dxp-text-secondary)]">Realized capital gains for FY {fy}</p>
        </div>
        <div className="flex gap-3">
          <div className="w-40"><Select options={generateFyOptions()} value={fy} onChange={setFy} /></div>
          <Button variant="primary" onClick={() => setShowForm(true)}><Plus className="mr-2 h-4 w-4" /> Add entry</Button>
        </div>
      </div>

      <StatsDisplay
        currency="INR" locale="en-IN" columns={4}
        stats={[
          { label: 'LTCG Total', value: summary.ltcgTotal / 100, format: 'currency' },
          { label: 'STCG Total', value: summary.stcgTotal / 100, format: 'currency' },
          { label: 'Exemptions Applied', value: summary.totalExemption / 100, format: 'currency' },
          { label: 'Total Tax on Gains', value: summary.totalTax / 100, format: 'currency' },
        ]}
      />

      {showForm && (
        <Card>
          <CardHeader><h3 className="text-base font-bold text-[var(--dxp-text)]">New Capital Gain Entry</h3></CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Asset Type</label>
                <Select options={ASSET_TYPE_OPTIONS} value={formAssetType} onChange={setFormAssetType} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Asset Name</label>
                <Input value={formAssetName} onChange={(e) => setFormAssetName(e.target.value)} placeholder="e.g., Reliance Industries" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Holding Period</label>
                <Select options={HOLDING_OPTIONS} value={formHolding} onChange={setFormHolding} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Purchase Date</label>
                <Input type="date" value={formPurchaseDate} onChange={(e) => setFormPurchaseDate(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Sale Date</label>
                <Input type="date" value={formSaleDate} onChange={(e) => setFormSaleDate(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Purchase Price (₹)</label>
                <Input type="number" value={formPurchasePrice} onChange={(e) => setFormPurchasePrice(e.target.value)} placeholder="e.g., 100000" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Sale Price (₹)</label>
                <Input type="number" value={formSalePrice} onChange={(e) => setFormSalePrice(e.target.value)} placeholder="e.g., 150000" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Exemption (₹)</label>
                <Input type="number" value={formExemption} onChange={(e) => setFormExemption(e.target.value)} placeholder="e.g., 125000" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Tax Rate (%)</label>
                <Input type="number" step="0.1" value={formTaxRate} onChange={(e) => setFormTaxRate(e.target.value)} />
              </div>
            </div>
            {formPurchasePrice && formSalePrice && (
              <div className="mt-3 rounded-lg bg-[var(--dxp-surface-alt,var(--dxp-surface))] p-3 text-sm">
                <span className="text-[var(--dxp-text-muted)]">Gain: </span>
                <span className={`font-mono font-bold ${Number(formSalePrice) - Number(formPurchasePrice) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  ₹{(Number(formSalePrice) - Number(formPurchasePrice)).toLocaleString('en-IN')}
                </span>
                <span className="text-[var(--dxp-text-muted)]"> → Taxable: </span>
                <span className="font-mono font-bold text-[var(--dxp-text)]">
                  ₹{Math.max(0, Number(formSalePrice) - Number(formPurchasePrice) - Number(formExemption || 0)).toLocaleString('en-IN')}
                </span>
                <span className="text-[var(--dxp-text-muted)]"> → Tax @ {formTaxRate}%: </span>
                <span className="font-mono font-bold text-rose-600">
                  ₹{Math.round(Math.max(0, Number(formSalePrice) - Number(formPurchasePrice) - Number(formExemption || 0)) * Number(formTaxRate) / 100).toLocaleString('en-IN')}
                </span>
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button variant="primary" onClick={addEntry} disabled={isSaving}>
                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Add Entry
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><h2 className="text-base font-bold text-[var(--dxp-text)]">Entries ({entries.length})</h2></CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <p className="py-4 text-center text-[var(--dxp-text-muted)]">No capital gain entries for FY {fy}. Click "Add entry" to record a realized gain.</p>
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
                    <th className="pb-2 pr-3 text-right">Exemption</th>
                    <th className="pb-2 pr-3 text-right">Tax</th>
                    <th className="pb-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id} className="border-b border-[var(--dxp-border-light)]">
                      <td className="py-2 pr-3 font-medium text-[var(--dxp-text)]">{e.assetName}</td>
                      <td className="py-2 pr-3">
                        <Badge variant={e.holdingPeriod === 'LTCG' ? 'info' : 'warning'}>{e.holdingPeriod}</Badge>
                      </td>
                      <td className="py-2 pr-3 text-[var(--dxp-text-secondary)]">{e.saleDate}</td>
                      <td className="py-2 pr-3 text-right font-mono">{formatINR(e.purchasePrice)}</td>
                      <td className="py-2 pr-3 text-right font-mono">{formatINR(e.salePrice)}</td>
                      <td className={`py-2 pr-3 text-right font-mono font-bold ${e.capitalGain >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {formatINR(e.capitalGain)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-[var(--dxp-text-muted)]">{formatINR(e.exemptionApplied)}</td>
                      <td className="py-2 pr-3 text-right font-mono text-rose-600">{formatINR(e.taxAmount)}</td>
                      <td className="py-2">
                        <Button variant="ghost" size="sm" onClick={() => deleteEntry(e.id)}>
                          <Trash2 className="h-4 w-4 text-rose-500" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><h3 className="text-base font-bold text-[var(--dxp-text)]">Tax Rates (Budget 2024)</h3></CardHeader>
        <CardContent>
          <ul className="space-y-1 text-sm text-[var(--dxp-text-secondary)]">
            <li>• Equity LTCG ({'>'}12 months): 12.5% above ₹1.25L exemption per year</li>
            <li>• Equity STCG (≤12 months): 20%</li>
            <li>• Debt MF: Taxed at slab rate (no indexation from April 2023)</li>
            <li>• Gold LTCG ({'>'}36 months for physical, {'>'}12 months for ETF): 12.5%</li>
            <li>• Real Estate LTCG ({'>'}24 months): 12.5% without indexation</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
