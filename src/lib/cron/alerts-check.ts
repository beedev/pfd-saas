/**
 * Alerts-check job — Sprint 2 Phase 5.
 *
 * Tenant-aware port of personal v1's /api/alerts/check. For the given
 * userId:
 *   - Load enabled alert_rules for that user.
 *   - Fetch market quotes from Yahoo Finance v8 (global, no auth, no
 *     per-user keys — same call serves every tenant).
 *   - Evaluate each rule against quotes and the user's own assets
 *     (credit cards, chits, insurance, MFs, net-worth snapshots,
 *     budget entries).
 *   - For each triggered alert, dedup on (user_id, dedup_key) against
 *     alert_history; respect cooldown_hours.
 *   - Dispatch via stubbed Telegram service (logs to tmp/telegram-out.log
 *     until Sprint 5+ wires real Telegram).
 *
 * Every DB read is user-scoped. Telegram sends are per-user too, but
 * routed through the stub for now.
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import {
  alertHistory,
  alertRules,
  budgetCategories,
  budgetEntries,
  chitFunds,
  db,
  insurancePolicies,
  liabilities,
  mutualFunds,
  priceSnapshots,
  vehicleInsurancePolicies,
  vehiclePuc,
  vehicles,
} from '@/db';
import { getQuotes } from '@/lib/services/yahoo-finance';
import { sendTelegramMessage } from '@/lib/services/telegram';

const GRAMS_PER_OZ = 31.1035;
const INDIA_GOLD_PREMIUM = 1.07;

const today = () => new Date().toISOString().substring(0, 10);

function daysUntil(dateStr: string | null): number {
  if (!dateStr) return 999;
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diff / 86400000);
}

export interface AlertsCheckResult {
  checked: number;
  triggered: number;
  sent: number;
  deduplicated: number;
  errors: string[];
}

interface AlertResult {
  dedupKey: string;
  message: string;
  triggeredValue: number;
}

type Quote = {
  regularMarketPrice: number;
  regularMarketChange: number;
  regularMarketChangePercent: number;
  previousClose: number;
};

export async function runAlertsCheck(userId: string): Promise<AlertsCheckResult> {
  const result: AlertsCheckResult = {
    checked: 0,
    triggered: 0,
    sent: 0,
    deduplicated: 0,
    errors: [],
  };

  const rules = await db
    .select()
    .from(alertRules)
    .where(and(eq(alertRules.userId, userId), eq(alertRules.isEnabled, true)));

  if (rules.length === 0) return result;

  // Collect market symbols this user's rules need.
  const marketSymbols = new Set<string>(['USDINR=X']);
  for (const rule of rules) {
    if (rule.symbol) marketSymbols.add(rule.symbol);
    if (rule.ruleType === 'PRICE_LEVEL' && rule.symbol === 'GC=F') {
      marketSymbols.add('GC=F');
    }
  }
  const quotes = await getQuotes(Array.from(marketSymbols));
  const quoteMap = new Map<string, Quote>(quotes.map((q) => [q.symbol, q]));
  const usdInr = quoteMap.get('USDINR=X')?.regularMarketPrice ?? 0;

  for (const rule of rules) {
    result.checked++;
    try {
      const alert = await evaluateRule(userId, rule, quoteMap, usdInr);
      if (!alert) continue;
      result.triggered++;

      // Dedup against this user's alert_history.
      const existing = await db
        .select()
        .from(alertHistory)
        .where(
          and(
            eq(alertHistory.userId, userId),
            eq(alertHistory.dedupKey, alert.dedupKey),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        const lastSent = existing[0].sentAt;
        if (lastSent) {
          const hoursSince = (Date.now() - new Date(lastSent).getTime()) / 3600000;
          if (hoursSince < (rule.cooldownHours ?? 24)) {
            result.deduplicated++;
            continue;
          }
          // Cooldown expired — clear the old row so we can insert a fresh one.
          await db
            .delete(alertHistory)
            .where(
              and(
                eq(alertHistory.userId, userId),
                eq(alertHistory.id, existing[0].id),
              ),
            );
        } else {
          result.deduplicated++;
          continue;
        }
      }

      const sent = await sendTelegramMessage(alert.message);
      if (sent) {
        await db.insert(alertHistory).values({
          userId,
          ruleId: rule.id,
          dedupKey: alert.dedupKey,
          message: alert.message,
          triggeredValue: alert.triggeredValue,
        });
        result.sent++;
      } else {
        result.errors.push(`Failed to send alert for rule "${rule.name}"`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Rule "${rule.name}": ${msg}`);
    }
  }

  return result;
}

async function evaluateRule(
  userId: string,
  rule: typeof alertRules.$inferSelect,
  quoteMap: Map<string, Quote>,
  usdInr: number,
): Promise<AlertResult | null> {
  const dd = today();

  switch (rule.ruleType) {
    case 'INDEX_CHANGE': {
      const q = quoteMap.get(rule.symbol ?? '');
      if (!q) return null;
      const pct = Math.abs(q.regularMarketChangePercent);
      if (pct < rule.threshold) return null;
      const direction = q.regularMarketChangePercent >= 0 ? '📈' : '📉';
      const arrow = q.regularMarketChangePercent >= 0 ? '+' : '';
      return {
        dedupKey: `INDEX_CHANGE:${rule.symbol}:${dd}`,
        message: `${direction} *${rule.name}*\n${rule.symbol?.replace('^', '')} moved ${arrow}${q.regularMarketChangePercent.toFixed(2)}% today\nNow: ${q.regularMarketPrice.toFixed(0)} (${arrow}${q.regularMarketChange.toFixed(0)})`,
        triggeredValue: q.regularMarketChangePercent,
      };
    }

    case 'PRICE_LEVEL': {
      const q = quoteMap.get(rule.symbol ?? '');
      if (!q) return null;
      let price = q.regularMarketPrice;
      let priceLabel = `${price.toFixed(2)}`;
      if (rule.symbol === 'GC=F' && usdInr > 0) {
        price = (q.regularMarketPrice / GRAMS_PER_OZ) * usdInr * INDIA_GOLD_PREMIUM;
        priceLabel = `₹${Math.round(price).toLocaleString('en-IN')}/gram`;
      }
      const prev =
        rule.symbol === 'GC=F' && usdInr > 0
          ? (q.previousClose / GRAMS_PER_OZ) * usdInr * INDIA_GOLD_PREMIUM
          : q.previousClose;
      const crossed =
        (rule.operator === 'CROSSES_ABOVE' && price >= rule.threshold && prev < rule.threshold) ||
        (rule.operator === 'CROSSES_BELOW' && price <= rule.threshold && prev > rule.threshold) ||
        (rule.operator === 'GT' && price > rule.threshold) ||
        (rule.operator === 'LT' && price < rule.threshold);
      if (!crossed) return null;
      return {
        dedupKey: `PRICE_LEVEL:${rule.symbol}:${rule.operator}:${dd}`,
        message: `🔔 *${rule.name}*\nPrice: ${priceLabel}\nThreshold: ₹${rule.threshold.toLocaleString('en-IN')}`,
        triggeredValue: price,
      };
    }

    case 'VIX_BREACH': {
      const q = quoteMap.get('^INDIAVIX');
      if (!q) return null;
      if (q.regularMarketPrice < rule.threshold) return null;
      return {
        dedupKey: `VIX_BREACH:${dd}`,
        message: `⚠️ *${rule.name}*\nIndia VIX at ${q.regularMarketPrice.toFixed(2)} — high volatility\nThreshold: ${rule.threshold}`,
        triggeredValue: q.regularMarketPrice,
      };
    }

    case 'CREDIT_CARD_DUE': {
      const cards = await db
        .select({
          name: liabilities.name,
          amount: liabilities.currentBalance,
          nextPaymentDate: liabilities.nextPaymentDate,
        })
        .from(liabilities)
        .where(
          and(
            eq(liabilities.userId, userId),
            eq(liabilities.type, 'CREDIT_CARD'),
            eq(liabilities.status, 'ACTIVE'),
          ),
        );
      for (const card of cards) {
        const days = daysUntil(card.nextPaymentDate);
        if (days >= 0 && days <= rule.threshold) {
          return {
            dedupKey: `CC_DUE:${card.name}:${card.nextPaymentDate}`,
            message: `💳 *${card.name} — payment due${days === 0 ? ' TODAY' : ` in ${days} day${days > 1 ? 's' : ''}`}*\nOutstanding: ₹${((card.amount ?? 0) / 100).toLocaleString('en-IN')}\nDue: ${card.nextPaymentDate}`,
            triggeredValue: days,
          };
        }
      }
      return null;
    }

    case 'CHIT_DUE': {
      const chits = await db
        .select({
          schemeName: chitFunds.schemeName,
          foremanName: chitFunds.foremanName,
          amount: chitFunds.monthlyInstallment,
          nextDueDate: chitFunds.nextDueDate,
        })
        .from(chitFunds)
        .where(and(eq(chitFunds.userId, userId), eq(chitFunds.status, 'ACTIVE')));
      for (const chit of chits) {
        const days = daysUntil(chit.nextDueDate);
        if (days >= 0 && days <= rule.threshold) {
          return {
            dedupKey: `CHIT_DUE:${chit.schemeName}:${chit.nextDueDate}`,
            message: `📋 *Chit installment due${days === 0 ? ' TODAY' : ` in ${days} day${days > 1 ? 's' : ''}`}*\n${chit.foremanName} — ${chit.schemeName}\nAmount: ₹${((chit.amount ?? 0) / 100).toLocaleString('en-IN')}\nDue: ${chit.nextDueDate}`,
            triggeredValue: days,
          };
        }
      }
      return null;
    }

    case 'INSURANCE_DUE': {
      const policies = await db
        .select({
          insurer: insurancePolicies.insurer,
          policyNumber: insurancePolicies.policyNumber,
          premium: insurancePolicies.premiumAmount,
          dueDate: insurancePolicies.nextPremiumDueDate,
        })
        .from(insurancePolicies)
        .where(
          and(
            eq(insurancePolicies.userId, userId),
            eq(insurancePolicies.status, 'ACTIVE'),
          ),
        );
      for (const p of policies) {
        const days = daysUntil(p.dueDate);
        if (days >= 0 && days <= rule.threshold) {
          return {
            dedupKey: `INS_DUE:${p.policyNumber}:${p.dueDate}`,
            message: `🛡️ *Insurance premium due${days === 0 ? ' TODAY' : ` in ${days} day${days > 1 ? 's' : ''}`}*\n${p.insurer} — #${p.policyNumber}\nPremium: ₹${((p.premium ?? 0) / 100).toLocaleString('en-IN')}\nDue: ${p.dueDate}`,
            triggeredValue: days,
          };
        }
      }
      return null;
    }

    case 'LOAN_EMI_DUE': {
      const loans = await db
        .select({
          name: liabilities.name,
          creditor: liabilities.creditorName,
          emi: liabilities.monthlyEmi,
          nextPaymentDate: liabilities.nextPaymentDate,
        })
        .from(liabilities)
        .where(
          and(
            eq(liabilities.userId, userId),
            eq(liabilities.status, 'ACTIVE'),
            sql`${liabilities.type} != 'CREDIT_CARD'`,
          ),
        );
      for (const loan of loans) {
        const days = daysUntil(loan.nextPaymentDate);
        if (days >= 0 && days <= rule.threshold) {
          return {
            dedupKey: `EMI_DUE:${loan.name}:${loan.nextPaymentDate}`,
            message: `🏦 *Loan EMI due${days === 0 ? ' TODAY' : ` in ${days} day${days > 1 ? 's' : ''}`}*\n${loan.name} (${loan.creditor})\nEMI: ₹${((loan.emi ?? 0) / 100).toLocaleString('en-IN')}\nDue: ${loan.nextPaymentDate}`,
            triggeredValue: days,
          };
        }
      }
      return null;
    }

    case 'MF_WEEKLY_DROP': {
      const funds = await db
        .select()
        .from(mutualFunds)
        .where(eq(mutualFunds.userId, userId));
      for (const mf of funds) {
        if (mf.gainLossPercent < -rule.threshold) {
          const weekNum = Math.floor(Date.now() / (7 * 86400000));
          return {
            dedupKey: `MF_DROP:${mf.id}:${weekNum}`,
            message: `📉 *MF underperforming: ${mf.schemeName}*\nReturn: ${mf.gainLossPercent.toFixed(1)}%\nInvested: ₹${(mf.totalInvestment / 100).toLocaleString('en-IN')}\nCurrent: ₹${(mf.currentValue / 100).toLocaleString('en-IN')}`,
            triggeredValue: mf.gainLossPercent,
          };
        }
      }
      return null;
    }

    case 'NET_WORTH_MILESTONE': {
      const latest = await db
        .select({ price: priceSnapshots.price })
        .from(priceSnapshots)
        .where(
          and(
            eq(priceSnapshots.userId, userId),
            eq(priceSnapshots.assetSymbol, 'NET_WORTH'),
          ),
        )
        .orderBy(desc(priceSnapshots.priceDate))
        .limit(1);
      if (!latest.length) return null;
      const nwPaisa = latest[0].price;
      const thresholdPaisa = rule.threshold * 100;
      if (nwPaisa < thresholdPaisa) return null;
      return {
        dedupKey: `NW_MILESTONE:${rule.threshold}`,
        message: `🏆 *Net worth milestone!*\nCrossed ₹${rule.threshold.toLocaleString('en-IN')}\nCurrent: ₹${(nwPaisa / 100).toLocaleString('en-IN')}`,
        triggeredValue: nwPaisa / 100,
      };
    }

    case 'BUDGET_OVERSPEND': {
      const now = new Date();
      const period = `${String(now.getMonth() + 1).padStart(2, '0')}${now.getFullYear()}`;
      const entries = await db
        .select({
          categoryName: budgetCategories.name,
          planned: budgetEntries.plannedAmount,
          actual: budgetEntries.actualAmount,
        })
        .from(budgetEntries)
        .leftJoin(budgetCategories, eq(budgetEntries.categoryId, budgetCategories.id))
        .where(
          and(eq(budgetEntries.userId, userId), eq(budgetEntries.period, period)),
        );
      for (const e of entries) {
        const planned = e.planned ?? 0;
        const actual = e.actual ?? 0;
        if (planned <= 0) continue;
        const overspendPct = ((actual - planned) / planned) * 100;
        if (overspendPct > rule.threshold) {
          return {
            dedupKey: `BUDGET:${e.categoryName}:${period}`,
            message: `💸 *Budget overspend: ${e.categoryName}*\nPlanned: ₹${(planned / 100).toLocaleString('en-IN')}\nActual: ₹${(actual / 100).toLocaleString('en-IN')}\nOver by ${overspendPct.toFixed(0)}%`,
            triggeredValue: overspendPct,
          };
        }
      }
      return null;
    }

    case 'VEHICLE_INSURANCE_DUE': {
      // Join vehicle_insurance_policies with vehicles to get the
      // registration number in the message. Only active policies on
      // active vehicles count.
      const rows = await db
        .select({
          insurer: vehicleInsurancePolicies.insurer,
          policyNumber: vehicleInsurancePolicies.policyNumber,
          premium: vehicleInsurancePolicies.premiumPaisa,
          renewalDate: vehicleInsurancePolicies.renewalDate,
          regNumber: vehicles.registrationNumber,
          make: vehicles.make,
          model: vehicles.model,
        })
        .from(vehicleInsurancePolicies)
        .innerJoin(vehicles, eq(vehicles.id, vehicleInsurancePolicies.vehicleId))
        .where(
          and(
            eq(vehicleInsurancePolicies.userId, userId),
            eq(vehicleInsurancePolicies.status, 'ACTIVE'),
            eq(vehicles.status, 'ACTIVE'),
          ),
        );
      for (const r of rows) {
        const days = daysUntil(r.renewalDate);
        if (days >= 0 && days <= rule.threshold) {
          return {
            dedupKey: `VEH_INS:${r.policyNumber}:${r.renewalDate}`,
            message: `🚗 *Vehicle insurance renewal due${days === 0 ? ' TODAY' : ` in ${days} day${days > 1 ? 's' : ''}`}*\n${r.make} ${r.model} (${r.regNumber})\n${r.insurer} — #${r.policyNumber}\nPremium: ₹${((r.premium ?? 0) / 100).toLocaleString('en-IN')}\nDue: ${r.renewalDate}`,
            triggeredValue: days,
          };
        }
      }
      return null;
    }

    case 'PUC_EXPIRY_DUE': {
      // For each vehicle's LATEST PUC (one per vehicle), check expiry.
      // We don't have a single "active PUC" flag, so query then group
      // in JS — finite vehicle count per user, no perf concern.
      const rows = await db
        .select({
          regNumber: vehicles.registrationNumber,
          make: vehicles.make,
          model: vehicles.model,
          vehicleId: vehicles.id,
          certificateNumber: vehiclePuc.certificateNumber,
          validUntil: vehiclePuc.validUntil,
          pucId: vehiclePuc.id,
        })
        .from(vehiclePuc)
        .innerJoin(vehicles, eq(vehicles.id, vehiclePuc.vehicleId))
        .where(
          and(
            eq(vehiclePuc.userId, userId),
            eq(vehicles.status, 'ACTIVE'),
          ),
        );
      // Keep only the latest PUC per vehicle (highest validUntil).
      const latest = new Map<number, typeof rows[number]>();
      for (const r of rows) {
        const prev = latest.get(r.vehicleId);
        if (!prev || (r.validUntil ?? '') > (prev.validUntil ?? '')) {
          latest.set(r.vehicleId, r);
        }
      }
      for (const r of latest.values()) {
        const days = daysUntil(r.validUntil);
        if (days >= 0 && days <= rule.threshold) {
          return {
            dedupKey: `PUC_EXP:${r.regNumber}:${r.validUntil}`,
            message: `🚦 *PUC expires${days === 0 ? ' TODAY' : ` in ${days} day${days > 1 ? 's' : ''}`}*\n${r.make} ${r.model} (${r.regNumber})\nCertificate #${r.certificateNumber}\nValid until: ${r.validUntil}`,
            triggeredValue: days,
          };
        }
      }
      return null;
    }

    default:
      return null;
  }
}
