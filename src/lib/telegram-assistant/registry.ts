/**
 * Assistant capability registry (Phase 0.7 / 1.1).
 *
 * Each capability wraps existing app logic and runs AS the given user. The
 * `dataIntegrity` flag gates how it's reachable (see the spec): false → LLM-
 * eligible; true → slash-command only + message_id dedupe.
 */
import { and, desc, eq, ilike, isNull } from 'drizzle-orm';
import { db, liabilities, creditCardExpenses } from '@/db';
import { computeNetWorth } from '@/lib/assets/registry';
import { recomputeCreditCardBudgetForPeriod } from '@/lib/finance/budget-sync';
import { getDuePayments } from '@/lib/finance/due-payments';
import { getTodayStatus, setTodayWeight, tickHabit } from '@/lib/health/transformation-actions';

export interface CapParam {
  name: string;
  type: 'string' | 'number' | 'date';
  required: boolean;
  description: string;
}

export interface Capability {
  id: string;
  summary: string;
  kind: 'read' | 'write';
  dataIntegrity: boolean;
  slashCommand?: string;
  params: CapParam[];
  invoke: (userId: string, args: Record<string, unknown>) => Promise<unknown>;
}

export const CAPABILITIES: Capability[] = [
  {
    id: 'get_net_worth',
    summary: 'Show current net worth and the asset/liability breakdown',
    kind: 'read',
    dataIntegrity: false,
    slashCommand: '/networth',
    params: [],
    invoke: async (userId) => computeNetWorth(userId),
  },
  {
    id: 'mark_card_paid',
    summary: 'Mark a credit-card statement paid in full, dated today',
    kind: 'write',
    dataIntegrity: true,
    slashCommand: '/paid',
    params: [{ name: 'card', type: 'string', required: true, description: 'Credit-card name, e.g. HDFC' }],
    invoke: async (userId, args) => {
      const cardName = String(args.card ?? '').trim();
      const cards = await db
        .select()
        .from(liabilities)
        .where(
          and(
            eq(liabilities.userId, userId),
            eq(liabilities.type, 'CREDIT_CARD'),
            ilike(liabilities.name, `%${cardName}%`),
          ),
        )
        .limit(2);
      if (cards.length === 0) throw new Error(`No credit card matching “${cardName}”.`);
      if (cards.length > 1) throw new Error(`Multiple cards match “${cardName}” — be more specific.`);
      const card = cards[0];

      const rows = await db
        .select()
        .from(creditCardExpenses)
        .where(
          and(
            eq(creditCardExpenses.userId, userId),
            eq(creditCardExpenses.liabilityId, card.id),
            isNull(creditCardExpenses.paidAmount),
          ),
        )
        .orderBy(desc(creditCardExpenses.period))
        .limit(1);
      const target = rows[0];
      if (!target) throw new Error(`No outstanding statement on ${card.name}.`);

      const today = new Date().toISOString().substring(0, 10);
      await db
        .update(creditCardExpenses)
        .set({ paidAmount: target.amount, settledOn: today })
        .where(and(eq(creditCardExpenses.id, target.id), eq(creditCardExpenses.userId, userId)));

      const newBalance = Math.max(0, card.currentBalance - target.amount);
      await db
        .update(liabilities)
        .set({ currentBalance: newBalance, lastPaymentDate: today, updatedAt: new Date() })
        .where(and(eq(liabilities.id, card.id), eq(liabilities.userId, userId)));

      await recomputeCreditCardBudgetForPeriod(userId, card.id, target.period);
      return { card: card.name, paidPaisa: target.amount, period: target.period, newBalancePaisa: newBalance };
    },
  },
  {
    id: 'get_due_payments',
    summary: 'List upcoming or overdue payments (SIPs, chits, insurance, loan EMIs, credit-card statements)',
    kind: 'read',
    dataIntegrity: false,
    slashCommand: '/due',
    params: [],
    invoke: async (userId) => getDuePayments(userId),
  },
  {
    id: 'get_today_status',
    summary: "Today's transformation-tracker status — habits done, weight, day number",
    kind: 'read',
    dataIntegrity: false,
    slashCommand: '/today',
    params: [],
    invoke: async (userId) => getTodayStatus(userId),
  },
  {
    id: 'log_weight',
    summary: "Log today's body weight in kg",
    kind: 'write',
    // Idempotent (upserts today's weight) → safe for free-text/LLM use.
    dataIntegrity: false,
    slashCommand: '/weight',
    params: [{ name: 'kg', type: 'number', required: true, description: 'Body weight in kilograms, e.g. 78.5' }],
    invoke: async (userId, args) => setTodayWeight(userId, Number(args.kg)),
  },
  {
    id: 'tick_habit',
    summary: 'Mark a habit done for today',
    kind: 'write',
    // Idempotent (sets the habit checked=true) → safe for free-text/LLM use.
    dataIntegrity: false,
    slashCommand: '/tick',
    params: [{ name: 'habit', type: 'string', required: true, description: 'Habit name, e.g. workout' }],
    invoke: async (userId, args) => tickHabit(userId, String(args.habit ?? '')),
  },
];

export const findCapability = (id: string) => CAPABILITIES.find((c) => c.id === id);
export const findBySlash = (cmd: string) => CAPABILITIES.find((c) => c.slashCommand === cmd);
