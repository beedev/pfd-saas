import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import {
  db,
  transformationChecks,
  transformationDays,
  transformationPlans,
} from '@/db';

export const runtime = 'nodejs';

interface EstimateRequest {
  text: string;
  itemId: number;
  date?: string; // ISO YYYY-MM-DD — if provided, persists estimate on the day's check row
}

interface NutritionEstimate {
  calories: number;
  proteinG: number;
  notes?: string;
}

/**
 * POST /api/health/transformation/estimate-nutrition
 *
 * Estimates calories + protein for a meal text via OpenAI gpt-4o-mini.
 * Cached by the input text — if the stored estimationInput on the check row
 * matches the incoming text, the cached value is returned without an LLM call.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as EstimateRequest;
    const text = (body.text ?? '').trim();
    if (!text) {
      return NextResponse.json({ error: 'text required' }, { status: 400 });
    }
    if (typeof body.itemId !== 'number') {
      return NextResponse.json({ error: 'itemId required' }, { status: 400 });
    }

    // Cache lookup: if we have an existing check row with matching input,
    // return its persisted estimate. Saves an LLM round-trip on revisits.
    let cachedDayId: number | null = null;
    if (body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      const planRows = await db.select().from(transformationPlans).limit(1);
      if (planRows.length) {
        const dayRows = await db
          .select()
          .from(transformationDays)
          .where(
            and(
              eq(transformationDays.planId, planRows[0].id),
              eq(transformationDays.date, body.date),
            ),
          )
          .limit(1);
        if (dayRows.length) {
          cachedDayId = dayRows[0].id;
          const checkRows = await db
            .select()
            .from(transformationChecks)
            .where(
              and(
                eq(transformationChecks.dayId, cachedDayId),
                eq(transformationChecks.itemId, body.itemId),
              ),
            )
            .limit(1);
          if (
            checkRows.length &&
            checkRows[0].estimationInput === text &&
            checkRows[0].estimatedCalories != null
          ) {
            return NextResponse.json({
              estimate: {
                calories: checkRows[0].estimatedCalories,
                proteinG: checkRows[0].estimatedProteinG ?? 0,
              },
              cached: true,
            });
          }
        }
      }
    }

    // Live LLM call
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            'OPENAI_API_KEY not configured. Add it to .env.local and restart the service.',
        },
        { status: 503 },
      );
    }

    const estimate = await estimateWithOpenAI(text, apiKey);

    // Persist on the matching check row if we have a day context
    if (cachedDayId != null) {
      const existing = await db
        .select()
        .from(transformationChecks)
        .where(
          and(
            eq(transformationChecks.dayId, cachedDayId),
            eq(transformationChecks.itemId, body.itemId),
          ),
        )
        .limit(1);
      const now = Math.floor(Date.now() / 1000);
      if (existing.length) {
        await db
          .update(transformationChecks)
          .set({
            estimatedCalories: estimate.calories,
            estimatedProteinG: estimate.proteinG,
            estimationInput: text,
            estimatedAt: now,
            textValue: text, // keep in sync — UI may not have saved yet
          })
          .where(eq(transformationChecks.id, existing[0].id));
      } else {
        await db.insert(transformationChecks).values({
          dayId: cachedDayId,
          itemId: body.itemId,
          checked: 0,
          textValue: text,
          estimatedCalories: estimate.calories,
          estimatedProteinG: estimate.proteinG,
          estimationInput: text,
          estimatedAt: now,
        });
      }
    }

    return NextResponse.json({ estimate, cached: false });
  } catch (err) {
    console.error('estimate-nutrition failed:', err);
    const msg = err instanceof Error ? err.message : 'Estimation failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

async function estimateWithOpenAI(
  text: string,
  apiKey: string,
): Promise<NutritionEstimate> {
  const prompt = `Estimate total calories and protein content for this meal. Indian foods are common. Be realistic about portion sizes mentioned.

Meal: ${text}

Reply ONLY with valid JSON in this exact format, no other text:
{"calories": <integer total kcal>, "proteinG": <number grams of protein>, "notes": "<one short sentence explaining the estimate>"}`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You are a nutrition estimator. You reply only with valid JSON in the requested format. No prose, no markdown fences.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const content: string = data?.choices?.[0]?.message?.content ?? '';
  let parsed: NutritionEstimate;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Could not parse LLM JSON: ${content.slice(0, 200)}`);
  }
  // Sanity-clamp
  const calories = Math.max(0, Math.min(5000, Math.round(Number(parsed.calories) || 0)));
  const proteinG = Math.max(0, Math.min(500, Number(parsed.proteinG) || 0));
  return { calories, proteinG, notes: parsed.notes };
}
