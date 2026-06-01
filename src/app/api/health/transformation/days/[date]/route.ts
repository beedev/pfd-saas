/**
 * Transformation tracker — per-day fetch + upsert.
 *
 * GET returns the day's row (or a stub if not saved) plus the per-item
 *     checks/texts/nutrition maps.
 * PUT upserts the day row and merges the incoming checks/texts maps.
 *
 * Postgres note: SQLite used INTEGER 0/1 for checks; pfd-saas schema
 * is a real boolean column, so values are JS booleans throughout.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import {
  db,
  transformationPlans,
  transformationDays,
  transformationChecks,
} from '@/db';
import { auth } from '@/auth';

interface Params {
  params: Promise<{ date: string }>;
}

function dayNumberFor(startDate: string, date: string): number {
  // Days are 1-indexed: startDate = day 1, +1 = day 2, etc.
  const start = new Date(startDate + 'T00:00:00Z').getTime();
  const cur = new Date(date + 'T00:00:00Z').getTime();
  if (!Number.isFinite(start) || !Number.isFinite(cur)) return 0;
  return Math.floor((cur - start) / 86400000) + 1;
}

// GET /api/health/transformation/days/[date]
export async function GET(_request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  try {
    const { date } = await params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'Invalid date (YYYY-MM-DD)' }, { status: 400 });
    }
    const planRows = await db
      .select()
      .from(transformationPlans)
      .where(eq(transformationPlans.userId, session.user.id))
      .limit(1);
    if (!planRows.length) return NextResponse.json({ error: 'No plan' }, { status: 404 });
    const plan = planRows[0];

    const dayRows = await db
      .select()
      .from(transformationDays)
      .where(
        and(
          eq(transformationDays.userId, session.user.id),
          eq(transformationDays.planId, plan.id),
          eq(transformationDays.date, date),
        ),
      )
      .limit(1);

    if (!dayRows.length) {
      return NextResponse.json({
        day: {
          planId: plan.id,
          date,
          dayNumber: dayNumberFor(plan.startDate, date),
          currentWeightKg: null,
          journal: null,
        },
        checks: {},
        texts: {},
        nutrition: {},
      });
    }

    const stored = dayRows[0];
    // Always recompute dayNumber from the *current* plan.startDate so the UI
    // stays correct if the plan's start date is edited after rows exist.
    const day = { ...stored, dayNumber: dayNumberFor(plan.startDate, date) };
    const checkRows = await db
      .select()
      .from(transformationChecks)
      .where(
        and(
          eq(transformationChecks.userId, session.user.id),
          eq(transformationChecks.dayId, stored.id),
        ),
      );
    const checks: Record<number, boolean> = {};
    const texts: Record<number, string> = {};
    const nutrition: Record<
      number,
      { calories: number; proteinG: number; estimatedAt: Date | null }
    > = {};
    for (const c of checkRows) {
      checks[c.itemId] = c.checked === true;
      if (c.textValue != null) texts[c.itemId] = c.textValue;
      if (c.estimatedCalories != null) {
        nutrition[c.itemId] = {
          calories: c.estimatedCalories,
          proteinG: c.estimatedProteinG ?? 0,
          estimatedAt: c.estimatedAt ?? null,
        };
      }
    }

    return NextResponse.json({ day, checks, texts, nutrition });
  } catch (err) {
    console.error('[transformation day GET]', err);
    return NextResponse.json({ error: 'Failed to load day' }, { status: 500 });
  }
}

// PUT /api/health/transformation/days/[date]
// Body: { currentWeightKg?, journal?, checks?: { [itemId]: boolean }, texts?: {...} }
export async function PUT(request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  try {
    const { date } = await params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'Invalid date (YYYY-MM-DD)' }, { status: 400 });
    }
    const body = await request.json();
    const planRows = await db
      .select()
      .from(transformationPlans)
      .where(eq(transformationPlans.userId, session.user.id))
      .limit(1);
    if (!planRows.length) return NextResponse.json({ error: 'No plan' }, { status: 404 });
    const plan = planRows[0];

    const now = new Date();
    const dayNumber = dayNumberFor(plan.startDate, date);

    const existing = await db
      .select()
      .from(transformationDays)
      .where(
        and(
          eq(transformationDays.userId, session.user.id),
          eq(transformationDays.planId, plan.id),
          eq(transformationDays.date, date),
        ),
      )
      .limit(1);

    let dayId: number;
    if (existing.length) {
      dayId = existing[0].id;
      const update: Partial<typeof transformationDays.$inferInsert> = { updatedAt: now };
      if (body.currentWeightKg !== undefined) {
        update.currentWeightKg =
          body.currentWeightKg === null ? null : Number(body.currentWeightKg);
      }
      if (body.journal !== undefined) update.journal = body.journal;
      if (Object.keys(update).length > 1) {
        await db
          .update(transformationDays)
          .set(update)
          .where(eq(transformationDays.id, dayId));
      }
    } else {
      const inserted = await db
        .insert(transformationDays)
        .values({
          userId: session.user.id,
          planId: plan.id,
          date,
          dayNumber,
          currentWeightKg:
            body.currentWeightKg != null ? Number(body.currentWeightKg) : null,
          journal: body.journal ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      dayId = inserted[0].id;
    }

    // Merge checks + texts into a unified per-item upsert. Both maps are
    // keyed by itemId; missing keys are left untouched.
    const incomingChecks =
      body.checks && typeof body.checks === 'object'
        ? (body.checks as Record<string, boolean>)
        : {};
    const incomingTexts =
      body.texts && typeof body.texts === 'object'
        ? (body.texts as Record<string, string | null>)
        : {};
    const touchedIds = new Set<number>();
    for (const k of Object.keys(incomingChecks)) {
      const n = Number(k);
      if (Number.isFinite(n)) touchedIds.add(n);
    }
    for (const k of Object.keys(incomingTexts)) {
      const n = Number(k);
      if (Number.isFinite(n)) touchedIds.add(n);
    }

    if (touchedIds.size) {
      const itemIds = Array.from(touchedIds);
      const existingRows = await db
        .select()
        .from(transformationChecks)
        .where(
          and(
            eq(transformationChecks.userId, session.user.id),
            eq(transformationChecks.dayId, dayId),
            inArray(transformationChecks.itemId, itemIds),
          ),
        );
      const existingByItem = new Map(existingRows.map((c) => [c.itemId, c]));

      for (const itemId of itemIds) {
        const key = String(itemId);
        const checkVal: boolean | null =
          key in incomingChecks ? Boolean(incomingChecks[key]) : null;
        const textVal = key in incomingTexts ? incomingTexts[key] : undefined;
        const existingRow = existingByItem.get(itemId);
        if (existingRow) {
          const update: Partial<typeof transformationChecks.$inferInsert> = {};
          if (checkVal != null && existingRow.checked !== checkVal) {
            update.checked = checkVal;
          }
          if (textVal !== undefined && existingRow.textValue !== textVal) {
            update.textValue = textVal;
          }
          if (Object.keys(update).length > 0) {
            await db
              .update(transformationChecks)
              .set(update)
              .where(eq(transformationChecks.id, existingRow.id));
          }
        } else {
          await db.insert(transformationChecks).values({
            userId: session.user.id,
            dayId,
            itemId,
            checked: checkVal ?? false,
            textValue: textVal ?? null,
          });
        }
      }
    }

    const day = (
      await db
        .select()
        .from(transformationDays)
        .where(eq(transformationDays.id, dayId))
    )[0];
    const checkRows = await db
      .select()
      .from(transformationChecks)
      .where(
        and(
          eq(transformationChecks.userId, session.user.id),
          eq(transformationChecks.dayId, dayId),
        ),
      );
    const checks: Record<number, boolean> = {};
    const texts: Record<number, string> = {};
    for (const c of checkRows) {
      checks[c.itemId] = c.checked === true;
      if (c.textValue != null) texts[c.itemId] = c.textValue;
    }

    return NextResponse.json({ day, checks, texts });
  } catch (err) {
    console.error('[transformation day PUT]', err);
    return NextResponse.json({ error: 'Failed to save day' }, { status: 500 });
  }
}
