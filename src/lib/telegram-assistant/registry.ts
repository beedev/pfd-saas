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
import { deriveDeductions } from '@/lib/finance/deduction-engine';
import { getCurrentFinancialYear } from '@/lib/finance/tax-constants';
import {
  readGold,
  readMutualFunds,
  readStocks,
  readSips,
  readInsurance,
  readChitFunds,
  readLiabilities,
  readNps,
  readProvidentFund,
  readRealEstate,
  readForex,
  readCapitalGains,
  readSpending,
  readGoals,
  readRetirement,
} from './reads';

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
  {
    id: 'get_tax_deductions',
    summary: 'Chapter VI-A tax deductions claimed this financial year',
    kind: 'read',
    dataIntegrity: false,
    slashCommand: '/tax',
    params: [],
    invoke: async (userId) => {
      const fy = getCurrentFinancialYear();
      const r = await deriveDeductions(userId, fy);
      return {
        fy,
        oldRegimeTotalPaisa: r.oldRegimeTotalPaisa,
        newRegimeTotalPaisa: r.newRegimeTotalPaisa,
        breakdown: r.breakdown,
      };
    },
  },

  // ── Broad read surface (always LLM-available; reads can't mutate data) ──
  { id: 'get_gold', summary: 'Gold holdings and their current value', kind: 'read', dataIntegrity: false, slashCommand: '/gold', params: [], invoke: (u) => readGold(u) },
  { id: 'get_mutual_funds', summary: 'Mutual fund portfolio and value', kind: 'read', dataIntegrity: false, slashCommand: '/mf', params: [], invoke: (u) => readMutualFunds(u) },
  { id: 'get_stocks', summary: 'Stock holdings and value', kind: 'read', dataIntegrity: false, slashCommand: '/stocks', params: [], invoke: (u) => readStocks(u) },
  { id: 'get_sips', summary: 'Active SIPs and their monthly amounts / next dates', kind: 'read', dataIntegrity: false, slashCommand: '/sips', params: [], invoke: (u) => readSips(u) },
  { id: 'get_insurance', summary: 'Insurance policies (LIC + health) — premiums, cover, due dates', kind: 'read', dataIntegrity: false, slashCommand: '/insurance', params: [], invoke: (u) => readInsurance(u) },
  { id: 'get_chit_funds', summary: 'Chit fund positions — installments, due dates, XIRR', kind: 'read', dataIntegrity: false, slashCommand: '/chits', params: [], invoke: (u) => readChitFunds(u) },
  { id: 'get_liabilities', summary: 'Loans and credit cards — outstanding balances and EMIs', kind: 'read', dataIntegrity: false, slashCommand: '/loans', params: [], invoke: (u) => readLiabilities(u) },
  { id: 'get_nps', summary: 'NPS balance', kind: 'read', dataIntegrity: false, slashCommand: '/nps', params: [], invoke: (u) => readNps(u) },
  { id: 'get_provident_fund', summary: 'Provident fund (EPF/PPF/VPF) balance', kind: 'read', dataIntegrity: false, slashCommand: '/pf', params: [], invoke: (u) => readProvidentFund(u) },
  { id: 'get_real_estate', summary: 'Real-estate properties and valuations', kind: 'read', dataIntegrity: false, slashCommand: '/property', params: [], invoke: (u) => readRealEstate(u) },
  { id: 'get_forex_deposits', summary: 'Foreign-currency deposits and their INR value', kind: 'read', dataIntegrity: false, slashCommand: '/forex', params: [], invoke: (u) => readForex(u) },
  { id: 'get_capital_gains', summary: 'Capital gains this financial year (LTCG/STCG and tax)', kind: 'read', dataIntegrity: false, slashCommand: '/gains', params: [], invoke: (u) => readCapitalGains(u) },
  { id: 'get_spending', summary: "This month's spending vs budget by category", kind: 'read', dataIntegrity: false, slashCommand: '/spend', params: [], invoke: (u) => readSpending(u) },
  { id: 'get_goals', summary: 'Named savings goals and their funding status — target, amount saved, on-track, monthly contribution needed (e.g. child education/pilot training, marriage, emergency fund). NOT retirement.', kind: 'read', dataIntegrity: false, slashCommand: '/goals', params: [], invoke: (u) => readGoals(u) },
  { id: 'get_retirement', summary: 'Retirement plan and year-by-year corpus projection — retirement age, monthly expense, corpus growth/withdrawals/returns each year, whether the corpus lasts. Use for any retirement question.', kind: 'read', dataIntegrity: false, slashCommand: '/retirement', params: [], invoke: (u) => readRetirement(u) },
];

export const findCapability = (id: string) => CAPABILITIES.find((c) => c.id === id);
export const findBySlash = (cmd: string) => CAPABILITIES.find((c) => c.slashCommand === cmd);

/**
 * Drift guard (Phase 1.2). The registry is hand-edited code, so the failure
 * modes are duplicate ids, duplicate/mis-typed slash commands, or malformed
 * params — all of which would silently break routing. Called once per
 * processInbox so any drift fails loudly (tick → 500) the first time it runs.
 */
export function assertRegistryIntegrity(): void {
  const ids = new Set<string>();
  const slashes = new Set<string>();
  for (const c of CAPABILITIES) {
    if (!c.id) throw new Error('registry: a capability has an empty id');
    if (ids.has(c.id)) throw new Error(`registry: duplicate capability id "${c.id}"`);
    ids.add(c.id);
    if (c.kind !== 'read' && c.kind !== 'write') throw new Error(`registry: "${c.id}" has invalid kind`);
    if (c.slashCommand) {
      if (!/^\/[a-z]+$/i.test(c.slashCommand)) throw new Error(`registry: "${c.id}" slash "${c.slashCommand}" must be /letters`);
      if (slashes.has(c.slashCommand)) throw new Error(`registry: duplicate slash command "${c.slashCommand}"`);
      slashes.add(c.slashCommand);
    }
    for (const p of c.params) {
      if (!p.name) throw new Error(`registry: "${c.id}" has an unnamed param`);
    }
  }
}
