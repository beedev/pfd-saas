/**
 * Sprint 6.2b — Net Worth report data fetcher.
 *
 * Mirrors the snapshot math in `/api/networth/snapshot` (which is the
 * canonical source for the Net Worth tile on the home dashboard) but
 * returns a per-item breakdown so the PDF/Excel/CSV can show
 * "Stocks → INFY, TCS, …" rather than just an aggregate "Stocks → ₹X".
 *
 * Returns the same paisa-denominated totals as the snapshot so the
 * report and the dashboard tile never disagree.
 *
 * Forex deposits are valued live via `getFxRatesToInr()` (same helper
 * the dashboard tile uses). Rows whose currency doesn't resolve fall
 * back to 0 — matches the snapshot's conservative convention.
 */

import { eq } from 'drizzle-orm';
import {
  db,
  holdings,
  mutualFunds,
  goldHoldings,
  npsAccounts,
  providentFund,
  smallSavingsAccounts,
  realEstate,
  insurancePolicies,
  liabilities,
  chitFunds,
  fixedDeposits,
  forexDeposits,
} from '@/db';
import { getFxRatesToInr } from '@/lib/services/yahoo-finance';
import type { ReportParams } from '@/types/reports';

const CASH_VALUE_POLICIES = ['WHOLE_LIFE', 'ENDOWMENT', 'ULIP'];

export interface NetWorthItem {
  name: string;
  valuePaisa: number;
}

export interface NetWorthCategory {
  name: string;
  valuePaisa: number;
  items: NetWorthItem[];
}

export interface NetWorthReportData {
  asOfDate: Date;
  totals: {
    assetsPaisa: number;
    liabilitiesPaisa: number;
    netPaisa: number;
  };
  categories: NetWorthCategory[];
}

