/**
 * Effective capabilities for a user. The curation model is **writes-only**:
 *
 *  - **Reads** can't mutate anything, so they are ALWAYS included and ALWAYS
 *    LLM-eligible — `assistant_api_settings` is ignored for them. This is the
 *    broad "list of read APIs the LLM can choose from".
 *  - **Writes** touch data integrity, so they respect the per-user
 *    `assistant_api_settings` overrides: `included` (exposed at all) and
 *    `dataIntegrity` (true → slash-only + dedupe; false → also LLM-eligible).
 *    Absent row → registry default.
 */
import { eq } from 'drizzle-orm';
import { db, assistantApiSettings } from '@/db';
import { CAPABILITIES, type Capability } from './registry';

export interface EffectiveCapability extends Capability {
  included: boolean;
  /** effective integrity flag (override or registry default; always false for reads) */
  integrity: boolean;
}

export async function getEffectiveCapabilities(userId: string): Promise<EffectiveCapability[]> {
  const rows = await db
    .select()
    .from(assistantApiSettings)
    .where(eq(assistantApiSettings.userId, userId));
  const byId = new Map(rows.map((r) => [r.capabilityId, r]));
  return CAPABILITIES.map((c) => {
    if (c.kind === 'read') {
      // reads are never curated — always on, always LLM-eligible
      return { ...c, included: true, integrity: false };
    }
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
