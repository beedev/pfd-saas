'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { Card, CardHeader, CardContent, Button, Badge, StatsDisplay } from '@dxp/ui';
import {
  LineChart,
  Coins,
  Landmark,
  Home,
  ShieldCheck,
  PiggyBank,
  Umbrella,
  CreditCard,
  Users,
  Banknote,
  ArrowRight,
  Loader2,
} from 'lucide-react';

interface Holding {
  id: number;
  symbol: string;
  totalInvestment: number;
  currentValue: number;
  gainLoss: number;
}
interface MutualFund {
  id: number;
  totalInvestment: number;
  currentValue: number;
  gainLoss: number;
}
interface GoldHolding {
  id: number;
  grams: number | null;
  purity: '999' | '995' | '916' | null;
  totalInvestment: number | null;
  currentValue: number | null;
  gainLoss: number | null;
}
interface NPSAccount { id: number; totalValue: number; totalContributed: number }
interface PFAccount { id: number; totalBalance: number }
interface RealEstateProperty { id: number; currentValuation: number; purchasePrice: number; mortgageAmount: number | null; monthlyRent: number | null }
interface InsurancePolicy { id: number; policyType: string; sumAssured: number; investmentValue: number | null }
interface LiabilityRow { id: number; type: string; currentBalance: number; monthlyEmi: number }
interface ChitFund {
  id: number;
  status: 'ACTIVE' | 'WON' | 'COMPLETED' | 'WITHDRAWN';
  totalPaid: number | null;
  totalDividends: number | null;
  netContribution: number | null;
  winAmountReceived: number | null;
  xirr: number | null;
}

const assetClasses = [
  { key: 'stocks', title: 'Stocks', description: 'Equity holdings via Yahoo Finance', icon: LineChart, href: '/investments/stocks', live: true },
  { key: 'mf', title: 'Mutual Funds', description: 'SIPs and lump-sum investments', icon: PiggyBank, href: '/investments/mutual-funds', live: true },
  { key: 'gold', title: 'Gold', description: 'Physical, ETFs, sovereign bonds', icon: Coins, href: '/investments/gold', live: true },
  { key: 'nps', title: 'NPS', description: 'National Pension System', icon: Landmark, href: '/investments/nps', live: true },
  { key: 'pf', title: 'EPF / PPF / VPF', description: 'Provident fund balances', icon: ShieldCheck, href: '/investments/pf', live: true },
  { key: 'real-estate', title: 'Real Estate', description: 'Properties and valuations', icon: Home, href: '/investments/real-estate', live: true },
  { key: 'insurance', title: 'Insurance', description: 'Life, health and other policies', icon: Umbrella, href: '/investments/insurance', live: true },
  { key: 'liabilities', title: 'Liabilities', description: 'Loans and credit cards', icon: CreditCard, href: '/investments/liabilities', live: true },
  { key: 'chit', title: 'Chit Funds', description: 'Chit subscriptions with XIRR', icon: Users, href: '/investments/chit-funds', live: true },
  { key: 'fd', title: 'Fixed Deposits', description: 'Bank FDs with maturity projection', icon: Banknote, href: '/investments/fixed-deposits', live: true },
] as const;

const CASH_VALUE_TYPES = ['WHOLE_LIFE', 'ENDOWMENT', 'ULIP'];

