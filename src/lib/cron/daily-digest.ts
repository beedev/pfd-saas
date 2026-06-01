/**
 * Daily-digest job — Sprint 2 Phase 5.
 *
 * Tenant-aware port of personal v1's /api/daily-digest. Builds a
 * portfolio snapshot for a single user (their net worth Δ vs prior day,
 * MF movers, action items due, budget summary), plus global market
 * pulse (indices + commodities + USDINR — same for every tenant).
 *
 * Two entry points:
 *   buildDailyDigest(userId)        → structured JSON for the UI
 *   runDailyDigestJob(userId)       → builds digest + pushes via Telegram
 *
 * Telegram is stubbed unless TELEGRAM_BOT_TOKEN+CHAT_ID are set (see
 * src/lib/services/telegram.ts and STUBS.md #3).
 */

import {
  and,
  asc as _asc,
  desc,
  eq,
  gte,
  lt,
  lte,
  sql,
} from 'drizzle-orm';
import {
  budgetCategories,
  budgetEntries,
  chitFundInstallments,
  chitFunds,
  creditCardExpenses,
  db,
  insurancePolicies,
  investmentTransactions,
  liabilities,
  mutualFunds,
  priceSnapshots,
  sips,
} from '@/db';
import { getQuotes } from '@/lib/services/yahoo-finance';
import { sendTelegramToUser } from '@/lib/services/telegram';

const MARKET_SYMBOLS = ['^NSEI', '^BSESN', '^NSEBANK', '^INDIAVIX', 'GC=F', 'SI=F', 'USDINR=X'];

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

async function buildBudgetSummary(userId: string, period: string) {
  const [from, to] = periodToDateRange(period);

  const cats = await db
    .select()
    .from(budgetCategories)
    .where(
      and(
        eq(budgetCategories.userId, userId),
        eq(budgetCategories.isActive, true),
        eq(budgetCategories.type, 'EXPENSE'),
      ),
    );

  const entries = await db
    .select()
    .from(budgetEntries)
    .where(
      and(eq(budgetEntries.userId, userId), eq(budgetEntries.period, period)),
    );

  const ccRows = await db
    .select({
      name: liabilities.name,
      amount: creditCardExpenses.amount,
      paidAmount: creditCardExpenses.paidAmount,
    })
    .from(creditCardExpenses)
    .innerJoin(liabilities, eq(liabilities.id, creditCardExpenses.liabilityId))
    .where(
      and(
        eq(creditCardExpenses.userId, userId),
        eq(liabilities.type, 'CREDIT_CARD'),
        eq(creditCardExpenses.period, period),
      ),
    );

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
        eq(investmentTransactions.userId, userId),
        eq(investmentTransactions.type, 'SIP_EXECUTION'),
        gte(investmentTransactions.transactionDate, from),
        lt(investmentTransactions.transactionDate, to),
      ),
    );
  const sipActual = Number(sipActualRow[0]?.total ?? 0);

  const chitActualRow = await db
    .select({ total: sql<number>`COALESCE(SUM(${chitFundInstallments.installmentPaid}), 0)` })
    .from(chitFundInstallments)
    .where(
      and(
        eq(chitFundInstallments.userId, userId),
        gte(chitFundInstallments.paidOn, from),
        lt(chitFundInstallments.paidOn, to),
      ),
    );
  const chitActual = Number(chitActualRow[0]?.total ?? 0);

  type Row = { name: string; planned: number; actual: number; remaining: number; status: BudgetStatus };
  const rows: Row[] = [];
  for (const cat of cats) {
    const e = entries.find((x) => x.categoryId === cat.id);
    const planned = e?.plannedAmount ?? 0;
    let actual = e?.actualAmount ?? 0;
    if (ccByName[cat.name]) actual = ccByName[cat.name].paid;
    else if (cat.name === 'SIP') actual = sipActual;
    else if (cat.name === 'Chit') actual = chitActual;

    const status = deriveStatus(actual, planned);
    if (!status) continue;
    rows.push({ name: cat.name, planned, actual, remaining: Math.max(0, planned - actual), status });
  }

  const totalPlanned = rows.reduce((s, r) => s + r.planned, 0);
  const totalActual = rows.reduce((s, r) => s + r.actual, 0);
  const pending = rows.filter((r) => r.status !== 'paid').sort((a, b) => b.remaining - a.remaining);

  return {
    period,
    totalPlanned,
    totalActual,
    paidCount: rows.filter((r) => r.status === 'paid').length,
    partialCount: rows.filter((r) => r.status === 'partial').length,
    unpaidCount: rows.filter((r) => r.status === 'unpaid').length,
    pending,
  };
}

