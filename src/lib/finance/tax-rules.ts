/**
 * Configurable tax-rules resolver.
 *
 * Single accessor for the per-FY deduction caps, surcharge brackets,
 * capital-gains rates and presumptive percentages that used to be
 * hardcoded across the tax libs. Reads the `tax_rules` table (global,
 * govt data — like tax_slabs) and falls back to DEFAULT_TAX_RULES (the
 * historical constants) when no row exists for the FY, so a missing seed
 * NEVER breaks computation.
 *
 * Engine libs take the resolved object (or the specific caps) as a
 * parameter — dependency injection — so the pure functions stay
 * synchronous and testable; only the central engine fetches once per FY.
 */

import { eq } from 'drizzle-orm';
import {
  db,
  taxRules,
  type SurchargeBracketRule,
  type CapitalGainsRules,
  type PresumptiveRules,
} from '@/db';

export interface ResolvedTaxRules {
  eightyCCapPaisa: number;
  eightyCcd1bCapPaisa: number;
  eightyDBaseCapPaisa: number;
  eightyDSeniorCapPaisa: number;
  sec24bSelfOccupiedCapPaisa: number;
  sec24bPre1999CapPaisa: number;
  sec80eeaCapPaisa: number;
  surchargeOldBrackets: SurchargeBracketRule[];
  surchargeNewBrackets: SurchargeBracketRule[];
  capitalGains: CapitalGainsRules;
  presumptive: PresumptiveRules;
}

/** The historical hardcoded values — the fallback when no FY row exists. */
export const DEFAULT_TAX_RULES: ResolvedTaxRules = {
  eightyCCapPaisa: 1_50_000 * 100,
  eightyCcd1bCapPaisa: 50_000 * 100,
  eightyDBaseCapPaisa: 25_000 * 100,
  eightyDSeniorCapPaisa: 50_000 * 100,
  sec24bSelfOccupiedCapPaisa: 2_00_000 * 100,
  sec24bPre1999CapPaisa: 30_000 * 100,
  sec80eeaCapPaisa: 1_50_000 * 100,
  surchargeOldBrackets: [
    { lowerPaisa: 0, ratePct: 0 },
    { lowerPaisa: 50_00_000 * 100, ratePct: 10 },
    { lowerPaisa: 1_00_00_000 * 100, ratePct: 15 },
    { lowerPaisa: 2_00_00_000 * 100, ratePct: 25 },
    { lowerPaisa: 5_00_00_000 * 100, ratePct: 37 },
  ],
  surchargeNewBrackets: [
    { lowerPaisa: 0, ratePct: 0 },
    { lowerPaisa: 50_00_000 * 100, ratePct: 10 },
    { lowerPaisa: 1_00_00_000 * 100, ratePct: 15 },
    { lowerPaisa: 2_00_00_000 * 100, ratePct: 25 },
    { lowerPaisa: 5_00_00_000 * 100, ratePct: 25 },
  ],
  capitalGains: {
    reformCutoff: '2024-07-23',
    sec112aExemptionPrePaisa: 1_00_000 * 100,
    sec112aExemptionPostPaisa: 1_25_000 * 100,
    ltcgEquityRatePrePct: 10,
    ltcgEquityRatePostPct: 12.5,
    stcgEquityRatePrePct: 15,
    stcgEquityRatePostPct: 20,
    ltcgGeneralRatePct: 12.5,
  },
  presumptive: {
    ad: { digitalPct: 6, cashPct: 8, turnoverLimitPaisa: 3_00_00_000 * 100 },
    ada: { pct: 50, receiptLimitPaisa: 75_00_000 * 100 },
  },
};

/** Resolve the tax rules for an FY (DB row ▸ code-constant fallback). */
export async function getTaxRules(fy: string): Promise<ResolvedTaxRules> {
  const [row] = await db.select().from(taxRules).where(eq(taxRules.fy, fy)).limit(1);
  if (!row) return DEFAULT_TAX_RULES;
  const d = DEFAULT_TAX_RULES;
  return {
    eightyCCapPaisa: row.eightyCCapPaisa,
    eightyCcd1bCapPaisa: row.eightyCcd1bCapPaisa,
    eightyDBaseCapPaisa: row.eightyDBaseCapPaisa,
    eightyDSeniorCapPaisa: row.eightyDSeniorCapPaisa,
    sec24bSelfOccupiedCapPaisa: row.sec24bSelfOccupiedCapPaisa,
    sec24bPre1999CapPaisa: row.sec24bPre1999CapPaisa,
    sec80eeaCapPaisa: row.sec80eeaCapPaisa,
    surchargeOldBrackets: row.surchargeOldBrackets ?? d.surchargeOldBrackets,
    surchargeNewBrackets: row.surchargeNewBrackets ?? d.surchargeNewBrackets,
    capitalGains: row.capitalGainsRules ?? d.capitalGains,
    presumptive: row.presumptiveRules ?? d.presumptive,
  };
}
