'use client';

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Button, Card, CardHeader, CardContent, Badge, StatsDisplay } from '@dxp/ui';
import {
  TrendingUp,
  TrendingDown,
  Newspaper,
  Calendar,
  Loader2,
  ExternalLink,
  Sun,
  AlertTriangle,
  RefreshCw,
  Camera,
} from 'lucide-react';

interface MarketIndex {
  name: string;
  symbol: string;
  value: number;
  change: number;
  changePercent: number;
}

interface Commodity {
  name: string;
  value: number;
  change: number;
  changePercent: number;
}

interface PortfolioBreakdown {
  symbol: string;
  name: string;
  value: number;
  previousValue: number;
  change: number;
}

interface MfMover {
  name: string;
  returnPercent: number;
  gainLoss: number;
}

interface ActionItem {
  schemeName?: string;
  name?: string;
  insurer?: string;
  policyNumber?: string;
  foremanName?: string;
  creditor?: string;
  amount: number;
  dueDate: string;
  isOverdue?: boolean;
}

interface NewsItem {
  title: string;
  link: string;
  pubDate: string;
}

interface DigestData {
  date: string;
  portfolio: {
    hasSnapshot: boolean;
    netWorth: number;
    previousNetWorth: number;
    netWorthChange: number;
    netWorthChangePercent: number;
    previousDate: string | null;
    breakdown: PortfolioBreakdown[];
  };
  mfMovers: { gainers: MfMover[]; losers: MfMover[] };
  marketPulse: {
    indices: MarketIndex[];
    commodities: Commodity[];
    forex: { usdInr: number; change: number; changePercent: number };
    marketState: string;
  };
  actionItems: {
    sipsDue: ActionItem[];
    chitsDue: ActionItem[];
    insuranceDue: ActionItem[];
    loansDue: ActionItem[];
  };
  news: { markets: NewsItem[]; personalFinance: NewsItem[] };
}

const formatINR = (paisa: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paisa / 100);

const formatNum = (n: number, decimals = 2) =>
  new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  }).format(n);

const formatPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