export interface DailyDigest {
  date: string;
  portfolio: {
    hasSnapshot: boolean;
    netWorth: number;
    previousNetWorth: number;
    netWorthChange: number;
    netWorthChangePercent: number;
    previousDate: string | null;
    breakdown: Array<{ symbol: string; name: string | null; value: number; previousValue: number; change: number }>;
  };
  mfMovers: {
    gainers: Array<{ name: string; returnPercent: number; gainLoss: number }>;
    losers: Array<{ name: string; returnPercent: number; gainLoss: number }>;
  };
  marketPulse: {
    indices: Array<{ name: string; symbol: string; value: number; change: number; changePercent: number; marketState: string }>;
    commodities: Array<{ name: string; value: number; change: number; changePercent: number }>;
    forex: { usdInr: number; change: number; changePercent: number };
    marketState: string;
  };
  actionItems: {
    sipsDue: Array<{ schemeName: string; amount: number; dueDate: string; isOverdue: boolean }>;
    chitsDue: Array<{ schemeName: string; foremanName: string | null; amount: number; dueDate: string; isOverdue: boolean }>;
    insuranceDue: Array<{ insurer: string; policyNumber: string; amount: number; dueDate: string }>;
    loansDue: Array<{ name: string; creditor: string | null; amount: number; dueDate: string; isOverdue: boolean }>;
    cardsDue: Array<{ name: string; creditor: string | null; amount: number; dueDate: string; isOverdue: boolean }>;
  };
  budget: Awaited<ReturnType<typeof buildBudgetSummary>>;
}

