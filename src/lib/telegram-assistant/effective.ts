/**
 * Effective capabilities for a user (Phase 1.4). Merges the code registry with
 * the per-user `assistant_api_settings` overrides (Settings → Assistant APIs):
 * `included` (exposed to the assistant at all) and `dataIntegrity` (true →
 * slash-only; false → LLM-eligible). Absent row → registry default.
 */
import { eq } from 'drizzle-orm';
import { db, assistantApiSettings } from '@/db';
import { CAPABILITIES, type Capability } from './registry';

export interface EffectiveCapability extends Capability {
  included: boolean;
  /** effective integrity flag (override or registry default) */
  integrity: boolean;
}

export async function getEffectiveCapabilities(userId: string): Promise<EffectiveCapability[]> {
  const rows = await db
    .select()
    .from(assistantApiSettings)
    .where(eq(assistantApiSettings.userId, userId));
  const byId = new Map(rows.map((r) => [r.capabilityId, r]));
  return CAPABILITIES.map((c) => {
    const o = byId.get(c.id);
    return {
      ...c,
      included: o ? o.included : true,
      integrity: o ? o.dataIntegrity : c.dataIntegrity,
    };
  });
}

export const findEffectiveBySlash = (caps: EffectiveCapability[], cmd: string) =>
  caps.find((c) => c.included && c.slashCommand === cmd);

export const findEffectiveById = (caps: EffectiveCapability[], id: string) =>
  caps.find((c) => c.id === id);
