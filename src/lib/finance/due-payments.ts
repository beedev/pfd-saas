/**
 * Upcoming/overdue payments for a user (assistant read capability `get_due_payments`).
 *
 * A focused, network-free read: SIPs, chit installments, insurance premiums,
 * loan EMIs and credit-card statements that are due soon or overdue. All amounts
 * are paisa (bigint columns), `isOverdue = dueDate < today`.
 *
 * NOTE: this mirrors the action-items block inside
 * `src/lib/cron/daily-digest.ts` (buildDailyDigest). The digest still has its own
 * inline copy because it's network-heavy (market quotes + news) and we don't want
 * a quick "what's due?" Telegram read to depend on that. Candidate to unify: have
 * the digest import this. Kept separate for now to avoid touching the cron path.
 */
import { and, eq, lte, gte } from 'drizzle-orm';
import {
  db,
  sips,
  mutualFunds,
  chitFunds,
  insurancePolicies,
  liabilities,
} from '@/db';

export interface DueItem {
  category: 'SIP' | 'Chit' | 'Insurance' | 'Loan' | 'Card';
  label: string;
  amountPaisa: number;
  dueDate: string;
  isOverdue: boolean;
}

const today = () => new Date().toISOString().substring(0, 10);
const plusDays = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().substring(0, 10);
};

export async function getDuePayments(userId: string): Promise<DueItem[]> {
  const t = today();
  const in7 = plusDays(7);
  const in30 = plusDays(30);
  const overdue = (dueDate: string | null) => Boolean(dueDate && dueDate < t);

  const [sipRows, chitRows, insRows, liabRows] = await Promise.all([
    db
      .select({ scheme: mutualFunds.schemeName, amount: sips.monthlyAmount, due: sips.nextExecutionDate })
      .from(sips)
      .innerJoin(mutualFunds, eq(sips.mutualFundId, mutualFunds.id))
      .where(and(eq(sips.userId, userId), eq(sips.status, 'ACTIVE'), lte(sips.nextExecutionDate, in7))),
    db
      .select({ scheme: chitFunds.schemeName, foreman: chitFunds.foremanName, amount: chitFunds.monthlyInstallment, due: chitFunds.nextDueDate })
      .from(chitFunds)
      .where(and(eq(chitFunds.userId, userId), eq(chitFunds.status, 'ACTIVE'), lte(chitFunds.nextDueDate, in30))),
    db
      .select({ insurer: insurancePolicies.insurer, policyNumber: insurancePolicies.policyNumber, amount: insurancePolicies.premiumAmount, due: insurancePolicies.nextPremiumDueDate })
      .from(insurancePolicies)
      .where(and(eq(insurancePolicies.userId, userId), eq(insurancePolicies.status, 'ACTIVE'), gte(insurancePolicies.nextPremiumDueDate, t), lte(insurancePolicies.nextPremiumDueDate, in30))),
    db
      .select({ name: liabilities.name, type: liabilities.type, emi: liabilities.monthlyEmi, balance: liabilities.currentBalance, due: liabilities.nextPaymentDate })
      .from(liabilities)
      .where(and(eq(liabilities.userId, userId), eq(liabilities.status, 'ACTIVE'), lte(liabilities.nextPaymentDate, in7))),
  ]);

  const items: DueItem[] = [];
  for (const r of sipRows) items.push({ category: 'SIP', label: r.scheme ?? 'SIP', amountPaisa: Number(r.amount ?? 0), dueDate: r.due ?? t, isOverdue: overdue(r.due) });
  for (const r of chitRows) items.push({ category: 'Chit', label: r.foreman ? `${r.scheme} (${r.foreman})` : r.scheme ?? 'Chit', amountPaisa: Number(r.amount ?? 0), dueDate: r.due ?? t, isOverdue: overdue(r.due) });
  for (const r of insRows) items.push({ category: 'Insurance', label: `${r.insurer} ${r.policyNumber ?? ''}`.trim(), amountPaisa: Number(r.amount ?? 0), dueDate: r.due ?? t, isOverdue: overdue(r.due) });
  for (const r of liabRows) {
    if (r.type === 'CREDIT_CARD') {
      if (Number(r.balance ?? 0) > 0) items.push({ category: 'Card', label: r.name, amountPaisa: Number(r.balance ?? 0), dueDate: r.due ?? t, isOverdue: overdue(r.due) });
    } else {
      items.push({ category: 'Loan', label: r.name, amountPaisa: Number(r.emi ?? 0), dueDate: r.due ?? t, isOverdue: overdue(r.due) });
    }
  }

  // overdue first, then by due date
  items.sort((a, b) => (a.isOverdue === b.isOverdue ? a.dueDate.localeCompare(b.dueDate) : a.isOverdue ? -1 : 1));
  return items;
}
