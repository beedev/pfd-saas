import { NextResponse } from 'next/server';
import { and, asc, eq, isNull } from 'drizzle-orm';
import {
  db,
  transformationPlans,
  transformationSections,
  transformationItems,
  transformationDays,
  transformationChecks,
} from '@/db';

// Parse a multi-item's stored day value (JSON: { selected, note }) into a
// human-readable summary like "Walking, Gym — Row Pull, Push ups".
function summarizeMultiValue(raw: string | null): string {
  if (!raw) return '';
  try {
    const v = JSON.parse(raw);
    const selected: string[] = Array.isArray(v)
      ? v.filter((x) => typeof x === 'string')
      : Array.isArray(v?.selected)
        ? v.selected.filter((x: unknown) => typeof x === 'string')
        : [];
    const note: string = typeof v?.note === 'string' ? v.note : '';
    const head = selected.join(', ');
    if (head && note) return `${head} — ${note}`;
    return head || note;
  } catch {
    return '';
  }
}

// GET /api/health/transformation/history
// Returns the plan plus every logged day enriched with completion stats,
// total calories/protein, and per-item text entries. Single fetch — the
// history page consumes this and never makes per-day calls.
export async function GET() {
  try {
    const planRows = await db.select().from(transformationPlans).limit(1);
    if (!planRows.length) {
      return NextResponse.json({ plan: null, days: [], summary: null });
    }
    const plan = planRows[0];

    // Load live (non-deleted) sections + items so we know what's a checkbox
    // vs text item, what the labels are, and how many "check items" exist
    // (used as the denominator for completion %).
    const allSections = await db
      .select()
      .from(transformationSections)
      .where(eq(transformationSections.planId, plan.id))
      .orderBy(asc(transformationSections.sortOrder));
    const liveSections = allSections.filter((s) => s.deletedAt == null);
    const sectionIds = new Set(liveSections.map((s) => s.id));

    const allItems = await db
      .select()
      .from(transformationItems)
      .orderBy(asc(transformationItems.sortOrder));
    const liveItems = allItems.filter(
      (i) => i.deletedAt == null && sectionIds.has(i.sectionId),
    );
    const itemById = new Map(liveItems.map((i) => [i.id, i]));
    const sectionById = new Map(liveSections.map((s) => [s.id, s]));
    const checkItemsTotal = liveItems.filter((i) => i.kind !== 'text').length;

    // Pull every logged day for the plan.
    const dayRows = await db
      .select()
      .from(transformationDays)
      .where(eq(transformationDays.planId, plan.id))
      .orderBy(asc(transformationDays.date));

    // For each day, get its checks in one query (per day — small N, fine).
    const days: Array<{
      date: string;
      dayNumber: number;
      currentWeightKg: number | null;
      journal: string | null;
      completionPct: number;
      checkDone: number;
      checkTotal: number;
      totalCalories: number;
      totalProteinG: number;
      textEntries: Array<{
        itemId: number;
        sectionName: string;
        label: string;
        value: string;
        calories: number | null;
        proteinG: number | null;
      }>;
    }> = [];

    let earliestWeight: number | null = null;
    let latestWeight: number | null = null;
    let weightCount = 0;
    let sumCalories = 0;
    let calorieDays = 0;
    let sumProtein = 0;
    let proteinDays = 0;
    const completionByDate = new Map<string, number>();

    for (const d of dayRows) {
      const checks = await db
        .select()
        .from(transformationChecks)
        .where(eq(transformationChecks.dayId, d.id));

      let done = 0;
      let dayCalories = 0;
      let dayProtein = 0;
      const textEntries: typeof days[number]['textEntries'] = [];

      for (const c of checks) {
        const item = itemById.get(c.itemId);
        if (!item) continue; // deleted or filtered out
        if (item.kind === 'text') {
          if (c.textValue && c.textValue.trim()) {
            textEntries.push({
              itemId: item.id,
              sectionName: sectionById.get(item.sectionId)?.name ?? '?',
              label: item.label,
              value: c.textValue,
              calories: c.estimatedCalories,
              proteinG: c.estimatedProteinG,
            });
          }
          if (c.estimatedCalories != null) dayCalories += c.estimatedCalories;
          if (c.estimatedProteinG != null) dayProtein += c.estimatedProteinG;
        } else {
          if (c.checked === 1) done += 1;
          // multi-items also surface which sub-options were ticked + the note.
          if (item.kind === 'multi') {
            const summary = summarizeMultiValue(c.textValue);
            if (summary) {
              textEntries.push({
                itemId: item.id,
                sectionName: sectionById.get(item.sectionId)?.name ?? '?',
                label: item.label,
                value: summary,
                calories: null,
                proteinG: null,
              });
            }
          }
        }
      }

      const completionPct =
        checkItemsTotal > 0 ? Math.round((done / checkItemsTotal) * 100) : 0;
      completionByDate.set(d.date, completionPct);

      if (d.currentWeightKg != null) {
        if (earliestWeight == null) earliestWeight = d.currentWeightKg;
        latestWeight = d.currentWeightKg;
        weightCount += 1;
      }
      if (dayCalories > 0) {
        sumCalories += dayCalories;
        calorieDays += 1;
      }
      if (dayProtein > 0) {
        sumProtein += dayProtein;
        proteinDays += 1;
      }

      // Recompute dayNumber against the current plan.startDate (consistent with
      // the per-day endpoint).
      const startMs = new Date(d.date.slice(0, 10) + 'T00:00:00Z').getTime();
      const planStartMs = new Date(plan.startDate + 'T00:00:00Z').getTime();
      const dayNumber = Math.floor((startMs - planStartMs) / 86400000) + 1;

      days.push({
        date: d.date,
        dayNumber,
        currentWeightKg: d.currentWeightKg,
        journal: d.journal,
        completionPct,
        checkDone: done,
        checkTotal: checkItemsTotal,
        totalCalories: dayCalories,
        totalProteinG: dayProtein,
        textEntries,
      });
    }

    // Streak — count consecutive days from the latest logged day backwards
    // where completion % was 100 (all check items done).
    let currentStreak = 0;
    let longestStreak = 0;
    let runningStreak = 0;
    for (const d of days) {
      if (d.completionPct === 100) {
        runningStreak += 1;
        if (runningStreak > longestStreak) longestStreak = runningStreak;
      } else {
        runningStreak = 0;
      }
    }
    // Recompute current streak from the end backwards
    for (let i = days.length - 1; i >= 0; i--) {
      if (days[i].completionPct === 100) currentStreak += 1;
      else break;
    }

    const summary = {
      daysLogged: days.length,
      weightStart: earliestWeight,
      weightLatest: latestWeight,
      weightDelta:
        earliestWeight != null && latestWeight != null
          ? Math.round((latestWeight - earliestWeight) * 100) / 100
          : null,
      avgCalories: calorieDays > 0 ? Math.round(sumCalories / calorieDays) : null,
      avgProteinG:
        proteinDays > 0 ? Math.round((sumProtein / proteinDays) * 10) / 10 : null,
      currentStreak,
      longestStreak,
      checkItemsTotal,
    };

    return NextResponse.json({ plan, days, summary });
  } catch (err) {
    console.error('GET history failed:', err);
    return NextResponse.json({ error: 'Failed to load history' }, { status: 500 });
  }
}

// Silence unused import (drizzle import shape)
void isNull;
void and;
