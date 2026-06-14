/**
 * Assistant APIs settings (Phase 1.4) — the registry-curation screen.
 *
 *   GET   → { capabilities: [{ id, summary, kind, slashCommand, registryDefault,
 *            included, dataIntegrity }] }  merging the code registry with the
 *            user's per-capability overrides in `assistant_api_settings`.
 *   PATCH { capabilityId, included?, dataIntegrity? } → upsert one override.
 *
 * The Telegram worker reads these via getEffectiveCapabilities(): `included`
 * gates whether the assistant can reach a capability at all; `dataIntegrity`
 * gates how (true → slash-only + dedupe; false → also LLM-eligible). Lets the
 * user manage registry drift and tighten integrity per action.
 */
import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, assistantApiSettings } from '@/db';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';
import { CAPABILITIES, findCapability } from '@/lib/telegram-assistant/registry';

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();

  const rows = await db
    .select()
    .from(assistantApiSettings)
    .where(eq(assistantApiSettings.userId, userId));
  const byId = new Map(rows.map((r) => [r.capabilityId, r]));

  const capabilities = CAPABILITIES.map((c) => {
    const o = byId.get(c.id);
    return {
      id: c.id,
      summary: c.summary,
      kind: c.kind,
      slashCommand: c.slashCommand ?? null,
      registryDefaultIntegrity: c.dataIntegrity,
      included: o ? o.included : true,
      dataIntegrity: o ? o.dataIntegrity : c.dataIntegrity,
    };
  });
  return NextResponse.json({ capabilities });
}

export async function PATCH(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();

  let body: { capabilityId?: string; included?: boolean; dataIntegrity?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const capabilityId = (body.capabilityId ?? '').trim();
  const cap = findCapability(capabilityId);
  if (!cap) return NextResponse.json({ error: 'Unknown capability.' }, { status: 400 });
  // Curation is writes-only — reads are always available and can't mutate data.
  if (cap.kind === 'read') {
    return NextResponse.json({ error: 'Reads are always available and not configurable.' }, { status: 400 });
  }

  // Read the current effective values so a partial PATCH preserves the other flag.
  const existing = await db
    .select()
    .from(assistantApiSettings)
    .where(and(eq(assistantApiSettings.userId, userId), eq(assistantApiSettings.capabilityId, capabilityId)))
    .limit(1);
  const current = existing[0];
  const included = body.included ?? current?.included ?? true;
  const dataIntegrity = body.dataIntegrity ?? current?.dataIntegrity ?? cap.dataIntegrity;

  await db
    .insert(assistantApiSettings)
    .values({ userId, capabilityId, included, dataIntegrity })
    .onConflictDoUpdate({
      target: [assistantApiSettings.userId, assistantApiSettings.capabilityId],
      set: { included, dataIntegrity, updatedAt: new Date() },
    });

  return NextResponse.json({ ok: true, capabilityId, included, dataIntegrity });
}
