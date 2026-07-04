/**
 * GET  /api/agent/workbench/strategies — the user's authored strategies
 * POST /api/agent/workbench/strategies — save a DSL spec (from the author preview)
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { db, agentUserStrategies } from '@/db';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';
import { validateSpec } from '@/lib/agent/workbench/nl-author';

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  const rows = await db.select().from(agentUserStrategies).where(eq(agentUserStrategies.userId, userId)).orderBy(desc(agentUserStrategies.id));
  return NextResponse.json({ strategies: rows });
}

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const body = await request.json();
    const check = validateSpec(body.spec);
    if (!check.ok) return NextResponse.json({ error: `invalid spec: ${check.errors.join(', ')}` }, { status: 400 });
    const name = (typeof body.name === 'string' && body.name.trim()) || check.value.meta.name || 'Untitled strategy';
    const [created] = await db.insert(agentUserStrategies).values({
      userId, name,
      description: check.value.meta.description ?? '',
      sourceNl: typeof body.sourceNl === 'string' ? body.sourceNl : '',
      specJson: check.value,
      status: 'DRAFT',
    }).returning();
    return NextResponse.json({ strategy: created }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'save failed' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  const id = Number(new URL(request.url).searchParams.get('id'));
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await db.delete(agentUserStrategies).where(and(eq(agentUserStrategies.id, id), eq(agentUserStrategies.userId, userId)));
  return NextResponse.json({ ok: true });
}
