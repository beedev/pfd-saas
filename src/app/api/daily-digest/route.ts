import { NextResponse } from 'next/server';
import { desc, eq, lt, lte, gte, and, asc, sql } from 'drizzle-orm';
import {
  db,
  priceSnapshots,
  sips,
  mutualFunds,
  chitFunds,
  liabilities,
  insurancePolicies,
  budgetCategories,
  budgetEntries,
  creditCardExpenses,
  investmentTransactions,
  chitFundInstallments,
} from '@/db';
import { getQuotes } from '@/lib/services/yahoo-finance';

type BudgetStatus = 'paid' | 'unpaid' | 'partial';

function currentPeriod(): string {
  const now = new Date();
  return `${String(now.getMonth() + 1).padStart(2, '0')}${now.getFullYear()}`;
}

function periodToDateRange(period: string): [string, string] {
  const month = parseInt(period.substring(0, 2), 10);
  const year = parseInt(period.substring(2, 6), 10);
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const to = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
  return [from, to];
}

function deriveStatus(actual: number, planned: number): BudgetStatus | null {
  if (planned <= 0 && actual <= 0) return null;
  if (planned > 0 && actual === 0) return 'unpaid';
  if (actual >= planned) return 'paid';
  return 'partial';
}

interface BudgetSummaryRow {
  name: string;
  planned: number;
  actual: number;
  remaining: number;
  status: BudgetStatus;
}

async function buildBudgetSummary(period: string) {
  const [from, to] = periodToDateRange(period);

  const cats = await db
    .select()
    .from(budgetCategories)
    .where(and(eq(budgetCategories.isActive, true), eq(budgetCategories.type, 'EXPENSE')));

  const entries = await db
    .select()
    .from(budgetEntries)
    .where(eq(budgetEntries.period, period));

  const ccRows = await db
    .select({
      name: liabilities.name,
      amount: creditCardExpenses.amount,
      paidAmount: creditCardExpenses.paidAmount,
    })
    .from(creditCardExpenses)
    .innerJoin(liabilities, eq(liabilities.id, creditCardExpenses.liabilityId))
    .where(and(eq(liabilities.type, 'CREDIT_CARD'), eq(creditCardExpenses.period, period)));

  const ccByName: Record<string, { stmt: number; paid: number }> = {};
  for (const r of ccRows) {
    const acc = ccByName[r.name] ?? { stmt: 0, paid: 0 };
    acc.stmt += r.amount;
    acc.paid += r.paidAmount ?? 0;
    ccByName[r.name] = acc;
  }

  const sipActualRow = await db
    .select({ total: sql<number>`COALESCE(SUM(${investmentTransactions.amount}), 0)` })
    .from(investmentTransactions)
    .where(
      and(
        eq(investmentTransactions.type, 'SIP_EXECUTION'),
        gte(investmentTransactions.transactionDate, from),
        lt(investmentTransactions.transactionDate, to),
      ),
    );
  const sipActual = Number(sipActualRow[0]?.total ?? 0);

  const chitActualRow = await db
    .select({ total: sql<number>`COALESCE(SUM(${chitFundInstallments.installmentPaid}), 0)` })
    .from(chitFundInstallments)
    .where(and(gte(chitFundInstallments.paidOn, from), lt(chitFundInstallments.paidOn, to)));
  const chitActual = Number(chitActualRow[0]?.total ?? 0);

  const rows: BudgetSummaryRow[] = [];
  for (const cat of cats) {
    const e = entries.find((x) => x.categoryId === cat.id);
    const planned = e?.plannedAmount ?? 0;
    let actual = e?.actualAmount ?? 0;

    if (ccByName[cat.name]) {
      actual = ccByName[cat.name].paid;
    } else if (cat.name === 'SIP') {
      actual = sipActual;
    } else if (cat.name === 'Chit') {
      actual = chitActual;
    }

    const status = deriveStatus(actual, planned);
    if (!status) continue;

    rows.push({
      name: cat.name,
      planned,
      actual,
      remaining: Math.max(0, planned - actual),
      status,
    });
  }

  const totalPlanned = rows.reduce((s, r) => s + r.planned, 0);
  const totalActual = rows.reduce((s, r) => s + r.actual, 0);
  const pending = rows.filter((r) => r.status !== 'paid').sort((a, b) => b.remaining - a.remaining);
  const paidCount = rows.filter((r) => r.status === 'paid').length;
  const partialCount = rows.filter((r) => r.status === 'partial').length;
  const unpaidCount = rows.filter((r) => r.status === 'unpaid').length;

  return {
    period,
    totalPlanned,
    totalActual,
    paidCount,
    partialCount,
    unpaidCount,
    pending: pending.map((r) => ({
      name: r.name,
      planned: r.planned,
      actual: r.actual,
      remaining: r.remaining,
      status: r.status,
    })),
  };
}

