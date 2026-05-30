'use client';

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Button, Card, CardHeader, CardContent, Badge, Input, Select } from '@dxp/ui';
import {
  Bell,
  Loader2,
  Plus,
  Trash2,
  Zap,
  ChevronDown,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';

interface AlertRule {
  id: number;
  name: string;
  category: string;
  ruleType: string;
  symbol: string | null;
  assetId: number | null;
  operator: string | null;
  threshold: number;
  isEnabled: boolean;
  cooldownHours: number | null;
}

interface HistoryRow {
  id: number;
  ruleId: number;
  ruleName: string | null;
  ruleCategory: string | null;
  message: string;
  triggeredValue: number | null;
  sentAt: string | number | null;
}

const CATEGORY_OPTIONS = [
  { value: 'MARKET', label: 'Market' },
  { value: 'PAYMENT', label: 'Payment' },
  { value: 'PORTFOLIO', label: 'Portfolio' },
];

const RULE_TYPE_OPTIONS = [
  { value: 'INDEX_CHANGE', label: 'Index % change (e.g., Nifty 3%)' },
  { value: 'PRICE_LEVEL', label: 'Price level (e.g., Gold > ₹16K)' },
  { value: 'VIX_BREACH', label: 'VIX breach' },
  { value: 'CREDIT_CARD_DUE', label: 'Credit card due (days before)' },
  { value: 'CHIT_DUE', label: 'Chit installment due (days before)' },
  { value: 'INSURANCE_DUE', label: 'Insurance premium due (days before)' },
  { value: 'LOAN_EMI_DUE', label: 'Loan EMI due (days before)' },
  { value: 'MF_WEEKLY_DROP', label: 'MF weekly drop (%)' },
  { value: 'NET_WORTH_MILESTONE', label: 'Net worth milestone (₹)' },
  { value: 'BUDGET_OVERSPEND', label: 'Budget overspend (%)' },
];

const OPERATOR_OPTIONS = [
  { value: 'GT', label: '>' },
  { value: 'LT', label: '<' },
  { value: 'CROSSES_ABOVE', label: 'Crosses above' },
  { value: 'CROSSES_BELOW', label: 'Crosses below' },
  { value: 'CHANGE_PCT_GT', label: '% change >' },
  { value: 'CHANGE_PCT_LT', label: '% change <' },
];

const categoryBadge = (cat: string) => {
  switch (cat) {
    case 'MARKET': return <Badge variant="info">Market</Badge>;
    case 'PAYMENT': return <Badge variant="warning">Payment</Badge>;
    case 'PORTFOLIO': return <Badge variant="brand">Portfolio</Badge>;
    default: return <Badge variant="default">{cat}</Badge>;
  }
};

function ruleSummary(r: AlertRule): string {
  switch (r.ruleType) {
    case 'INDEX_CHANGE': return `${r.symbol?.replace('^', '') ?? '?'} moves >${r.threshold}%`;
    case 'PRICE_LEVEL': return `${r.symbol ?? '?'} ${r.operator === 'CROSSES_ABOVE' ? '↑' : '↓'} ₹${r.threshold.toLocaleString('en-IN')}`;
    case 'VIX_BREACH': return `VIX > ${r.threshold}`;
    case 'CREDIT_CARD_DUE': return `${r.threshold}d before due`;
    case 'CHIT_DUE': return `${r.threshold}d before due`;
    case 'INSURANCE_DUE': return `${r.threshold}d before due`;
    case 'LOAN_EMI_DUE': return `${r.threshold}d before due`;
    case 'MF_WEEKLY_DROP': return `Drop > ${r.threshold}%`;
    case 'NET_WORTH_MILESTONE': return `NW ≥ ₹${(r.threshold).toLocaleString('en-IN')}`;
    case 'BUDGET_OVERSPEND': return `Overspend > ${r.threshold}%`;
    default: return r.ruleType;
  }
}

export default function AlertsPage() {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isChecking, setIsChecking] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(true);

  // Add rule form
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formCategory, setFormCategory] = useState('MARKET');
  const [formRuleType, setFormRuleType] = useState('INDEX_CHANGE');
  const [formSymbol, setFormSymbol] = useState('');
  const [formOperator, setFormOperator] = useState('CHANGE_PCT_GT');
  const [formThreshold, setFormThreshold] = useState('');
  const [formCooldown, setFormCooldown] = useState('24');
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [rulesRes, histRes] = await Promise.all([
        fetch('/api/alerts/rules').then((r) => r.json()),
        fetch('/api/alerts/history').then((r) => r.json()),
      ]);
      setRules(rulesRes.rules ?? []);
      setHistory(histRes.history ?? []);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load alerts');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const runCheck = async () => {
    setIsChecking(true);
    try {
      const r = await fetch('/api/alerts/check', { method: 'POST' }).then((r) => r.json());
      toast.success(`Checked ${r.checked} rules — ${r.sent} alert${r.sent !== 1 ? 's' : ''} sent, ${r.deduplicated} deduped`);
      load();
    } catch {
      toast.error('Check failed');
    } finally {
      setIsChecking(false);
    }
  };

  const toggleRule = async (rule: AlertRule) => {
    try {
      await fetch(`/api/alerts/rules/${rule.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isEnabled: !rule.isEnabled }),
      });
      setRules((prev) =>
        prev.map((r) => (r.id === rule.id ? { ...r, isEnabled: !r.isEnabled } : r)),
      );
    } catch {
      toast.error('Failed to toggle');
    }
  };

  const deleteRule = async (id: number) => {
    if (!confirm('Delete this alert rule?')) return;
    try {
      await fetch(`/api/alerts/rules/${id}`, { method: 'DELETE' });
      toast.success('Rule deleted');
      load();
    } catch {
      toast.error('Failed to delete');
    }
  };

  const addRule = async () => {
    if (!formName || !formThreshold) { toast.error('Name and threshold required'); return; }
    setIsSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: formName,
        category: formCategory,
        ruleType: formRuleType,
        threshold: Number(formThreshold),
        cooldownHours: Number(formCooldown) || 24,
      };
      if (formSymbol) body.symbol = formSymbol;
      if (formOperator) body.operator = formOperator;

      const r = await fetch('/api/alerts/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error('Failed');
      toast.success('Rule added');
      setShowForm(false);
      setFormName(''); setFormSymbol(''); setFormThreshold('');
      load();
    } catch {
      toast.error('Failed to add rule');
    } finally {
      setIsSaving(false);
    }
  };

  const needsSymbol = ['INDEX_CHANGE', 'PRICE_LEVEL', 'VIX_BREACH'].includes(formRuleType);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--dxp-text-muted)]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
            <Bell className="h-8 w-8 text-[var(--dxp-brand)]" />
            Alerts
          </h1>
          <p className="text-[var(--dxp-text-secondary)]">
            Reactive alerts via Telegram — checks every 2 hours during market hours
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={runCheck} disabled={isChecking}>
            {isChecking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
            Run Check Now
          </Button>
          <Button variant="primary" size="sm" onClick={() => setShowForm(true)}>
            <Plus className="mr-2 h-4 w-4" /> Add Rule
          </Button>
        </div>
      </div>

      {/* Add Rule Form */}
      {showForm && (
        <Card>
          <CardHeader>
            <h3 className="text-base font-bold text-[var(--dxp-text)]">New Alert Rule</h3>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Name</label>
                <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g., Nifty 3% swing" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Category</label>
                <Select options={CATEGORY_OPTIONS} value={formCategory} onChange={setFormCategory} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Rule Type</label>
                <Select options={RULE_TYPE_OPTIONS} value={formRuleType} onChange={setFormRuleType} />
              </div>
              {needsSymbol && (
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Symbol</label>
                  <Input value={formSymbol} onChange={(e) => setFormSymbol(e.target.value)} placeholder="e.g., ^NSEI, GC=F" />
                </div>
              )}
              {needsSymbol && (
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Operator</label>
                  <Select options={OPERATOR_OPTIONS} value={formOperator} onChange={setFormOperator} />
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Threshold</label>
                <Input type="number" value={formThreshold} onChange={(e) => setFormThreshold(e.target.value)} placeholder="e.g., 3 for 3%" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">Cooldown (hours)</label>
                <Input type="number" value={formCooldown} onChange={(e) => setFormCooldown(e.target.value)} />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button variant="primary" onClick={addRule} disabled={isSaving}>
                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add Rule
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Rules Table */}
      <Card>
        <CardHeader>
          <h2 className="text-base font-bold text-[var(--dxp-text)]">
            Alert Rules ({rules.length})
          </h2>
        </CardHeader>
        <CardContent>
          {rules.length === 0 ? (
            <p className="py-4 text-center text-[var(--dxp-text-muted)]">No rules configured.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--dxp-border)] text-left text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                    <th className="pb-2 pr-3">Name</th>
                    <th className="pb-2 pr-3">Category</th>
                    <th className="pb-2 pr-3">Condition</th>
                    <th className="pb-2 pr-3">Cooldown</th>
                    <th className="pb-2 pr-3">Enabled</th>
                    <th className="pb-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((rule) => (
                    <tr key={rule.id} className={`border-b border-[var(--dxp-border-light)] ${!rule.isEnabled ? 'opacity-40' : ''}`}>
                      <td className="py-2 pr-3 font-medium text-[var(--dxp-text)]">{rule.name}</td>
                      <td className="py-2 pr-3">{categoryBadge(rule.category)}</td>
                      <td className="py-2 pr-3 font-mono text-xs text-[var(--dxp-text-secondary)]">{ruleSummary(rule)}</td>
                      <td className="py-2 pr-3 text-xs text-[var(--dxp-text-muted)]">{rule.cooldownHours}h</td>
                      <td className="py-2 pr-3">
                        <button onClick={() => toggleRule(rule)} className="text-[var(--dxp-text-muted)] hover:text-[var(--dxp-brand)]">
                          {rule.isEnabled
                            ? <ToggleRight className="h-5 w-5 text-emerald-500" />
                            : <ToggleLeft className="h-5 w-5" />}
                        </button>
                      </td>
                      <td className="py-2">
                        <Button variant="ghost" size="sm" onClick={() => deleteRule(rule.id)}>
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

      {/* Alert History */}
      <Card>
        <CardHeader>
          <button className="flex w-full items-center justify-between" onClick={() => setHistoryOpen((o) => !o)}>
            <h2 className="text-base font-bold text-[var(--dxp-text)]">
              Alert History ({history.length})
            </h2>
            <ChevronDown className={`h-5 w-5 text-[var(--dxp-text-muted)] transition-transform ${historyOpen ? 'rotate-180' : ''}`} />
          </button>
        </CardHeader>
        {historyOpen && (
          <CardContent>
            {history.length === 0 ? (
              <p className="py-4 text-center text-[var(--dxp-text-muted)]">No alerts sent yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--dxp-border)] text-left text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                      <th className="pb-2 pr-3">Time</th>
                      <th className="pb-2 pr-3">Rule</th>
                      <th className="pb-2 pr-3">Category</th>
                      <th className="pb-2 pr-3">Message</th>
                      <th className="pb-2 pr-3 text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.id} className="border-b border-[var(--dxp-border-light)]">
                        <td className="py-2 pr-3 text-xs text-[var(--dxp-text-muted)] whitespace-nowrap">
                          {h.sentAt ? new Date(typeof h.sentAt === 'number' ? h.sentAt * 1000 : h.sentAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-'}
                        </td>
                        <td className="py-2 pr-3 font-medium text-[var(--dxp-text)]">{h.ruleName ?? '-'}</td>
                        <td className="py-2 pr-3">{h.ruleCategory ? categoryBadge(h.ruleCategory) : '-'}</td>
                        <td className="py-2 pr-3 text-xs text-[var(--dxp-text-secondary)] max-w-xs truncate">{h.message.replace(/[*_`]/g, '')}</td>
                        <td className="py-2 pr-3 text-right font-mono text-xs">{h.triggeredValue?.toFixed(2) ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
