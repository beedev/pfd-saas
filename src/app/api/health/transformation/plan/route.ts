import { NextRequest, NextResponse } from 'next/server';
import { asc, eq, isNull, sql } from 'drizzle-orm';
import {
  db,
  transformationPlans,
  transformationSections,
  transformationItems,
  transformationDays,
} from '@/db';

// GET /api/health/transformation/plan
// Returns the active plan with sections + items (omits soft-deleted rows).
// For now there's always exactly one plan; we return the first row.
export async function GET() {
  try {
    const planRows = await db.select().from(transformationPlans).limit(1);
    if (!planRows.length) {
      return NextResponse.json({ plan: null, sections: [] });
    }
    const plan = planRows[0];

    const sectionRows = await db
      .select()
      .from(transformationSections)
      .where(eq(transformationSections.planId, plan.id))
      .orderBy(asc(transformationSections.sortOrder));
    const liveSections = sectionRows.filter((s) => s.deletedAt == null);

    const itemRows = await db
      .select()
      .from(transformationItems)
      .orderBy(asc(transformationItems.sortOrder));
    const itemsBySection = new Map<number, typeof itemRows>();
    for (const item of itemRows) {
      if (item.deletedAt != null) continue;
      if (!itemsBySection.has(item.sectionId)) itemsBySection.set(item.sectionId, []);
      itemsBySection.get(item.sectionId)!.push(item);
    }

    const sections = liveSections.map((s) => ({
      ...s,
      items: itemsBySection.get(s.id) ?? [],
    }));

    return NextResponse.json({ plan, sections });
  } catch (err) {
    console.error('GET plan failed:', err);
    return NextResponse.json({ error: 'Failed to load plan' }, { status: 500 });
  }
}

// PATCH /api/health/transformation/plan
// Update plan-level fields (name, weight targets, calorie/protein, notes).
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const planRows = await db.select().from(transformationPlans).limit(1);
    if (!planRows.length) {
      return NextResponse.json({ error: 'No plan found' }, { status: 404 });
    }
    const plan = planRows[0];

    const update: Partial<typeof transformationPlans.$inferInsert> = {
      updatedAt: Math.floor(Date.now() / 1000),
    };
    if (typeof body.name === 'string') update.name = body.name;
    if (typeof body.startDate === 'string') update.startDate = body.startDate;
    if (typeof body.dayCount === 'number') update.dayCount = body.dayCount;
    if (typeof body.startWeightKg === 'number') update.startWeightKg = body.startWeightKg;
    if (typeof body.goalWeightKg === 'number') update.goalWeightKg = body.goalWeightKg;
    if (typeof body.dailyCalorieTarget === 'number') update.dailyCalorieTarget = body.dailyCalorieTarget;
    if (typeof body.dailyProteinTargetG === 'number') update.dailyProteinTargetG = body.dailyProteinTargetG;
    if (body.notes !== undefined) update.notes = body.notes;

    const result = await db
      .update(transformationPlans)
      .set(update)
      .where(eq(transformationPlans.id, plan.id))
      .returning();

    // If startDate changed, backfill day_number on existing day rows so any
    // direct DB read stays consistent. The /days/[date] GET always recomputes
    // anyway, but this keeps the persisted column honest.
    if (typeof update.startDate === 'string' && update.startDate !== plan.startDate) {
      await db.run(sql`
        UPDATE ${transformationDays}
        SET day_number = CAST(julianday(date) - julianday(${update.startDate}) AS INTEGER) + 1
        WHERE plan_id = ${plan.id}
      `);
    }

    return NextResponse.json({ plan: result[0] });
  } catch (err) {
    console.error('PATCH plan failed:', err);
    return NextResponse.json({ error: 'Failed to update plan' }, { status: 500 });
  }
}

// Silence unused-import lint
void isNull;
