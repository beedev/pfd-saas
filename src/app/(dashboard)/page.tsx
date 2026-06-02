'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { Card, CardHeader, CardContent, Button, Badge, StatsDisplay } from '@dxp/ui';
import {
  TrendingUp,
  TrendingDown,
  Plus,
  Wallet,
  Target,
  FileSpreadsheet,
  Loader2,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { LineChart as ReLineChart, Line, ResponsiveContainer } from 'recharts';
import { toast } from 'sonner';

interface Holding {
  id: number;
  symbol: string;
  currentValue: number;
  totalInvestment: number;
  gainLoss: number;
  gainLossPercent: number;
}

interface MutualFund {
  id: number;
  currentValue: number;
  totalInvestment: number;
  gainLoss: number;
  gainLossPercent: number;
}

interface GoldHolding {
  id: number;
  currentValue: number | null;
  totalInvestment: number | null;
}
interface NPSAccount { id: number; totalValue: number }
interface PFAccount { id: number; totalBalance: number }
interface RealEstateProperty { id: number; currentValuation: number; mortgageAmount: number | null }
interface InsurancePolicy { id: number; policyType: string; investmentValue: number | null }
interface LiabilityRow { id: number; name: string; type: string; currentBalance: number }
interface ChitFundRow {
  id: number;
  netContribution: number | null;
}
interface FixedDepositRow {
  id: number;
  principalPaisa: number;
  status: 'ACTIVE' | 'MATURED' | 'BROKEN' | null;
}
interface ForexDepositRow {
  id: number;
  currencyCode: string;
  amountInCurrency: number;
  inrValuePaisa: number | null; // null = live rate unavailable
  status: 'ACTIVE' | 'MATURED' | 'CLOSED';
}
const CASH_VALUE_POLICIES = ['WHOLE_LIFE', 'ENDOWMENT', 'ULIP'];

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

const formatPercent = (value: number) =>
  `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

export default function NetWorthDashboard() {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [funds, setFunds] = useState<MutualFund[]>([]);
  const [gold, setGold] = useState<GoldHolding[]>([]);
  const [nps, setNps] = useState<NPSAccount[]>([]);
  const [pf, setPf] = useState<PFAccount[]>([]);
  const [properties, setProperties] = useState<RealEstateProperty[]>([]);
  const [policies, setPolicies] = useState<InsurancePolicy[]>([]);
  const [debts, setDebts] = useState<LiabilityRow[]>([]);
  const [chits, setChits] = useState<ChitFundRow[]>([]);
  const [fds, setFds] = useState<FixedDepositRow[]>([]);
  const [forex, setForex] = useState<ForexDepositRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sparkline, setSparkline] = useState<Array<{ date: string; value: number }>>([]);
  const [hasTodaySnapshot, setHasTodaySnapshot] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  // Sprint 5.9d — net worth transparency: collapsible asset/liability
  // breakdown directly under the hero tile.
  const [breakdownOpen, setBreakdownOpen] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/investments/stocks').then((r) => r.json()),
      fetch('/api/investments/mutual-funds').then((r) => r.json()),
      fetch('/api/investments/gold').then((r) => r.json()),
      fetch('/api/investments/nps').then((r) => r.json()),
      fetch('/api/investments/pf').then((r) => r.json()),
      fetch('/api/investments/real-estate').then((r) => r.json()),
      fetch('/api/investments/insurance').then((r) => r.json()),
      fetch('/api/investments/liabilities').then((r) => r.json()),
      fetch('/api/investments/chit-funds').then((r) => r.json()),
      fetch('/api/investments/fixed-deposits').then((r) => r.json()),
      fetch('/api/investments/forex-deposits').then((r) => r.json()),
    ])
      .then(([stocksData, mfData, goldData, npsData, pfData, reData, insData, liaData, chitData, fdData, forexData]) => {
        setHoldings(stocksData.holdings || []);
        setFunds(mfData.mutualFunds || []);
        setGold(goldData.gold || []);
        setNps(npsData.accounts || []);
        setPf(pfData.accounts || []);
        setProperties(reData.properties || []);
        setPolicies(insData.policies || []);
        setDebts(liaData.liabilities || []);
        setChits(chitData.chitFunds || []);
        setFds(fdData.fixedDeposits || []);
        setForex(forexData.forexDeposits || []);
      })
      .catch(() => {
        setHoldings([]);
        setFunds([]);
        setGold([]);
      })
      .finally(() => setIsLoading(false));

    // Load 30-day history for sparkline
    fetch('/api/networth/history?months=1')
      .then((r) => r.json())
      .then((data) => {
        const hist = (data.history || []) as Array<{ date: string; netWorthPaisa: number }>;
        setSparkline(hist.map((h) => ({ date: h.date, value: h.netWorthPaisa / 100 })));
        const today = new Date().toISOString().slice(0, 10);
        setHasTodaySnapshot(hist.some((h) => h.date === today));
      })
      .catch(() => {});
  }, []);

  const captureSnapshot = async () => {
    setIsCapturing(true);
    try {
      const r = await fetch('/api/networth/snapshot', { method: 'POST' });
      if (!r.ok) throw new Error('Failed');
      toast.success('Snapshot captured');
      setHasTodaySnapshot(true);
      // refresh sparkline
      const h = await fetch('/api/networth/history?months=1').then((r) => r.json());
      const hist = (h.history || []) as Array<{ date: string; netWorthPaisa: number }>;
      setSparkline(hist.map((x) => ({ date: x.date, value: x.netWorthPaisa / 100 })));
    } catch (e) {
      console.error(e);
      toast.error('Failed to capture snapshot');
    } finally {
      setIsCapturing(false);
    }
  };

  const stocksValuePaisa = holdings.reduce((s, h) => s + h.currentValue, 0);
  const stocksInvestedPaisa = holdings.reduce((s, h) => s + h.totalInvestment, 0);
  const stocksGainPaisa = stocksValuePaisa - stocksInvestedPaisa;
  const stocksGainPercent =
    stocksInvestedPaisa > 0 ? (stocksGainPaisa / stocksInvestedPaisa) * 100 : 0;

  const mfValuePaisa = funds.reduce((s, f) => s + f.currentValue, 0);
  const mfInvestedPaisa = funds.reduce((s, f) => s + f.totalInvestment, 0);
  const mfGainPaisa = mfValuePaisa - mfInvestedPaisa;
  const mfGainPercent =
    mfInvestedPaisa > 0 ? (mfGainPaisa / mfInvestedPaisa) * 100 : 0;

  const goldValuePaisa = gold.reduce((s, g) => s + (g.currentValue ?? 0), 0);
  const goldInvestedPaisa = gold.reduce((s, g) => s + (g.totalInvestment ?? 0), 0);
  const goldGainPaisa = goldValuePaisa - goldInvestedPaisa;
  const goldGainPercent =
    goldInvestedPaisa > 0 ? (goldGainPaisa / goldInvestedPaisa) * 100 : 0;

  // Phase 4+5 asset classes
  const npsValuePaisa = nps.reduce((s, a) => s + a.totalValue, 0);
  const pfValuePaisa = pf.reduce((s, a) => s + a.totalBalance, 0);
  const reValuePaisa = properties.reduce((s, p) => s + p.currentValuation, 0);
  const insCashPaisa = policies
    .filter((p) => CASH_VALUE_POLICIES.includes(p.policyType))
    .reduce((s, p) => s + (p.investmentValue ?? 0), 0);
  const liabilitiesPaisa = debts.reduce((s, d) => s + d.currentBalance, 0);
  const chitValuePaisa = chits.reduce((s, c) => s + (c.netContribution ?? 0), 0);
  // Fixed Deposits — current value = principal for ACTIVE (conservative, no
  // accrued interest at this stage; matches the chit netContribution convention
  // of "what's currently locked in"). Maturity value lives in /projections.
  const fdValuePaisa = fds
    .filter((f) => f.status === 'ACTIVE')
    .reduce((s, f) => s + (f.principalPaisa ?? 0), 0);
  // Sprint 5.10d — aggregate live INR value across the user's ACTIVE
  // forex deposits. Rows where the live rate didn't resolve carry
  // inrValuePaisa=null and are excluded from the tile to avoid silent
  // zeroing — the detail page surfaces "rate unavailable" explicitly.
  const forexValuePaisa = forex
    .filter((f) => f.status === 'ACTIVE')
    .reduce((s, f) => s + (f.inrValuePaisa ?? 0), 0);

  // Net worth = stocks + MF + gold + NPS + PF + real estate + insurance cash + chit funds + FDs + forex − liabilities
  const totalAssetsPaisa =
    stocksValuePaisa + mfValuePaisa + goldValuePaisa + npsValuePaisa + pfValuePaisa + reValuePaisa + insCashPaisa + chitValuePaisa + fdValuePaisa + forexValuePaisa;
  const netWorthPaisa = totalAssetsPaisa - liabilitiesPaisa;
  const netWorthInvestedPaisa = stocksInvestedPaisa + mfInvestedPaisa + goldInvestedPaisa;
  const netWorthGainPaisa = stocksValuePaisa + mfValuePaisa + goldValuePaisa - netWorthInvestedPaisa;
  const netWorthGainPercent =
    netWorthInvestedPaisa > 0 ? (netWorthGainPaisa / netWorthInvestedPaisa) * 100 : 0;

  // StatsDisplay needs values in display units (rupees), not paisa
  const stocksValue = stocksValuePaisa / 100;
  const mfValue = mfValuePaisa / 100;
  const goldValue = goldValuePaisa / 100;
  const npsValue = npsValuePaisa / 100;
  const pfValue = pfValuePaisa / 100;
  const reValue = reValuePaisa / 100;
  const insValue = insCashPaisa / 100;
  const liabValue = liabilitiesPaisa / 100;
  const chitValue = chitValuePaisa / 100;
  const fdValue = fdValuePaisa / 100;
  const forexValue = forexValuePaisa / 100;

  // Allocation split — by current value across all asset classes
  const totalForAllocation = totalAssetsPaisa;
  const stocksPct = totalForAllocation > 0 ? (stocksValuePaisa / totalForAllocation) * 100 : 0;
  const mfPct = totalForAllocation > 0 ? (mfValuePaisa / totalForAllocation) * 100 : 0;
  const goldPct = totalForAllocation > 0 ? (goldValuePaisa / totalForAllocation) * 100 : 0;
  const npsPct = totalForAllocation > 0 ? (npsValuePaisa / totalForAllocation) * 100 : 0;
  const pfPct = totalForAllocation > 0 ? (pfValuePaisa / totalForAllocation) * 100 : 0;
  const rePct = totalForAllocation > 0 ? (reValuePaisa / totalForAllocation) * 100 : 0;
  const insPct = totalForAllocation > 0 ? (insCashPaisa / totalForAllocation) * 100 : 0;
  const chitPct = totalForAllocation > 0 ? (chitValuePaisa / totalForAllocation) * 100 : 0;
  const fdPct = totalForAllocation > 0 ? (fdValuePaisa / totalForAllocation) * 100 : 0;

  // Top movers: top gainers + top losers by gainLossPercent
  const sorted = [...holdings].sort(
    (a, b) => b.gainLossPercent - a.gainLossPercent
  );
  const topGainers = sorted.slice(0, 3);
  const topLosers = sorted.slice(-3).reverse().filter((h) => h.gainLoss < 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">Net Worth</h1>
          <p className="text-[var(--dxp-text-secondary)]">
            Your complete personal finance snapshot
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasTodaySnapshot && (
            <span className="flex items-center gap-1 text-xs text-emerald-700">
              <Check className="h-4 w-4" /> Last snapshot: today
            </span>
          )}
          <Button variant="secondary" onClick={captureSnapshot} disabled={isCapturing}>
            {isCapturing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
            {hasTodaySnapshot ? 'Recapture snapshot' : "Capture today's snapshot"}
          </Button>
          <Link href="/investments/stocks/new">
            <Button variant="primary">
              <Plus className="mr-2 h-4 w-4" />
              Add stock
            </Button>
          </Link>
        </div>
      </div>

      {sparkline.length > 1 && (
        <Card>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-muted)]">
                  30-day net worth trend
                </p>
                <p className="text-xs text-[var(--dxp-text-secondary)]">{sparkline.length} snapshots</p>
              </div>
              <div className="h-12 w-64">
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <ReLineChart data={sparkline}>
                    <Line type="monotone" dataKey="value" stroke="#2563eb" dot={false} strokeWidth={2} />
                  </ReLineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Hero: total net worth + Sprint 5.9d transparency subtitle */}
      <Card className="border-l-4 border-l-[var(--dxp-brand)] bg-[var(--dxp-brand-light)]">
        <CardContent>
          <p className="text-xs font-bold uppercase tracking-widest text-[var(--dxp-brand-dark)] mb-1">
            Total Net Worth
          </p>
          {isLoading ? (
            <div className="flex items-center gap-2 text-3xl text-[var(--dxp-brand-dark)]">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <>
              <p className="text-4xl font-bold font-mono text-[var(--dxp-brand-dark)]">
                {formatINR(netWorthPaisa)}
              </p>
              {/* Sprint 5.9d — assets − liabilities subtitle. Always shown
                  even when liabilities are zero; clarifies the math. */}
              <button
                type="button"
                onClick={() => setBreakdownOpen((v) => !v)}
                className="mt-1 flex items-center gap-1 text-sm font-medium text-[var(--dxp-brand-dark)] hover:underline"
              >
                <span>
                  {formatINR(totalAssetsPaisa)} assets
                  {liabilitiesPaisa > 0 && (
                    <> · {formatINR(liabilitiesPaisa)} liabilities</>
                  )}
                </span>
                {breakdownOpen ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </button>
              <p
                className={`mt-1 text-sm font-medium flex items-center gap-1 ${
                  netWorthGainPaisa >= 0 ? 'text-emerald-700' : 'text-rose-700'
                }`}
              >
                {netWorthGainPaisa >= 0 ? (
                  <TrendingUp className="h-4 w-4" />
                ) : (
                  <TrendingDown className="h-4 w-4" />
                )}
                {formatINR(netWorthGainPaisa)} ({formatPercent(netWorthGainPercent)}) unrealised
              </p>
              {/* Sprint 5.9d — expanded breakdown: top 3-5 assets + all
                  liabilities. */}
              {breakdownOpen && (
                <div className="mt-3 grid grid-cols-1 gap-3 rounded border border-[var(--dxp-brand-dark)]/20 bg-white/60 p-3 text-xs sm:grid-cols-2">
                  <div>
                    <p className="mb-1 font-bold uppercase tracking-wider text-[var(--dxp-brand-dark)]">
                      Top assets
                    </p>
                    <ul className="space-y-0.5 text-[var(--dxp-text)]">
                      {([
                        ['Real Estate', reValuePaisa],
                        ['Mutual Funds', mfValuePaisa],
                        ['Stocks', stocksValuePaisa],
                        ['PF / EPF', pfValuePaisa],
                        ['NPS', npsValuePaisa],
                        ['Gold', goldValuePaisa],
                        ['Insurance cash value', insCashPaisa],
                        ['Chit funds', chitValuePaisa],
                        ['Fixed Deposits', fdValuePaisa],
                        ['Forex deposits', forexValuePaisa],
                      ] as Array<[string, number]>)
                        .filter(([, v]) => v > 0)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 5)
                        .map(([label, value]) => (
                          <li key={label} className="flex justify-between gap-2">
                            <span className="text-[var(--dxp-text-secondary)]">{label}</span>
                            <span className="font-mono">{formatINR(value)}</span>
                          </li>
                        ))}
                    </ul>
                  </div>
                  <div>
                    <p className="mb-1 font-bold uppercase tracking-wider text-[var(--dxp-brand-dark)]">
                      Liabilities ({debts.length})
                    </p>
                    {debts.length === 0 ? (
                      <p className="text-[var(--dxp-text-muted)]">No outstanding debts.</p>
                    ) : (
                      <ul className="space-y-0.5 text-[var(--dxp-text)]">
                        {debts.map((d) => (
                          <li key={d.id} className="flex justify-between gap-2">
                            <span className="text-[var(--dxp-text-secondary)]">
                              {d.name || `Loan #${d.id}`}
                            </span>
                            <span className="font-mono text-rose-700">
                              {formatINR(d.currentBalance)}
                            </span>
                          </li>
                        ))}
                        <li className="mt-1 flex justify-between border-t border-[var(--dxp-border)]/40 pt-1 font-semibold">
                          <span>Total</span>
                          <span className="font-mono text-rose-700">
                            {formatINR(liabilitiesPaisa)}
                          </span>
                        </li>
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Asset breakdown stats */}
      <StatsDisplay
        currency="INR"
        locale="en-IN"
        columns={4}
        stats={[
          {
            label: 'Stocks',
            value: stocksValue,
            format: 'currency',
            delta: { value: stocksGainPercent, label: `${holdings.length} holding${holdings.length === 1 ? '' : 's'}` },
          },
          {
            label: 'Mutual Funds',
            value: mfValue,
            format: 'currency',
            delta: { value: mfGainPercent, label: `${funds.length} fund${funds.length === 1 ? '' : 's'}` },
          },
          {
            label: 'Gold',
            value: goldValue,
            format: 'currency',
            delta: { value: goldGainPercent, label: `${gold.length} holding${gold.length === 1 ? '' : 's'}` },
          },
          { label: 'NPS', value: npsValue, format: 'currency' },
          { label: 'Provident Fund', value: pfValue, format: 'currency' },
          { label: 'Real Estate', value: reValue, format: 'currency' },
          { label: 'Insurance (cash)', value: insValue, format: 'currency' },
          { label: 'Chit Funds', value: chitValue, format: 'currency' },
          { label: 'Fixed Deposits', value: fdValue, format: 'currency' },
          { label: 'Forex Deposits', value: forexValue, format: 'currency' },
          { label: 'Liabilities', value: liabValue, format: 'currency' },
        ]}
      />

      {/* Liabilities — separate negative card */}
      {liabilitiesPaisa > 0 && (
        <Card className="border-l-4 border-l-rose-500">
          <CardContent>
            <p className="text-xs font-bold uppercase tracking-widest text-rose-700 mb-1">Total Liabilities</p>
            <p className="text-3xl font-bold font-mono text-rose-700">−{formatINR(liabilitiesPaisa)}</p>
            <p className="mt-1 text-xs text-rose-600">{debts.length} active debt{debts.length === 1 ? '' : 's'}</p>
          </CardContent>
        </Card>
      )}

      {/* Top movers + allocation */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <h3 className="text-base font-bold text-[var(--dxp-text)]">Top movers</h3>
            <p className="text-xs text-[var(--dxp-text-muted)]">Best and worst performers today</p>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center gap-2 text-[var(--dxp-text-muted)]">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading...
              </div>
            ) : holdings.length === 0 ? (
              <p className="text-sm text-[var(--dxp-text-secondary)]">
                No holdings yet.{' '}
                <Link
                  href="/investments/stocks/new"
                  className="text-[var(--dxp-brand)] underline hover:no-underline"
                >
                  Add your first stock
                </Link>
                .
              </p>
            ) : (
              <div className="space-y-3">
                {topGainers.length > 0 && (
                  <div>
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--dxp-text-muted)]">
                      Gainers
                    </p>
                    {topGainers.map((h) => (
                      <div
                        key={h.id}
                        className="flex items-center justify-between py-1 text-sm"
                      >
                        <span className="font-mono font-bold text-[var(--dxp-text)]">{h.symbol}</span>
                        <Badge variant="success">{formatPercent(h.gainLossPercent)}</Badge>
                      </div>
                    ))}
                  </div>
                )}
                {topLosers.length > 0 && (
                  <div>
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--dxp-text-muted)]">
                      Losers
                    </p>
                    {topLosers.map((h) => (
                      <div
                        key={h.id}
                        className="flex items-center justify-between py-1 text-sm"
                      >
                        <span className="font-mono font-bold text-[var(--dxp-text)]">{h.symbol}</span>
                        <Badge variant="danger">{formatPercent(h.gainLossPercent)}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h3 className="text-base font-bold text-[var(--dxp-text)]">Asset allocation</h3>
            <p className="text-xs text-[var(--dxp-text-muted)]">How your net worth is distributed</p>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {totalForAllocation === 0 ? (
                <p className="text-xs text-[var(--dxp-text-muted)]">
                  No holdings yet. Add an asset to see allocation.
                </p>
              ) : (
                <>
                  {[
                    { label: 'Stocks', pct: stocksPct, color: 'bg-[var(--dxp-brand)]' },
                    { label: 'Mutual Funds', pct: mfPct, color: 'bg-emerald-500' },
                    { label: 'Gold', pct: goldPct, color: 'bg-amber-500' },
                    { label: 'NPS', pct: npsPct, color: 'bg-purple-500' },
                    { label: 'Provident Fund', pct: pfPct, color: 'bg-sky-500' },
                    { label: 'Real Estate', pct: rePct, color: 'bg-orange-500' },
                    { label: 'Insurance', pct: insPct, color: 'bg-pink-500' },
                    { label: 'Chit Funds', pct: chitPct, color: 'bg-teal-500' },
                    { label: 'Fixed Deposits', pct: fdPct, color: 'bg-slate-500' },
                  ].map((row) => (
                    <div key={row.label}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="font-semibold text-[var(--dxp-text)]">{row.label}</span>
                        <span className="font-mono text-[var(--dxp-text-secondary)]">
                          {row.pct.toFixed(1)}%
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-[var(--dxp-border-light)]">
                        <div className={`h-full ${row.color}`} style={{ width: `${row.pct}%` }} />
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick actions */}
      <Card>
        <CardHeader>
          <h3 className="text-base font-bold text-[var(--dxp-text)]">Quick actions</h3>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-4">
            <Link href="/investments/stocks/new">
              <Button variant="secondary" className="w-full justify-start">
                <Plus className="mr-2 h-4 w-4" /> Add stock
              </Button>
            </Link>
            <Link href="/budget">
              <Button variant="secondary" className="w-full justify-start">
                <Wallet className="mr-2 h-4 w-4" /> Budget
              </Button>
            </Link>
            <Link href="/projections">
              <Button variant="secondary" className="w-full justify-start">
                <Target className="mr-2 h-4 w-4" /> Projections
              </Button>
            </Link>
            <Link href="/gst/invoices">
              <Button variant="secondary" className="w-full justify-start">
                <FileSpreadsheet className="mr-2 h-4 w-4" /> GST invoices
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