export default function InvestmentsPage() {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [funds, setFunds] = useState<MutualFund[]>([]);
  const [gold, setGold] = useState<GoldHolding[]>([]);
  const [nps, setNps] = useState<NPSAccount[]>([]);
  const [pf, setPf] = useState<PFAccount[]>([]);
  const [props, setProps] = useState<RealEstateProperty[]>([]);
  const [policies, setPolicies] = useState<InsurancePolicy[]>([]);
  const [debts, setDebts] = useState<LiabilityRow[]>([]);
  const [chits, setChits] = useState<ChitFund[]>([]);
  const [fds, setFds] = useState<Array<{ id: number; principalPaisa: number; maturityAmountPaisa: number | null; maturityDate: string; status: 'ACTIVE' | 'MATURED' | 'BROKEN' | null }>>([]);
  const [isLoading, setIsLoading] = useState(true);

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
    ])
      .then(([stocksData, mfData, goldData, npsData, pfData, reData, insData, liaData, chitData, fdData]) => {
        setHoldings(stocksData.holdings || []);
        setFunds(mfData.mutualFunds || []);
        setGold(goldData.gold || []);
        setNps(npsData.accounts || []);
        setPf(pfData.accounts || []);
        setProps(reData.properties || []);
        setPolicies(insData.policies || []);
        setDebts(liaData.liabilities || []);
        setChits(chitData.chitFunds || []);
        setFds(fdData.fixedDeposits || []);
      })
      .catch(() => {
        // ignore — empty arrays
      })
      .finally(() => setIsLoading(false));
  }, []);

  const stocksInvested = holdings.reduce((s, h) => s + h.totalInvestment, 0) / 100;
  const stocksCurrent = holdings.reduce((s, h) => s + h.currentValue, 0) / 100;
  const stocksGain = stocksCurrent - stocksInvested;
  const stocksGainPct = stocksInvested > 0 ? (stocksGain / stocksInvested) * 100 : 0;

  const mfInvested = funds.reduce((s, f) => s + f.totalInvestment, 0) / 100;
  const mfCurrent = funds.reduce((s, f) => s + f.currentValue, 0) / 100;
  const mfGain = mfCurrent - mfInvested;
  const mfGainPct = mfInvested > 0 ? (mfGain / mfInvested) * 100 : 0;

  const goldInvested = gold.reduce((s, g) => s + (g.totalInvestment ?? 0), 0) / 100;
  const goldCurrent = gold.reduce((s, g) => s + (g.currentValue ?? 0), 0) / 100;
  const goldGain = goldCurrent - goldInvested;
  const goldGainPct = goldInvested > 0 ? (goldGain / goldInvested) * 100 : 0;

  const npsValue = nps.reduce((s, a) => s + a.totalValue, 0) / 100;
  const npsContributed = nps.reduce((s, a) => s + a.totalContributed, 0) / 100;

  const pfValue = pf.reduce((s, a) => s + a.totalBalance, 0) / 100;

  const reValue = props.reduce((s, p) => s + p.currentValuation, 0) / 100;
  const reLoan = props.reduce((s, p) => s + (p.mortgageAmount ?? 0), 0) / 100;
  const reEquity = reValue - reLoan;

  const insCash = policies.reduce((s, p) => s + (p.investmentValue ?? 0), 0) / 100;
  const insLifeCover = policies
    .filter((p) => CASH_VALUE_TYPES.includes(p.policyType) || p.policyType === 'TERM_LIFE')
    .reduce((s, p) => s + p.sumAssured, 0) / 100;

  const totalDebt = debts.reduce((s, d) => s + d.currentBalance, 0) / 100;

  // Fixed Deposits
  const fdsActive = fds.filter((f) => f.status === 'ACTIVE');
  const fdPrincipal = fdsActive.reduce((s, f) => s + f.principalPaisa, 0) / 100;
  const fdMaturity = fdsActive.reduce(
    (s, f) => s + (f.maturityAmountPaisa ?? f.principalPaisa),
    0,
  ) / 100;
  const fdInterest = fdMaturity - fdPrincipal;

  // Chit funds
  const chitsActive = chits.filter((c) => c.status === 'ACTIVE').length;
  const chitsDeployed = chits.reduce((s, c) => s + (c.netContribution ?? 0), 0) / 100;
  const chitsDividends = chits.reduce((s, c) => s + (c.totalDividends ?? 0), 0) / 100;
  const chitsXirr = (() => {
    const elig = chits.filter((c) => c.xirr !== null && (c.totalPaid ?? 0) > 0);
    if (!elig.length) return 0;
    const w = elig.reduce((s, c) => s + (c.totalPaid ?? 0), 0);
    if (w === 0) return 0;
    return elig.reduce((s, c) => s + (c.xirr ?? 0) * (c.totalPaid ?? 0), 0) / w;
  })();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">Investments</h1>
        <p className="text-[var(--dxp-text-secondary)]">Overview of all your asset classes</p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-[var(--dxp-text-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading...
        </div>
      ) : (
        <>
          {/* Stocks */}
          <SummaryCard
            title="Stocks"
            icon={<LineChart className="h-5 w-5 text-[var(--dxp-brand)]" />}
            href="/investments/stocks"
            count={`${holdings.length} holding${holdings.length === 1 ? '' : 's'}`}
            stats={[
              { label: 'Invested', value: stocksInvested },
              { label: 'Current Value', value: stocksCurrent },
              { label: 'Unrealised P&L', value: stocksGain, deltaPct: stocksGainPct },
            ]}
          />

          {/* MFs */}
          <SummaryCard
            title="Mutual Funds"
            icon={<PiggyBank className="h-5 w-5 text-[var(--dxp-brand)]" />}
            href="/investments/mutual-funds"
            count={`${funds.length} fund${funds.length === 1 ? '' : 's'}`}
            stats={[
              { label: 'Invested', value: mfInvested },
              { label: 'Current Value', value: mfCurrent },
              { label: 'Unrealised P&L', value: mfGain, deltaPct: mfGainPct },
            ]}
          />

          {/* Gold */}
          <SummaryCard
            title="Gold"
            icon={<Coins className="h-5 w-5 text-amber-600" />}
            href="/investments/gold"
            count={`${gold.length} holding${gold.length === 1 ? '' : 's'}`}
            stats={[
              { label: 'Invested', value: goldInvested },
              { label: 'Current Value', value: goldCurrent },
              { label: 'Unrealised P&L', value: goldGain, deltaPct: goldGainPct },
            ]}
          />

          {/* NPS */}
          <SummaryCard
            title="NPS"
            icon={<Landmark className="h-5 w-5 text-[var(--dxp-brand)]" />}
            href="/investments/nps"
            count={`${nps.length} account${nps.length === 1 ? '' : 's'}`}
            stats={[
              { label: 'Contributed', value: npsContributed },
              { label: 'Current Value', value: npsValue },
              { label: 'Gain', value: npsValue - npsContributed },
            ]}
          />

          {/* PF */}
          <SummaryCard
            title="Provident Fund"
            icon={<ShieldCheck className="h-5 w-5 text-[var(--dxp-brand)]" />}
            href="/investments/pf"
            count={`${pf.length} account${pf.length === 1 ? '' : 's'}`}
            stats={[{ label: 'Total balance', value: pfValue }]}
          />

          {/* Real Estate */}
          <SummaryCard
            title="Real Estate"
            icon={<Home className="h-5 w-5 text-[var(--dxp-brand)]" />}
            href="/investments/real-estate"
            count={`${props.length} propert${props.length === 1 ? 'y' : 'ies'}`}
            stats={[
              { label: 'Notional value', value: reValue },
              { label: 'Loan outstanding', value: reLoan },
              { label: 'Net equity', value: reEquity },
            ]}
          />

          {/* Insurance */}
          <SummaryCard
            title="Insurance"
            icon={<Umbrella className="h-5 w-5 text-[var(--dxp-brand)]" />}
            href="/investments/insurance"
            count={`${policies.length} polic${policies.length === 1 ? 'y' : 'ies'}`}
            stats={[
              { label: 'Life cover', value: insLifeCover },
              { label: 'Surrender value', value: insCash },
            ]}
          />

          {/* Chit Funds */}
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-[var(--dxp-brand)]" />
                  <div>
                    <h3 className="text-base font-bold text-[var(--dxp-text)]">Chit Funds</h3>
                    <p className="text-xs text-[var(--dxp-text-muted)]">
                      {chits.length} chit{chits.length === 1 ? '' : 's'}
                    </p>
                  </div>
                </div>
                <Link href="/investments/chit-funds">
                  <Button variant="secondary" size="sm">
                    View all <ArrowRight className="ml-1 h-3 w-3" />
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              <StatsDisplay
                currency="INR"
                locale="en-IN"
                columns={4}
                stats={[
                  { label: 'Active', value: chitsActive, format: 'number' },
                  { label: 'Net contribution', value: chitsDeployed, format: 'currency' },
                  { label: 'Dividends', value: chitsDividends, format: 'currency' },
                  { label: 'XIRR', value: chitsXirr, format: 'percent' },
                ]}
              />
            </CardContent>
          </Card>

          {/* Fixed Deposits */}
          <SummaryCard
            title="Fixed Deposits"
            icon={<Banknote className="h-5 w-5 text-[var(--dxp-brand)]" />}
            href="/investments/fixed-deposits"
            count={`${fdsActive.length} active`}
            stats={[
              { label: 'Principal', value: fdPrincipal },
              { label: 'At maturity', value: fdMaturity },
              { label: 'Interest earning', value: fdInterest },
            ]}
          />

          {/* Liabilities */}
          <SummaryCard
            title="Liabilities"
            icon={<CreditCard className="h-5 w-5 text-rose-600" />}
            href="/investments/liabilities"
            count={`${debts.length} item${debts.length === 1 ? '' : 's'}`}
            stats={[{ label: 'Total debt', value: totalDebt }]}
            negative
          />
        </>
      )}

      <div>
        <h2 className="mb-4 text-lg font-bold text-[var(--dxp-text)]">Asset classes</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {assetClasses.map((asset) => (
            <Link key={asset.key} href={asset.href}>
              <Card className="h-full cursor-pointer transition-shadow hover:shadow-md">
                <CardContent>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="rounded-lg bg-[var(--dxp-border-light)] p-2">
                      <asset.icon className="h-5 w-5 text-[var(--dxp-brand)]" />
                    </div>
                    <div className="flex-1">
                      <p className="text-base font-bold text-[var(--dxp-text)]">{asset.title}</p>
                    </div>
                    <Badge variant="success">live</Badge>
                  </div>
                  <p className="text-sm text-[var(--dxp-text-secondary)]">{asset.description}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  title,
  icon,
  href,
  count,
  stats,
  negative,
}: {
  title: string;
  icon: React.ReactNode;
  href: string;
  count: string;
  stats: Array<{ label: string; value: number; deltaPct?: number }>;
  negative?: boolean;
}) {
  return (
    <Card className={negative ? 'border-l-4 border-l-rose-500' : ''}>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            {icon}
            <div>
              <h3 className="text-base font-bold text-[var(--dxp-text)]">{title}</h3>
              <p className="text-xs text-[var(--dxp-text-muted)]">{count}</p>
            </div>
          </div>
          <Link href={href}>
            <Button variant="secondary" size="sm">
              View all <ArrowRight className="ml-1 h-3 w-3" />
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        <StatsDisplay
          currency="INR"
          locale="en-IN"
          columns={(stats.length >= 4 ? 4 : stats.length >= 3 ? 3 : 2) as 2 | 3 | 4}
          stats={stats.map((s) => ({
            label: s.label,
            value: s.value,
            format: 'currency' as const,
            ...(s.deltaPct !== undefined ? { delta: { value: s.deltaPct, label: 'total return' } } : {}),
          }))}
        />
      </CardContent>
    </Card>
  );
}