const MARKET_SYMBOLS = ['^NSEI', '^BSESN', '^NSEBANK', '^INDIAVIX', 'GC=F', 'SI=F', 'USDINR=X'];

const ET_MARKETS_RSS = 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms';
const ET_PF_RSS = 'https://economictimes.indiatimes.com/wealth/personal-finance-news/rssfeeds/17999498.cms';

async function fetchRssHeadlines(
  url: string,
  limit: number,
): Promise<Array<{ title: string; link: string; pubDate: string }>> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    const xml = await res.text();
    const items: Array<{ title: string; link: string; pubDate: string }> = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null && items.length < limit) {
      const block = match[1];
      const title =
        block.match(/<title><!\[CDATA\[(.*?)\]\]>/)?.[1] ??
        block.match(/<title>(.*?)<\/title>/)?.[1] ??
        '';
      const link =
        block.match(/<link><!\[CDATA\[(.*?)\]\]>/)?.[1] ??
        block.match(/<link>(.*?)<\/link>/)?.[1] ??
        '';
      const pubDate = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] ?? '';
      if (title.trim()) {
        items.push({ title: title.trim(), link: link.trim(), pubDate: pubDate.trim() });
      }
    }
    return items;
  } catch {
    return [];
  }
}

export async function GET() {
  const today = new Date().toISOString().substring(0, 10);
  const weekFromNow = new Date(Date.now() + 7 * 86400000).toISOString().substring(0, 10);
  const monthFromNow = new Date(Date.now() + 30 * 86400000).toISOString().substring(0, 10);

  try {
    // Run all 5 tasks in parallel
    const [quotes, todaySnapshots, prevDateRows, mfRows, sipsDue, chitsDue, insuranceDue, loansDue, newsMarkets, newsPF] =
      await Promise.all([
        // Task 1: Market indices
        getQuotes(MARKET_SYMBOLS),

        // Task 2a: Today's portfolio snapshots
        db
          .select()
          .from(priceSnapshots)
          .where(
            and(
              eq(priceSnapshots.priceDate, today),
              eq(priceSnapshots.source, 'NETWORTH_SNAPSHOT'),
            ),
          ),

        // Task 2b: Previous snapshot date
        db
          .select({ priceDate: priceSnapshots.priceDate })
          .from(priceSnapshots)
          .where(
            and(
              lt(priceSnapshots.priceDate, today),
              eq(priceSnapshots.source, 'NETWORTH_SNAPSHOT'),
            ),
          )
          .orderBy(desc(priceSnapshots.priceDate))
          .limit(1),

        // Task 3: MF top movers
        db.select().from(mutualFunds).orderBy(desc(mutualFunds.gainLossPercent)),

        // Task 4a: SIPs due this week
        db
          .select({ id: sips.id, schemeName: mutualFunds.schemeName, monthlyAmount: sips.monthlyAmount, nextExecutionDate: sips.nextExecutionDate, frequency: sips.frequency })
          .from(sips)
          .leftJoin(mutualFunds, eq(sips.mutualFundId, mutualFunds.id))
          .where(
            and(
              eq(sips.status, 'ACTIVE'),
              lte(sips.nextExecutionDate, weekFromNow),
            ),
          ),

        // Task 4b: Chit dues this month
        db
          .select()
          .from(chitFunds)
          .where(
            and(
              eq(chitFunds.status, 'ACTIVE'),
              lte(chitFunds.nextDueDate, monthFromNow),
            ),
          ),

        // Task 4c: Insurance premiums due next 30 days
        db
          .select()
          .from(insurancePolicies)
          .where(
            and(
              eq(insurancePolicies.status, 'ACTIVE'),
              lte(insurancePolicies.nextPremiumDueDate, monthFromNow),
              gte(insurancePolicies.nextPremiumDueDate, today),
            ),
          ),

        // Task 4d: Loan EMIs due this week
        db
          .select()
          .from(liabilities)
          .where(
            and(
              eq(liabilities.status, 'ACTIVE'),
              lte(liabilities.nextPaymentDate, weekFromNow),
            ),
          ),

        // Task 5: News
        fetchRssHeadlines(ET_MARKETS_RSS, 5),
        fetchRssHeadlines(ET_PF_RSS, 3),
      ]);

    // --- Build Market Pulse ---
    let quoteMap = new Map(quotes.map((q) => [q.symbol, q]));

    // Critical symbols — retry individually if missing from initial batch
    const critical = ['USDINR=X', 'GC=F', 'SI=F'];
    const missing = critical.filter((s) => !quoteMap.has(s));
    if (missing.length > 0) {
      const retryQuotes = await getQuotes(missing);
      for (const q of retryQuotes) quoteMap.set(q.symbol, q);
    }

    const usdInr = quoteMap.get('USDINR=X');
    const goldUsd = quoteMap.get('GC=F');
    const silverUsd = quoteMap.get('SI=F');
    // Fallback chain: live price → previousClose → last known ~93
    const usdInrRate = (usdInr?.regularMarketPrice && usdInr.regularMarketPrice > 0)
      ? usdInr.regularMarketPrice
      : (usdInr?.previousClose && usdInr.previousClose > 0)
        ? usdInr.previousClose
        : 93;

    const buildIndex = (symbol: string, name: string) => {
      const q = quoteMap.get(symbol);
      return q
        ? { name, symbol, value: q.regularMarketPrice, change: q.regularMarketChange, changePercent: q.regularMarketChangePercent, marketState: q.marketState }
        : { name, symbol, value: 0, change: 0, changePercent: 0, marketState: 'CLOSED' };
    };

    const marketPulse = {
      indices: [
        buildIndex('^NSEI', 'Nifty 50'),
        buildIndex('^BSESN', 'Sensex'),
        buildIndex('^NSEBANK', 'Bank Nifty'),
        buildIndex('^INDIAVIX', 'India VIX'),
      ],
      commodities: [
        {
          // India domestic gold = COMEX spot × USDINR × 1.07 (import duty + premium)
          name: 'Gold 24KT (per gram)',
          value: goldUsd ? Math.round((goldUsd.regularMarketPrice / 31.1035) * usdInrRate * 1.07) : 0,
          change: goldUsd ? Math.round((goldUsd.regularMarketChange / 31.1035) * usdInrRate * 1.07) : 0,
          changePercent: goldUsd?.regularMarketChangePercent ?? 0,
        },
        {
          name: 'Silver (per kg)',
          value: silverUsd ? Math.round((silverUsd.regularMarketPrice / 31.1035) * 1000 * usdInrRate * 1.07) : 0,
          change: silverUsd ? Math.round((silverUsd.regularMarketChange / 31.1035) * 1000 * usdInrRate * 1.07) : 0,
          changePercent: silverUsd?.regularMarketChangePercent ?? 0,
        },
      ],
      forex: {
        usdInr: usdInrRate,
        change: usdInr?.regularMarketChange ?? 0,
        changePercent: usdInr?.regularMarketChangePercent ?? 0,
      },
      marketState: quoteMap.get('^NSEI')?.marketState ?? 'CLOSED',
    };

    // --- Build Portfolio Snapshot ---
    const prevDate = prevDateRows[0]?.priceDate ?? null;
    let prevSnapshots: typeof todaySnapshots = [];
    if (prevDate) {
      prevSnapshots = await db
        .select()
        .from(priceSnapshots)
        .where(
          and(
            eq(priceSnapshots.priceDate, prevDate),
            eq(priceSnapshots.source, 'NETWORTH_SNAPSHOT'),
          ),
        );
    }

    const prevMap = new Map(prevSnapshots.map((s) => [s.assetSymbol, s.price]));
    const todayNW = todaySnapshots.find((s) => s.assetSymbol === 'NET_WORTH');
    const prevNW = prevMap.get('NET_WORTH') ?? 0;
    const nwChange = (todayNW?.price ?? 0) - prevNW;

    const portfolio = {
      hasSnapshot: todaySnapshots.length > 0,
      netWorth: todayNW?.price ?? 0,
      previousNetWorth: prevNW,
      netWorthChange: nwChange,
      netWorthChangePercent: prevNW > 0 ? (nwChange / prevNW) * 100 : 0,
      previousDate: prevDate,
      breakdown: todaySnapshots
        .filter((s) => s.assetSymbol !== 'NET_WORTH')
        .map((s) => ({
          symbol: s.assetSymbol,
          name: s.assetName,
          value: s.price,
          previousValue: prevMap.get(s.assetSymbol) ?? 0,
          change: s.price - (prevMap.get(s.assetSymbol) ?? 0),
        })),
    };

    // --- MF Movers (by absolute return %) ---
    const mfGainers = mfRows.filter((m) => m.gainLossPercent > 0).slice(0, 3).map((m) => ({
      name: m.schemeName,
      returnPercent: Math.round(m.gainLossPercent * 100) / 100,
      gainLoss: m.gainLoss,
    }));
    const mfLosers = [...mfRows].sort((a, b) => a.gainLossPercent - b.gainLossPercent).filter((m) => m.gainLossPercent < 0).slice(0, 3).map((m) => ({
      name: m.schemeName,
      returnPercent: Math.round(m.gainLossPercent * 100) / 100,
      gainLoss: m.gainLoss,
    }));

    // --- Action Items ---
    const actionItems = {
      sipsDue: sipsDue.map((s) => ({
        schemeName: s.schemeName ?? 'Unknown',
        amount: s.monthlyAmount,
        dueDate: s.nextExecutionDate ?? '',
        isOverdue: (s.nextExecutionDate ?? '') < today,
      })),
      chitsDue: chitsDue.map((c) => ({
        schemeName: c.schemeName,
        foremanName: c.foremanName,
        amount: c.monthlyInstallment,
        dueDate: c.nextDueDate ?? '',
        isOverdue: (c.nextDueDate ?? '') < today,
      })),
      insuranceDue: insuranceDue.map((p) => ({
        insurer: p.insurer,
        policyNumber: p.policyNumber,
        amount: p.premiumAmount,
        dueDate: p.nextPremiumDueDate ?? '',
      })),
      loansDue: loansDue
        .filter((l) => l.type !== 'CREDIT_CARD')
        .map((l) => ({
          name: l.name,
          creditor: l.creditorName,
          amount: l.monthlyEmi,
          dueDate: l.nextPaymentDate ?? '',
          isOverdue: (l.nextPaymentDate ?? '') < today,
        })),
      cardsDue: loansDue
        .filter((l) => l.type === 'CREDIT_CARD' && (l.currentBalance ?? 0) > 0)
        .map((l) => ({
          name: l.name,
          creditor: l.creditorName,
          amount: l.currentBalance,
          dueDate: l.nextPaymentDate ?? '',
          isOverdue: (l.nextPaymentDate ?? '') < today,
        })),
    };

    // Budget summary for current month
    const budget = await buildBudgetSummary(currentPeriod());

    return NextResponse.json({
      date: today,
      portfolio,
      mfMovers: { gainers: mfGainers, losers: mfLosers },
      marketPulse,
      actionItems,
      budget,
      news: { markets: newsMarkets, personalFinance: newsPF },
    });
  } catch (err) {
    console.error('[daily-digest]', err);
    return NextResponse.json({ error: 'Failed to load digest' }, { status: 500 });
  }
}
