/**
 * Transformation tracker — plan-level fetch + update.
 *
 * GET   returns the current plan with all (non-deleted) sections and items.
 * PATCH updates plan-level fields (name, weight targets, calorie/protein).
 *
 * Ported from personal-v1 — see CLAUDE.md notes on porting rules.
 * One plan per user; multiple plans are not modelled in v1 (the first
 * row wins).
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq, isNull } from 'drizzle-orm';
import {
  db,
  transformationPlans,
  transformationSections,
  transformationItems,
  transformationDays,
} from '@/db';
import { auth } from '@/auth';

/** Default starter template for a new plan — the proven V1 structure. */
const STARTER_TEMPLATE: Array<{
  name: string;
  items: Array<{ label: string; kind: string; options?: string }>;
}> = [
  {
    name: 'Morning Routine',
    items: [
      { label: 'Wake up 6:00 am', kind: 'check' },
      { label: 'Drink hot lemon water', kind: 'check' },
      { label: 'Fresh up', kind: 'check' },
      { label: 'Morning meditation', kind: 'check' },
    ],
  },
  {
    name: 'Health',
    items: [
      { label: '3 ltr water', kind: 'check' },
      {
        label: 'Physical Activity',
        kind: 'multi',
        options: JSON.stringify(['Walking 6k steps', 'Stretching', 'Simple weights', 'Gym']),
      },
    ],
  },
  {
    name: 'Meals',
    items: [
      { label: 'Morning Meals', kind: 'text' },
      { label: 'Evening Meals', kind: 'text' },
      { label: 'Protein Less than 50 gms', kind: 'check' },
      { label: 'Protein adequate', kind: 'check' },
    ],
  },
  {
    name: 'Night Routine',
    items: [
      { label: '5 min journal writing', kind: 'check' },
      { label: "Plan the next day's tasks", kind: 'check' },
      { label: 'No screen 1 hour before bed', kind: 'check' },
      { label: 'Cleaning', kind: 'check' },
    ],
  },
];

// GET /api/health/transformation/plan
// Returns the active plan with sections + items (omits soft-deleted rows).
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  try {
    const planRows = await db
      .select()
      .from(transformationPlans)
      .where(eq(transformationPlans.userId, session.user.id))
      .limit(1);
    if (!planRows.length) {
      return NextResponse.json({ plan: null, sections: [] });
    }
    const plan = planRows[0];

    const sectionRows = await db
      .select()
      .from(transformationSections)
      .where(
        and(
          eq(transformationSections.userId, session.user.id),
          eq(transformationSections.planId, plan.id),
          isNull(transformationSections.deletedAt),
        ),
      )
      .orderBy(asc(transformationSections.sortOrder));

    const itemRows = await db
      .select()
      .from(transformationItems)
      .where(
        and(
          eq(transformationItems.userId, session.user.id),
          isNull(transformationItems.deletedAt),
        ),
      )
      .orderBy(asc(transformationItems.sortOrder));

    const itemsBySection = new Map<number, typeof itemRows>();
    for (const item of itemRows) {
      if (!itemsBySection.has(item.sectionId)) itemsBySection.set(item.sectionId, []);
      itemsBySection.get(item.sectionId)!.push(item);
    }

    const sections = sectionRows.map((s) => ({
      ...s,
      items: itemsBySection.get(s.id) ?? [],
    }));

    return NextResponse.json({ plan, sections });
  } catch (err) {
    console.error('[transformation plan GET]', err);
    return NextResponse.json({ error: 'Failed to load plan' }, { status: 500 });
  }
}

// PATCH /api/health/transformation/plan
// Update plan-level fields (name, weight targets, calorie/protein, notes).
export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  try {
    const body = await request.json();
    const planRows = await db
      .select()
      .from(transformationPlans)
      .where(eq(transformationPlans.userId, session.user.id))
      .limit(1);
    if (!planRows.length) {
      return NextResponse.json({ error: 'No plan found' }, { status: 404 });
    }
    const plan = planRows[0];

    const update: Partial<typeof transformationPlans.$inferInsert> = {
      updatedAt: new Date(),
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
      .where(
        and(
          eq(transformationPlans.userId, session.user.id),
          eq(transformationPlans.id, plan.id),
        ),
      )
      .returning();

    // If startDate changed, day_number on existing day rows becomes stale.
    // The /days/[date] GET always recomputes dayNumber from the live plan
    // start, so reading is fine — but the persisted column drifts. We
    // recompute it here in JS (no julianday() in Postgres) so direct DB
    // reads stay honest. The N+1 is acceptable: this only runs on plan
    // start-date edits, which are rare.
    if (typeof update.startDate === 'string' && update.startDate !== plan.startDate) {
      const dayRows = await db
        .select()
        .from(transformationDays)
        .where(
          and(
            eq(transformationDays.userId, session.user.id),
            eq(transformationDays.planId, plan.id),
          ),
        );
      const startMs = new Date(update.startDate + 'T00:00:00Z').getTime();
      for (const d of dayRows) {
        const ms = new Date(d.date + 'T00:00:00Z').getTime();
        const newNumber = Math.floor((ms - startMs) / 86400000) + 1;
        if (d.dayNumber !== newNumber) {
          await db
            .update(transformationDays)
            .set({ dayNumber: newNumber })
            .where(eq(transformationDays.id, d.id));
        }
      }
    }

    return NextResponse.json({ plan: result[0] });
  } catch (err) {
    console.error('[transformation plan PATCH]', err);
    return NextResponse.json({ error: 'Failed to update plan' }, { status: 500 });
  }
}

// POST /api/health/transformation/plan
// Create the user's plan (one per user) and seed the starter template so an
// empty account can begin from the UI. 409 if a plan already exists.
export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  try {
    const existing = await db
      .select({ id: transformationPlans.id })
      .from(transformationPlans)
      .where(eq(transformationPlans.userId, session.user.id))
      .limit(1);
    if (existing.length) {
      return NextResponse.json({ error: 'A plan already exists.' }, { status: 409 });
    }

    const today = new Date().toISOString().substring(0, 10);
    const [plan] = await db
      .insert(transformationPlans)
      .values({
        userId: session.user.id,
        name: '100 Days Transformation Challenge',
        startDate: today,
        dayCount: 100,
      })
      .returning();

    for (let s = 0; s < STARTER_TEMPLATE.length; s++) {
      const sec = STARTER_TEMPLATE[s];
      const [section] = await db
        .insert(transformationSections)
        .values({ userId: session.user.id, planId: plan.id, name: sec.name, sortOrder: s })
        .returning({ id: transformationSections.id });
      for (let i = 0; i < sec.items.length; i++) {
        const it = sec.items[i];
        await db.insert(transformationItems).values({
          userId: session.user.id,
          sectionId: section.id,
          label: it.label,
          kind: it.kind,
          options: it.options ?? null,
          sortOrder: i,
        });
      }
    }

    return NextResponse.json({ plan }, { status: 201 });
  } catch (err) {
    console.error('[transformation plan POST]', err);
    return NextResponse.json({ error: 'Failed to create plan' }, { status: 500 });
  }
}
