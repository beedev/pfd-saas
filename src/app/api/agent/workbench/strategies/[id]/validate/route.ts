/**
 * POST /api/agent/workbench/strategies/[id]/validate — run the saved DSL spec
 * through the backtest + Masters validation gate; persist the verdict + status.
 * First call warms the universe cache (~20s); subsequent calls are fast.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, agentUserStrategies } from '@/db';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';
import { dslToStrategy } from '@/lib/agent/workbench/dsl-interpreter';
import { validateStrategy } from '@/lib/agent/workbench/run-validation';
import type { DslSpec } from '@/lib/agent/workbench/dsl';

export const maxDuration = 120;

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'bad id' }, { status: 400 });

  const row = (await db.select().from(agentUserStrategies).where(and(eq(agentUserStrategies.id, id), eq(agentUserStrategies.userId, userId))).limit(1))[0];
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });

  try {
    const verdict = await validateStrategy(dslToStrategy(row.specJson as DslSpec));
    const [updated] = await db.update(agentUserStrategies)
      .set({ validationJson: verdict, status: verdict.verdict === 'PROMISING' ? 'VALIDATED' : 'REJECTED', updatedAt: new Date() })
      .where(eq(agentUserStrategies.id, id)).returning();
    return NextResponse.json({ strategy: updated, verdict });
  } catch (e) {
    return NextResponse.json({ error: `validation failed: ${e instanceof Error ? e.message : 'unknown'}` }, { status: 500 });
  }
}