export async function fetchNetWorth(params: ReportParams): Promise<NetWorthReportData> {
  const userId = params.userId;
  const asOfDate = params.asOfDate ?? new Date();

  const [stocks, mfs, gold, nps, pf, ss, re, ins, debts, chits, fds, forex] =
    await Promise.all([
      db.select().from(holdings).where(eq(holdings.userId, userId)),
      db.select().from(mutualFunds).where(eq(mutualFunds.userId, userId)),
      db.select().from(goldHoldings).where(eq(goldHoldings.userId, userId)),
      db.select().from(npsAccounts).where(eq(npsAccounts.userId, userId)),
      db.select().from(providentFund).where(eq(providentFund.userId, userId)),
      db
        .select()
        .from(smallSavingsAccounts)
        .where(eq(smallSavingsAccounts.userId, userId)),
      db.select().from(realEstate).where(eq(realEstate.userId, userId)),
      db.select().from(insurancePolicies).where(eq(insurancePolicies.userId, userId)),
      db.select().from(liabilities).where(eq(liabilities.userId, userId)),
      db.select().from(chitFunds).where(eq(chitFunds.userId, userId)),
      db.select().from(fixedDeposits).where(eq(fixedDeposits.userId, userId)),
      db.select().from(forexDeposits).where(eq(forexDeposits.userId, userId)),
    ]);

  // Resolve FX rates once for all distinct currencies — best-effort.
  // If the live call fails we degrade to an empty map and forex rows
  // contribute zero (matches the home-page tile behaviour).
  const activeForex = forex.filter((f) => f.status === 'ACTIVE');
  let fxRates: Record<string, number> = {};
  if (activeForex.length > 0) {
    const codes = [...new Set(activeForex.map((f) => f.currencyCode.toUpperCase()))];
    try {
      fxRates = await getFxRatesToInr(codes);
    } catch {
      fxRates = {};
    }
  }

  const categories: NetWorthCategory[] = [];

  // ── Stocks ───────────────────────────────────────────────────────
  const stockItems: NetWorthItem[] = stocks.map((h) => ({
    name: h.symbol,
    valuePaisa: h.currentValue || 0,
  }));
  categories.push({
    name: 'Stocks',
    valuePaisa: stockItems.reduce((s, i) => s + i.valuePaisa, 0),
    items: stockItems,
  });

  // ── Mutual Funds ─────────────────────────────────────────────────
  const mfItems: NetWorthItem[] = mfs.map((m) => ({
    name: m.schemeName || `MF #${m.id}`,
    valuePaisa: m.currentValue || 0,
  }));
  categories.push({
    name: 'Mutual Funds',
    valuePaisa: mfItems.reduce((s, i) => s + i.valuePaisa, 0),
    items: mfItems,
  });

  // ── Gold ─────────────────────────────────────────────────────────
  const goldItems: NetWorthItem[] = gold.map((g) => ({
    name: g.type || 'Gold',
    valuePaisa: g.currentValue || 0,
  }));
  categories.push({
    name: 'Gold',
    valuePaisa: goldItems.reduce((s, i) => s + i.valuePaisa, 0),
    items: goldItems,
  });

  // ── NPS ──────────────────────────────────────────────────────────
  const npsItems: NetWorthItem[] = nps.map((n) => ({
    name: `${n.accountNumber} (${n.tier})`,
    valuePaisa: n.totalValue || 0,
  }));
  categories.push({
    name: 'NPS',
    valuePaisa: npsItems.reduce((s, i) => s + i.valuePaisa, 0),
    items: npsItems,
  });

  // ── EPF ──────────────────────────────────────────────────────────
  const pfItems: NetWorthItem[] = pf.map((p) => ({
    name: p.universalAccountNumber || p.accountNumber || `EPF #${p.id}`,
    valuePaisa: p.totalBalance || 0,
  }));
  categories.push({
    name: 'Provident Fund (EPF)',
    valuePaisa: pfItems.reduce((s, i) => s + i.valuePaisa, 0),
    items: pfItems,
  });

  // ── Small Savings ────────────────────────────────────────────────
  const ssItems: NetWorthItem[] = ss.map((a) => ({
    name: `${a.schemeType}${a.accountNumber ? ` — ${a.accountNumber}` : ''}`,
    valuePaisa: a.currentBalancePaisa || 0,
  }));
  categories.push({
    name: 'Small Savings',
    valuePaisa: ssItems.reduce((s, i) => s + i.valuePaisa, 0),
    items: ssItems,
  });

  // ── Real Estate ──────────────────────────────────────────────────
  const reItems: NetWorthItem[] = re.map((r) => ({
    name: r.propertyName || `Property #${r.id}`,
    valuePaisa: r.currentValuation || 0,
  }));
  categories.push({
    name: 'Real Estate',
    valuePaisa: reItems.reduce((s, i) => s + i.valuePaisa, 0),
    items: reItems,
  });

  // ── Insurance (cash-value only) ──────────────────────────────────
  const insItems: NetWorthItem[] = ins
    .filter((p) => CASH_VALUE_POLICIES.includes(p.policyType))
    .map((p) => ({
      name: `${p.insurer} ${p.policyNumber}`.trim(),
      valuePaisa: p.investmentValue || 0,
    }));
  categories.push({
    name: 'Insurance (Cash Value)',
    valuePaisa: insItems.reduce((s, i) => s + i.valuePaisa, 0),
    items: insItems,
  });

  // ── Chit Funds ───────────────────────────────────────────────────
  const chitItems: NetWorthItem[] = chits.map((c) => ({
    name: `${c.foremanName} (${c.schemeName})`.trim(),
    valuePaisa: c.netContribution || 0,
  }));
  categories.push({
    name: 'Chit Funds',
    valuePaisa: chitItems.reduce((s, i) => s + i.valuePaisa, 0),
    items: chitItems,
  });

  // ── Fixed Deposits (ACTIVE only) ─────────────────────────────────
  const fdItems: NetWorthItem[] = fds
    .filter((f) => f.status === 'ACTIVE')
    .map((f) => ({
      name: `${f.bankName}${f.accountNumber ? ` — ${f.accountNumber}` : ''}`,
      valuePaisa: f.principalPaisa || 0,
    }));
  categories.push({
    name: 'Fixed Deposits',
    valuePaisa: fdItems.reduce((s, i) => s + i.valuePaisa, 0),
    items: fdItems,
  });

  // ── Forex Deposits ───────────────────────────────────────────────
  // Convert each ACTIVE row's native-currency amount to INR via the
  // resolved rates map. Unresolvable rows contribute 0.
  const forexItems: NetWorthItem[] = activeForex.map((f) => {
    const amount = parseFloat(f.amountInCurrency as unknown as string);
    const rate = fxRates[f.currencyCode.toUpperCase()];
    const valuePaisa =
      Number.isFinite(amount) && Number.isFinite(rate)
        ? Math.round(amount * rate * 100)
        : 0;
    return {
      name: `${f.bankName} ${f.currencyCode}`.trim(),
      valuePaisa,
    };
  });
  categories.push({
    name: 'Forex Deposits',
    valuePaisa: forexItems.reduce((s, i) => s + i.valuePaisa, 0),
    items: forexItems,
  });

  // ── Liabilities ──────────────────────────────────────────────────
  const liaItems: NetWorthItem[] = debts.map((d) => ({
    name: `${d.creditorName} — ${d.name || d.type}`.trim(),
    valuePaisa: d.currentBalance || 0,
  }));
  const liabilitiesPaisa = liaItems.reduce((s, i) => s + i.valuePaisa, 0);
  categories.push({
    name: 'Liabilities',
    valuePaisa: liabilitiesPaisa,
    items: liaItems,
  });

  const assetsPaisa = categories
    .filter((c) => c.name !== 'Liabilities')
    .reduce((s, c) => s + c.valuePaisa, 0);
  const netPaisa = assetsPaisa - liabilitiesPaisa;

  return {
    asOfDate,
    totals: { assetsPaisa, liabilitiesPaisa, netPaisa },
    categories,
  };
}