export async function buildDailyDigest(userId: string): Promise<DailyDigest> {
  const today = new Date().toISOString().substring(0, 10);
  const weekFromNow = new Date(Date.now() + 7 * 86400000).toISOString().substring(0, 10);
  const monthFromNow = new Date(Date.now() + 30 * 86400000).toISOString().substring(0, 10);

  const [
    quotes,
    todaySnapshots,
    prevDateRows,
    mfRows,
    sipsDue,
    chitsDueRows,
    insuranceDue,
    loansDue,
  ] = await Promise.all([
    getQuotes(MARKET_SYMBOLS),
    db
      .select()
      .from(priceSnapshots)
      .where(
        and(
          eq(priceSnapshots.userId, userId),
          eq(priceSnapshots.priceDate, today),
          eq(priceSnapshots.source, 'NETWORTH_SNAPSHOT'),
        ),
      ),
    db
      .select({ priceDate: priceSnapshots.priceDate })
      .from(priceSnapshots)
      .where(
        and(
          eq(priceSnapshots.userId, userId),
          lt(priceSnapshots.priceDate, today),
          eq(priceSnapshots.source, 'NETWORTH_SNAPSHOT'),
        ),
      )
      .orderBy(desc(priceSnapshots.priceDate))
      .limit(1),
    db
      .select()
      .from(mutualFunds)
      .where(eq(mutualFunds.userId, userId))
      .orderBy(desc(mutualFunds.gainLossPercent)),
    db
      .select({
        id: sips.id,
        schemeName: mutualFunds.schemeName,
        monthlyAmount: sips.monthlyAmount,
        nextExecutionDate: sips.nextExecutionDate,
        frequency: sips.frequency,
      })
      .from(sips)
      .leftJoin(mutualFunds, eq(sips.mutualFundId, mutualFunds.id))
      .where(
        and(
          eq(sips.userId, userId),
          eq(sips.status, 'ACTIVE'),
          lte(sips.nextExecutionDate, weekFromNow),
        ),
      ),
    db
      .select()
      .from(chitFunds)
      .where(
        and(
          eq(chitFunds.userId, userId),
          eq(chitFunds.status, 'ACTIVE'),
          lte(chitFunds.nextDueDate, monthFromNow),
        ),
      ),
    db
      .select()
      .from(insurancePolicies)
      .where(
        and(
          eq(insurancePolicies.userId, userId),
          eq(insurancePolicies.status, 'ACTIVE'),
          lte(insurancePolicies.nextPremiumDueDate, monthFromNow),
          gte(insurancePolicies.nextPremiumDueDate, today),
        ),
      ),
    db
      .select()
      .from(liabilities)
      .where(
        and(
          eq(liabilities.userId, userId),
          eq(liabilities.status, 'ACTIVE'),
          lte(liabilities.nextPaymentDate, weekFromNow),
        ),
      ),
  ]);

  // Market pulse (global)
  const quoteMap = new Map(quotes.map((q) => [q.symbol, q]));
  const usdInr = quoteMap.get('USDINR=X');
  const goldUsd = quoteMap.get('GC=F');
  const silverUsd = quoteMap.get('SI=F');
  const usdInrRate =
    usdInr?.regularMarketPrice && usdInr.regularMarketPrice > 0
      ? usdInr.regularMarketPrice
      : usdInr?.previousClose && usdInr.previousClose > 0
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

  // Portfolio (per-user)
  const prevDate = prevDateRows[0]?.priceDate ?? null;
  let prevSnapshots: typeof todaySnapshots = [];
  if (prevDate) {
    prevSnapshots = await db
      .select()
      .from(priceSnapshots)
      .where(
        and(
          eq(priceSnapshots.userId, userId),
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

  // MF movers (per-user)
  const mfGainers = mfRows
    .filter((m) => m.gainLossPercent > 0)
    .slice(0, 3)
    .map((m) => ({ name: m.schemeName, returnPercent: Math.round(m.gainLossPercent * 100) / 100, gainLoss: m.gainLoss }));
  const mfLosers = [...mfRows]
    .sort((a, b) => a.gainLossPercent - b.gainLossPercent)
    .filter((m) => m.gainLossPercent < 0)
    .slice(0, 3)
    .map((m) => ({ name: m.schemeName, returnPercent: Math.round(m.gainLossPercent * 100) / 100, gainLoss: m.gainLoss }));

  // Action items (per-user)
  const actionItems = {
    sipsDue: sipsDue.map((s) => ({
      schemeName: s.schemeName ?? 'Unknown',
      amount: s.monthlyAmount,
      dueDate: s.nextExecutionDate ?? '',
      isOverdue: (s.nextExecutionDate ?? '') < today,
    })),
    chitsDue: chitsDueRows.map((c) => ({
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

  const budget = await buildBudgetSummary(userId, currentPeriod());

  return { date: today, portfolio, mfMovers: { gainers: mfGainers, losers: mfLosers }, marketPulse, actionItems, budget };
}

/**
 * Format a digest as Markdown for Telegram. Compact — Telegram messages
 * cap around 4096 chars, and Indians read these on a phone.
 */
export function formatDigestText(d: DailyDigest): string {
  const inr = (paisa: number) => `₹${Math.round(paisa / 100).toLocaleString('en-IN')}`;
  const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

  const lines: string[] = [];
  lines.push(`📊 *Daily Digest — ${d.date}*`);
  lines.push('');

  // Portfolio
  if (d.portfolio.hasSnapshot) {
    const c = d.portfolio.netWorthChange;
    const arrow = c >= 0 ? '📈' : '📉';
    lines.push(`*Net worth:* ${inr(d.portfolio.netWorth)}`);
    if (d.portfolio.previousDate) {
      lines.push(`${arrow} ${c >= 0 ? '+' : ''}${inr(c).replace('₹', '₹')} (${pct(d.portfolio.netWorthChangePercent)}) vs ${d.portfolio.previousDate}`);
    }
  } else {
    lines.push(`*Net worth:* snapshot pending`);
  }
  lines.push('');

  // Market pulse
  lines.push(`*Markets:*`);
  for (const idx of d.marketPulse.indices) {
    if (idx.value === 0) continue;
    lines.push(`  ${idx.name}: ${Math.round(idx.value).toLocaleString('en-IN')} ${pct(idx.changePercent)}`);
  }
  lines.push(`  Gold (g): ₹${d.marketPulse.commodities[0]?.value.toLocaleString('en-IN')} ${pct(d.marketPulse.commodities[0]?.changePercent ?? 0)}`);
  lines.push(`  USDINR: ${d.marketPulse.forex.usdInr.toFixed(2)} ${pct(d.marketPulse.forex.changePercent)}`);
  lines.push('');

  // MF movers
  if (d.mfMovers.gainers.length || d.mfMovers.losers.length) {
    lines.push(`*MF top movers:*`);
    for (const g of d.mfMovers.gainers) lines.push(`  📈 ${g.name}: ${pct(g.returnPercent)}`);
    for (const l of d.mfMovers.losers) lines.push(`  📉 ${l.name}: ${pct(l.returnPercent)}`);
    lines.push('');
  }

  // Action items — only show if there's anything
  const ai = d.actionItems;
  const totalActions = ai.sipsDue.length + ai.chitsDue.length + ai.insuranceDue.length + ai.loansDue.length + ai.cardsDue.length;
  if (totalActions > 0) {
    lines.push(`*Action items:*`);
    for (const s of ai.sipsDue) lines.push(`  💸 SIP ${s.schemeName} — ${inr(s.amount)} due ${s.dueDate}${s.isOverdue ? ' OVERDUE' : ''}`);
    for (const c of ai.chitsDue) lines.push(`  📋 Chit ${c.schemeName} — ${inr(c.amount)} due ${c.dueDate}${c.isOverdue ? ' OVERDUE' : ''}`);
    for (const i of ai.insuranceDue) lines.push(`  🛡️ ${i.insurer} #${i.policyNumber} — ${inr(i.amount)} due ${i.dueDate}`);
    for (const l of ai.loansDue) lines.push(`  🏦 ${l.name} EMI — ${inr(l.amount)} due ${l.dueDate}${l.isOverdue ? ' OVERDUE' : ''}`);
    for (const c of ai.cardsDue) lines.push(`  💳 ${c.name} — ${inr(c.amount)} due ${c.dueDate}${c.isOverdue ? ' OVERDUE' : ''}`);
    lines.push('');
  }

  // Budget pending
  if (d.budget.pending.length > 0) {
    lines.push(`*Budget:* ${d.budget.unpaidCount} unpaid, ${d.budget.partialCount} partial`);
    for (const p of d.budget.pending.slice(0, 5)) {
      lines.push(`  ${p.name}: ${inr(p.actual)} / ${inr(p.planned)} (${p.status})`);
    }
  }

  return lines.join('\n');
}

export async function runDailyDigestJob(
  userId: string,
): Promise<{ sent: boolean; preview: string; skipReason?: string }> {
  const digest = await buildDailyDigest(userId);
  const text = formatDigestText(digest);
  const result = await sendTelegramToUser(userId, text);
  if (result.ok) {
    return { sent: true, preview: text };
  }
  // User hasn't paired Telegram yet — that's fine, just skip silently.
  if (result.reason === 'no-chat-id') {
    console.log(`[daily-digest] user ${userId} hasn't paired Telegram; skipping`);
    return { sent: false, preview: text, skipReason: 'no-chat-id' };
  }
  return { sent: false, preview: text, skipReason: result.reason };
}