const relativeTime = (dateStr: string) => {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

export default function DailyDigestPage() {
  const [data, setData] = useState<DigestData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSnapshotting, setIsSnapshotting] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      // Refresh today's snapshot before reading the digest so the Portfolio
      // Snapshot section always reflects current asset values — otherwise a
      // newly added investment (FD, MF, etc.) wouldn't appear until the
      // manual "Take snapshot" button was clicked. Snapshot writes are
      // idempotent: delete-then-insert per asset_symbol for today.
      await fetch('/api/networth/snapshot', { method: 'POST' }).catch(() => {
        /* non-fatal — digest can still render from the last snapshot */
      });
      const r = await fetch('/api/daily-digest').then((r) => r.json());
      if (r.error) throw new Error(r.error);
      setData(r);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load digest');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const takeSnapshot = async () => {
    setIsSnapshotting(true);
    try {
      const r = await fetch('/api/networth/snapshot', { method: 'POST' });
      if (!r.ok) throw new Error('Snapshot failed');
      toast.success('Snapshot taken');
      load();
    } catch {
      toast.error('Failed to take snapshot');
    } finally {
      setIsSnapshotting(false);
    }
  };

  if (isLoading || !data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--dxp-text-muted)]" />
      </div>
    );
  }

  const { portfolio, marketPulse, actionItems, mfMovers, news } = data;
  const totalActions =
    actionItems.sipsDue.length +
    actionItems.chitsDue.length +
    actionItems.insuranceDue.length +
    actionItems.loansDue.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
            <Sun className="h-8 w-8 text-amber-500" />
            Daily Digest
          </h1>
          <p className="text-[var(--dxp-text-secondary)]">
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            {' '}
            <Badge variant={marketPulse.marketState === 'REGULAR' ? 'success' : 'default'}>
              {marketPulse.marketState === 'REGULAR' ? 'Market Open' : 'Market Closed'}
            </Badge>
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={load}>
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh
        </Button>
      </div>

      {/* Section 1: Portfolio Snapshot */}
      <Card>
        <CardHeader>
          <h2 className="text-lg font-bold text-[var(--dxp-text)]">Portfolio Snapshot</h2>
        </CardHeader>
        <CardContent>
          {portfolio.hasSnapshot ? (
            <>
              <StatsDisplay
                currency="INR"
                locale="en-IN"
                columns={3}
                stats={[
                  {
                    label: 'Net Worth',
                    value: portfolio.netWorth / 100,
                    format: 'currency',
                    delta: portfolio.previousNetWorth > 0
                      ? { value: Math.round(portfolio.netWorthChangePercent * 100) / 100, label: portfolio.previousDate ? `vs ${portfolio.previousDate}` : '' }
                      : undefined,
                  },
                  { label: 'Day Change', value: portfolio.netWorthChange / 100, format: 'currency' },
                  { label: 'Assets Tracked', value: portfolio.breakdown.length, format: 'number' },
                ]}
              />
              {portfolio.breakdown.length > 0 && (
                <div className="mt-4 grid gap-2 md:grid-cols-4">
                  {portfolio.breakdown.map((b) => {
                    const positive = b.change >= 0;
                    return (
                      <div
                        key={b.symbol}
                        className="flex items-center justify-between rounded-lg border border-[var(--dxp-border-light)] p-3"
                      >
                        <div>
                          <p className="text-xs text-[var(--dxp-text-muted)]">{b.name}</p>
                          <p className="font-mono font-semibold text-[var(--dxp-text)]">
                            {formatINR(b.value)}
                          </p>
                        </div>
                        {b.change !== 0 && (
                          <span className={`text-xs font-mono ${positive ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {positive ? '+' : ''}{formatINR(b.change)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <Camera className="h-10 w-10 text-[var(--dxp-text-muted)]" />
              <p className="text-[var(--dxp-text-muted)]">No snapshot for today yet.</p>
              <Button variant="primary" size="sm" onClick={takeSnapshot} disabled={isSnapshotting}>
                {isSnapshotting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Take Snapshot
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* MF Movers */}
      {(mfMovers.gainers.length > 0 || mfMovers.losers.length > 0) && (
        <div className="grid gap-4 md:grid-cols-2">
          {mfMovers.gainers.length > 0 && (
            <Card>
              <CardHeader>
                <h3 className="flex items-center gap-2 text-base font-bold text-emerald-700">
                  <TrendingUp className="h-4 w-4" /> Top Gainers
                </h3>
              </CardHeader>
              <CardContent>
                {mfMovers.gainers.map((m, i) => (
                  <div key={i} className="flex items-center justify-between border-b border-[var(--dxp-border-light)] py-2 last:border-0">
                    <p className="text-sm text-[var(--dxp-text)] max-w-[70%] truncate">{m.name}</p>
                    <span className="font-mono text-sm text-emerald-600">+{m.returnPercent.toFixed(1)}%</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          {mfMovers.losers.length > 0 && (
            <Card>
              <CardHeader>
                <h3 className="flex items-center gap-2 text-base font-bold text-rose-700">
                  <TrendingDown className="h-4 w-4" /> Underperformers
                </h3>
              </CardHeader>
              <CardContent>
                {mfMovers.losers.map((m, i) => (
                  <div key={i} className="flex items-center justify-between border-b border-[var(--dxp-border-light)] py-2 last:border-0">
                    <p className="text-sm text-[var(--dxp-text)] max-w-[70%] truncate">{m.name}</p>
                    <span className="font-mono text-sm text-rose-600">{m.returnPercent.toFixed(1)}%</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Section 2: Market Pulse */}
      <Card>
        <CardHeader>
          <h2 className="text-lg font-bold text-[var(--dxp-text)]">Market Pulse</h2>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-4">
            {marketPulse.indices.map((idx) => {
              const positive = idx.change >= 0;
              return (
                <div
                  key={idx.symbol}
                  className="rounded-lg border border-[var(--dxp-border-light)] p-3"
                >
                  <p className="text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                    {idx.name}
                  </p>
                  <p className="mt-1 text-xl font-bold font-mono text-[var(--dxp-text)]">
                    {formatNum(idx.value, idx.symbol === '^INDIAVIX' ? 2 : 0)}
                  </p>
                  <p className={`text-sm font-mono ${positive ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {positive ? '+' : ''}{formatNum(idx.change, 0)} ({formatPct(idx.changePercent)})
                  </p>
                </div>
              );
            })}
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {marketPulse.commodities.map((c) => {
              const positive = c.change >= 0;
              return (
                <div
                  key={c.name}
                  className="rounded-lg border border-[var(--dxp-border-light)] p-3"
                >
                  <p className="text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                    {c.name}
                  </p>
                  <p className="mt-1 text-xl font-bold font-mono text-[var(--dxp-text)]">
                    {new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(c.value)}
                  </p>
                  <p className={`text-sm font-mono ${positive ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {formatPct(c.changePercent)}
                  </p>
                </div>
              );
            })}
            <div className="rounded-lg border border-[var(--dxp-border-light)] p-3">
              <p className="text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">
                USD/INR
              </p>
              <p className="mt-1 text-xl font-bold font-mono text-[var(--dxp-text)]">
                {formatNum(marketPulse.forex.usdInr, 2)}
              </p>
              <p className={`text-sm font-mono ${marketPulse.forex.change >= 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                {formatPct(marketPulse.forex.changePercent)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Section 3: Action Items */}
      <Card>
        <CardHeader>
          <h2 className="flex items-center gap-2 text-lg font-bold text-[var(--dxp-text)]">
            <Calendar className="h-5 w-5 text-[var(--dxp-brand)]" />
            Action Items
            {totalActions > 0 && (
              <Badge variant="warning">{totalActions}</Badge>
            )}
          </h2>
        </CardHeader>
        <CardContent>
          {totalActions === 0 ? (
            <p className="py-4 text-center text-[var(--dxp-text-muted)]">You're all caught up!</p>
          ) : (
            <div className="space-y-4">
              {actionItems.sipsDue.length > 0 && (
                <ActionSection title="SIPs Due" items={actionItems.sipsDue} labelKey="schemeName" />
              )}
              {actionItems.chitsDue.length > 0 && (
                <ActionSection title="Chit Installments Due" items={actionItems.chitsDue} labelKey="schemeName" />
              )}
              {actionItems.insuranceDue.length > 0 && (
                <ActionSection title="Insurance Premiums Due" items={actionItems.insuranceDue} labelKey="insurer" />
              )}
              {actionItems.loansDue.length > 0 && (
                <ActionSection title="Loan EMIs Due" items={actionItems.loansDue} labelKey="name" />
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section 4: News */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
              <Newspaper className="h-5 w-5 text-[var(--dxp-brand)]" />
              Market Headlines
            </h2>
          </CardHeader>
          <CardContent>
            {news.markets.length > 0 ? (
              <div className="space-y-2">
                {news.markets.map((n, i) => (
                  <a
                    key={i}
                    href={n.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-2 rounded-lg p-2 hover:bg-[var(--dxp-surface-alt,var(--dxp-surface))] transition-colors"
                  >
                    <ExternalLink className="mt-0.5 h-3 w-3 flex-shrink-0 text-[var(--dxp-text-muted)]" />
                    <div>
                      <p className="text-sm text-[var(--dxp-text)] leading-snug">{n.title}</p>
                      <p className="text-xs text-[var(--dxp-text-muted)]">{relativeTime(n.pubDate)}</p>
                    </div>
                  </a>
                ))}
              </div>
            ) : (
              <p className="py-4 text-center text-sm text-[var(--dxp-text-muted)]">No headlines available</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
              <Newspaper className="h-5 w-5 text-[var(--dxp-brand)]" />
              Personal Finance
            </h2>
          </CardHeader>
          <CardContent>
            {news.personalFinance.length > 0 ? (
              <div className="space-y-2">
                {news.personalFinance.map((n, i) => (
                  <a
                    key={i}
                    href={n.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-2 rounded-lg p-2 hover:bg-[var(--dxp-surface-alt,var(--dxp-surface))] transition-colors"
                  >
                    <ExternalLink className="mt-0.5 h-3 w-3 flex-shrink-0 text-[var(--dxp-text-muted)]" />
                    <div>
                      <p className="text-sm text-[var(--dxp-text)] leading-snug">{n.title}</p>
                      <p className="text-xs text-[var(--dxp-text-muted)]">{relativeTime(n.pubDate)}</p>
                    </div>
                  </a>
                ))}
              </div>
            ) : (
              <p className="py-4 text-center text-sm text-[var(--dxp-text-muted)]">No headlines available</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ActionSection({
  title,
  items,
  labelKey,
}: {
  title: string;
  items: ActionItem[];
  labelKey: keyof ActionItem;
}) {
  const formatINR = (paisa: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(paisa / 100);

  return (
    <div>
      <h4 className="mb-1 text-xs font-bold uppercase tracking-wider text-[var(--dxp-text-secondary)]">{title}</h4>
      {items.map((item, i) => (
        <div
          key={i}
          className={`flex items-center justify-between rounded-lg px-3 py-2 ${
            item.isOverdue ? 'bg-rose-50 border border-rose-200' : 'border-b border-[var(--dxp-border-light)]'
          }`}
        >
          <div className="flex items-center gap-2">
            {item.isOverdue && <AlertTriangle className="h-3 w-3 text-rose-500" />}
            <span className="text-sm text-[var(--dxp-text)]">{String(item[labelKey] ?? '')}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm font-medium text-[var(--dxp-text)]">{formatINR(item.amount)}</span>
            <span className="text-xs text-[var(--dxp-text-muted)]">{item.dueDate}</span>
            {item.isOverdue && <Badge variant="danger">Overdue</Badge>}
          </div>
        </div>
      ))}
    </div>
  );
}
