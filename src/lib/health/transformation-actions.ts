/**
 * Transformation-tracker actions, scoped by userId (assistant capabilities
 * `get_today_status`, `log_weight`, `tick_habit`).
 *
 * The tracker previously had no reusable service — all logic was inline in the
 * `PUT /api/health/transformation/days/[date]` route. These are focused,
 * idempotent helpers over the same tables (so they're safe for free-text/LLM
 * use): set today's weight, tick one habit done, read today's summary. "Today"
 * is the server's UTC date (matches the daily-digest convention).
 */
import { and, eq, isNull } from 'drizzle-orm';
import {
  db,
  transformationPlans,
  transformationDays,
  transformationItems,
  transformationSections,
  transformationChecks,
  type TransformationPlan,
  type TransformationDay,
} from '@/db';

const today = () => new Date().toISOString().substring(0, 10);

const dayNumberFor = (startDate: string, date: string) =>
  Math.floor((Date.parse(date) - Date.parse(startDate)) / 86_400_000) + 1;

async function getPlan(userId: string): Promise<TransformationPlan> {
  const rows = await db.select().from(transformationPlans).where(eq(transformationPlans.userId, userId)).limit(1);
  const plan = rows[0];
  if (!plan) throw new Error('No transformation plan yet — set one up in the app first.');
  return plan;
}

/** Find today's day row, creating it if missing (idempotent). */
async function getOrCreateToday(userId: string, plan: TransformationPlan): Promise<TransformationDay> {
  const date = today();
  const existing = await db
    .select()
    .from(transformationDays)
    .where(and(eq(transformationDays.userId, userId), eq(transformationDays.planId, plan.id), eq(transformationDays.date, date)))
    .limit(1);
  if (existing[0]) return existing[0];
  const inserted = await db
    .insert(transformationDays)
    .values({ userId, planId: plan.id, date, dayNumber: dayNumberFor(plan.startDate, date) })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return inserted[0];
  // lost an insert race — re-read
  const again = await db
    .select()
    .from(transformationDays)
    .where(and(eq(transformationDays.userId, userId), eq(transformationDays.planId, plan.id), eq(transformationDays.date, date)))
    .limit(1);
  return again[0];
}

/** Live habit (kind='check') items for the plan. */
async function habitItems(userId: string, planId: number) {
  return db
    .select({ id: transformationItems.id, label: transformationItems.label })
    .from(transformationItems)
    .innerJoin(transformationSections, eq(transformationItems.sectionId, transformationSections.id))
    .where(
      and(
        eq(transformationItems.userId, userId),
        eq(transformationSections.planId, planId),
        eq(transformationItems.kind, 'check'),
        isNull(transformationItems.deletedAt),
        isNull(transformationSections.deletedAt),
      ),
    );
}

export interface TodayStatus {
  date: string;
  dayNumber: number;
  weightKg: number | null;
  habitsDone: number;
  habitsTotal: number;
}

export async function getTodayStatus(userId: string): Promise<TodayStatus> {
  const plan = await getPlan(userId);
  const date = today();
  const dayRows = await db
    .select()
    .from(transformationDays)
    .where(and(eq(transformationDays.userId, userId), eq(transformationDays.planId, plan.id), eq(transformationDays.date, date)))
    .limit(1);
  const day = dayRows[0];
  const habits = await habitItems(userId, plan.id);
  let habitsDone = 0;
  if (day) {
    const checks = await db
      .select({ itemId: transformationChecks.itemId, checked: transformationChecks.checked })
      .from(transformationChecks)
      .where(and(eq(transformationChecks.userId, userId), eq(transformationChecks.dayId, day.id)));
    const habitIds = new Set(habits.map((h) => h.id));
    habitsDone = checks.filter((c) => c.checked && habitIds.has(c.itemId)).length;
  }
  return {
    date,
    dayNumber: dayNumberFor(plan.startDate, date),
    weightKg: day?.currentWeightKg ?? null,
    habitsDone,
    habitsTotal: habits.length,
  };
}

export async function setTodayWeight(userId: string, kg: number): Promise<{ date: string; weightKg: number }> {
  if (!Number.isFinite(kg) || kg <= 0 || kg > 500) throw new Error('That weight doesn’t look right — give a value in kg (e.g. 78.5).');
  const plan = await getPlan(userId);
  const day = await getOrCreateToday(userId, plan);
  await db
    .update(transformationDays)
    .set({ currentWeightKg: kg, updatedAt: new Date() })
    .where(and(eq(transformationDays.id, day.id), eq(transformationDays.userId, userId)));
  return { date: day.date, weightKg: kg };
}

export async function tickHabit(userId: string, query: string): Promise<{ habit: string; date: string }> {
  const q = query.trim();
  if (!q) throw new Error('Which habit? e.g. /tick workout');
  const plan = await getPlan(userId);
  const matches = (await habitItems(userId, plan.id)).filter((h) => h.label.toLowerCase().includes(q.toLowerCase()));
  if (matches.length === 0) throw new Error(`No habit matching “${q}”.`);
  if (matches.length > 1) throw new Error(`Multiple habits match “${q}” (${matches.map((m) => m.label).join(', ')}) — be more specific.`);
  const item = matches[0];
  const day = await getOrCreateToday(userId, plan);
  await db
    .insert(transformationChecks)
    .values({ userId, dayId: day.id, itemId: item.id, checked: true })
    .onConflictDoUpdate({
      target: [transformationChecks.userId, transformationChecks.dayId, transformationChecks.itemId],
      set: { checked: true },
    });
  return { habit: item.label, date: day.date };
}
