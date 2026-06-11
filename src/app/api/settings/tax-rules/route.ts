/**
 * Tax rules / rates / slabs EDITOR API — global govt data (NOT user-scoped).
 *
 * Lets the user keep the deduction caps, surcharge brackets, capital-gains
 * rates, presumptive percentages, regime constants and the slab tables
 * current when the budget changes them, without a code deploy. The tax
 * engine reads these tables via getTaxRules() / the slab loaders with a
 * code-constant fallback, so editing here flows straight into computation.
 *
 * All money columns are PAISA. Percentages are plain numbers.
 *
 * Auth-guarded (same pattern as /api/user-preferences) — any signed-in user
 * may read; PATCH writes the global rows.
 */

import { NextRequest, NextResponse } from 'next/server';
import { eq, asc } from 'drizzle-orm';
import {
  db,
  taxRules,
  taxSlabs,
  taxRegimeConfig,
  type TaxRegime,
  type SurchargeBracketRule,
  type CapitalGainsRules,
  type PresumptiveRules,
} from '@/db';
import { auth } from '@/auth';
import { DEFAULT_TAX_RULES } from '@/lib/finance/tax-rules';

const FY_RE = /^\d{4}-\d{2}$/;

/** The editable scalar money/JSON fields of a tax_rules row. */
interface RulesPayload {
  eightyCCapPaisa?: number;
  eightyCcd1bCapPaisa?: number;
  eightyDBaseCapPaisa?: number;
  eightyDSeniorCapPaisa?: number;
  sec24bSelfOccupiedCapPaisa?: number;
  sec24bPre1999CapPaisa?: number;
  sec80eeaCapPaisa?: number;
  surchargeOldBrackets?: SurchargeBracketRule[];
  surchargeNewBrackets?: SurchargeBracketRule[];
  capitalGainsRules?: CapitalGainsRules;
  presumptiveRules?: PresumptiveRules;
}

interface RegimeConfigPayload {
  regime: TaxRegime;
  standardDeductionPaisa: number;
  rebate87aThresholdPaisa: number;
  rebate87aMaxPaisa: number;
  cessPct: number;
}

interface SlabPayload {
  regime: TaxRegime;
  slabOrder: number;
  lowerPaisa: number;
  upperPaisa: number | null;
  ratePct: number;
}

interface PatchBody {
  rules?: RulesPayload;
  regimeConfig?: RegimeConfigPayload[];
  slabs?: SlabPayload[];
}

// ─────────────────────────────────────────────────────────────────────────
// GET ?fy=YYYY-YY → { fy, rules, rulesSeeded, regimeConfig, slabs }
// ─────────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const fy = request.nextUrl.searchParams.get('fy');
  if (!fy || !FY_RE.test(fy)) {
    return NextResponse.json({ error: 'fy query param required (format YYYY-YY)' }, { status: 400 });
  }

  try {
    const [rulesRow] = await db.select().from(taxRules).where(eq(taxRules.fy, fy)).limit(1);
    const regimeConfig = await db
      .select()
      .from(taxRegimeConfig)
      .where(eq(taxRegimeConfig.fy, fy))
      .orderBy(asc(taxRegimeConfig.regime));
    const slabs = await db
      .select()
      .from(taxSlabs)
      .where(eq(taxSlabs.fy, fy))
      .orderBy(asc(taxSlabs.regime), asc(taxSlabs.slabOrder));

    // Every FY that has rate data anywhere — drives the editor's dropdown
    // so newly-cloned years appear without a code change.
    const availableFys = await listAvailableFys();

    const d = DEFAULT_TAX_RULES;
    // Always hand the editor a populated rules object: the real row if it
    // exists, otherwise the historical code constants (rulesSeeded=false so
    // the UI can show "using defaults — save to persist for this FY").
    const rules = rulesRow
      ? {
          eightyCCapPaisa: rulesRow.eightyCCapPaisa,
          eightyCcd1bCapPaisa: rulesRow.eightyCcd1bCapPaisa,
          eightyDBaseCapPaisa: rulesRow.eightyDBaseCapPaisa,
          eightyDSeniorCapPaisa: rulesRow.eightyDSeniorCapPaisa,
          sec24bSelfOccupiedCapPaisa: rulesRow.sec24bSelfOccupiedCapPaisa,
          sec24bPre1999CapPaisa: rulesRow.sec24bPre1999CapPaisa,
          sec80eeaCapPaisa: rulesRow.sec80eeaCapPaisa,
          surchargeOldBrackets: rulesRow.surchargeOldBrackets ?? d.surchargeOldBrackets,
          surchargeNewBrackets: rulesRow.surchargeNewBrackets ?? d.surchargeNewBrackets,
          capitalGainsRules: rulesRow.capitalGainsRules ?? d.capitalGains,
          presumptiveRules: rulesRow.presumptiveRules ?? d.presumptive,
        }
      : {
          eightyCCapPaisa: d.eightyCCapPaisa,
          eightyCcd1bCapPaisa: d.eightyCcd1bCapPaisa,
          eightyDBaseCapPaisa: d.eightyDBaseCapPaisa,
          eightyDSeniorCapPaisa: d.eightyDSeniorCapPaisa,
          sec24bSelfOccupiedCapPaisa: d.sec24bSelfOccupiedCapPaisa,
          sec24bPre1999CapPaisa: d.sec24bPre1999CapPaisa,
          sec80eeaCapPaisa: d.sec80eeaCapPaisa,
          surchargeOldBrackets: d.surchargeOldBrackets,
          surchargeNewBrackets: d.surchargeNewBrackets,
          capitalGainsRules: d.capitalGains,
          presumptiveRules: d.presumptive,
        };

    return NextResponse.json({
      fy,
      rules,
      rulesSeeded: Boolean(rulesRow),
      regimeConfig,
      slabs,
      availableFys,
    });
  } catch (err) {
    console.error('[tax-rules GET]', err);
    return NextResponse.json({ error: 'Failed to fetch tax rules' }, { status: 500 });
  }
}

/** Distinct, sorted FYs that have slab / config / rules data. */
async function listAvailableFys(): Promise<string[]> {
  const [s, c, r] = await Promise.all([
    db.selectDistinct({ fy: taxSlabs.fy }).from(taxSlabs),
    db.selectDistinct({ fy: taxRegimeConfig.fy }).from(taxRegimeConfig),
    db.selectDistinct({ fy: taxRules.fy }).from(taxRules),
  ]);
  return [...new Set([...s, ...c, ...r].map((x) => x.fy))].sort();
}

// ─────────────────────────────────────────────────────────────────────────
// POST  body: { cloneFromFy, toFy } → seed a NEW FY by copying an existing
// year's slabs + regime config + rules as an editable starting template.
// Refuses if toFy already has slab data (use PATCH to edit instead).
// ─────────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  let body: { cloneFromFy?: string; toFy?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { cloneFromFy, toFy } = body;
  if (!cloneFromFy || !FY_RE.test(cloneFromFy) || !toFy || !FY_RE.test(toFy)) {
    return NextResponse.json({ error: 'cloneFromFy and toFy required (format YYYY-YY)' }, { status: 400 });
  }
  if (cloneFromFy === toFy) {
    return NextResponse.json({ error: 'cloneFromFy and toFy must differ' }, { status: 400 });
  }

  try {
    const existing = await db.select({ id: taxSlabs.id }).from(taxSlabs).where(eq(taxSlabs.fy, toFy)).limit(1);
    if (existing.length) {
      return NextResponse.json({ error: `FY ${toFy} already exists — edit it instead` }, { status: 409 });
    }

    const [srcSlabs, srcConfig] = await Promise.all([
      db.select().from(taxSlabs).where(eq(taxSlabs.fy, cloneFromFy)),
      db.select().from(taxRegimeConfig).where(eq(taxRegimeConfig.fy, cloneFromFy)),
    ]);
    if (srcSlabs.length === 0 || srcConfig.length === 0) {
      return NextResponse.json({ error: `source FY ${cloneFromFy} has no slab/config data to clone` }, { status: 400 });
    }
    const [srcRules] = await db.select().from(taxRules).where(eq(taxRules.fy, cloneFromFy)).limit(1);

    await db.transaction(async (tx) => {
      await tx.insert(taxSlabs).values(
        srcSlabs.map((s) => ({
          fy: toFy,
          regime: s.regime,
          slabOrder: s.slabOrder,
          lowerPaisa: s.lowerPaisa,
          upperPaisa: s.upperPaisa,
          ratePct: s.ratePct,
        })),
      );
      await tx.insert(taxRegimeConfig).values(
        srcConfig.map((c) => ({
          fy: toFy,
          regime: c.regime,
          standardDeductionPaisa: c.standardDeductionPaisa,
          rebate87aThresholdPaisa: c.rebate87aThresholdPaisa,
          rebate87aMaxPaisa: c.rebate87aMaxPaisa,
          cessPct: c.cessPct,
        })),
      );
      // Rules: clone the row if the source had one, else seed with the
      // column defaults + JSON fallback so the new FY is fully populated.
      const d = DEFAULT_TAX_RULES;
      await tx.insert(taxRules).values({
        fy: toFy,
        eightyCCapPaisa: srcRules?.eightyCCapPaisa ?? d.eightyCCapPaisa,
        eightyCcd1bCapPaisa: srcRules?.eightyCcd1bCapPaisa ?? d.eightyCcd1bCapPaisa,
        eightyDBaseCapPaisa: srcRules?.eightyDBaseCapPaisa ?? d.eightyDBaseCapPaisa,
        eightyDSeniorCapPaisa: srcRules?.eightyDSeniorCapPaisa ?? d.eightyDSeniorCapPaisa,
        sec24bSelfOccupiedCapPaisa: srcRules?.sec24bSelfOccupiedCapPaisa ?? d.sec24bSelfOccupiedCapPaisa,
        sec24bPre1999CapPaisa: srcRules?.sec24bPre1999CapPaisa ?? d.sec24bPre1999CapPaisa,
        sec80eeaCapPaisa: srcRules?.sec80eeaCapPaisa ?? d.sec80eeaCapPaisa,
        surchargeOldBrackets: srcRules?.surchargeOldBrackets ?? d.surchargeOldBrackets,
        surchargeNewBrackets: srcRules?.surchargeNewBrackets ?? d.surchargeNewBrackets,
        capitalGainsRules: srcRules?.capitalGainsRules ?? d.capitalGains,
        presumptiveRules: srcRules?.presumptiveRules ?? d.presumptive,
      });
    });

    return NextResponse.json({ fy: toFy, clonedFrom: cloneFromFy, availableFys: await listAvailableFys() });
  } catch (err) {
    console.error('[tax-rules POST]', err);
    return NextResponse.json({ error: 'Failed to clone FY' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// PATCH ?fy=YYYY-YY  body: { rules?, regimeConfig?, slabs? }
//   • rules        → UPSERT the tax_rules row for the FY
//   • regimeConfig → upsert each {regime,...} config row
//   • slabs        → replace the FY's slab rows (delete + insert) atomically
// ─────────────────────────────────────────────────────────────────────────
export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const fy = request.nextUrl.searchParams.get('fy');
  if (!fy || !FY_RE.test(fy)) {
    return NextResponse.json({ error: 'fy query param required (format YYYY-YY)' }, { status: 400 });
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { rules, regimeConfig, slabs } = body;
  if (!rules && !regimeConfig && !slabs) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }

  // Validate slab/regime/surcharge shapes up front so we never half-write.
  if (regimeConfig && !Array.isArray(regimeConfig)) {
    return NextResponse.json({ error: 'regimeConfig must be an array' }, { status: 400 });
  }
  if (slabs) {
    if (!Array.isArray(slabs)) {
      return NextResponse.json({ error: 'slabs must be an array' }, { status: 400 });
    }
    for (const [i, s] of slabs.entries()) {
      if (
        (s.regime !== 'OLD' && s.regime !== 'NEW') ||
        !Number.isFinite(s.slabOrder) ||
        !Number.isFinite(s.lowerPaisa) ||
        !Number.isFinite(s.ratePct) ||
        (s.upperPaisa !== null && !Number.isFinite(s.upperPaisa))
      ) {
        return NextResponse.json({ error: `slabs[${i}] is malformed` }, { status: 400 });
      }
    }
  }

  try {
    await db.transaction(async (tx) => {
      // ── tax_rules — UPSERT on the unique fy index ──
      if (rules) {
        const ruleValues = {
          eightyCCapPaisa: rules.eightyCCapPaisa,
          eightyCcd1bCapPaisa: rules.eightyCcd1bCapPaisa,
          eightyDBaseCapPaisa: rules.eightyDBaseCapPaisa,
          eightyDSeniorCapPaisa: rules.eightyDSeniorCapPaisa,
          sec24bSelfOccupiedCapPaisa: rules.sec24bSelfOccupiedCapPaisa,
          sec24bPre1999CapPaisa: rules.sec24bPre1999CapPaisa,
          sec80eeaCapPaisa: rules.sec80eeaCapPaisa,
          surchargeOldBrackets: rules.surchargeOldBrackets,
          surchargeNewBrackets: rules.surchargeNewBrackets,
          capitalGainsRules: rules.capitalGainsRules,
          presumptiveRules: rules.presumptiveRules,
        };
        // Drop undefined keys so a partial body only touches provided fields.
        const cleaned = Object.fromEntries(
          Object.entries(ruleValues).filter(([, v]) => v !== undefined),
        );
        await tx
          .insert(taxRules)
          .values({ fy, ...cleaned })
          .onConflictDoUpdate({
            target: taxRules.fy,
            set: { ...cleaned, updatedAt: new Date() },
          });
      }

      // ── tax_regime_config — upsert each regime row ──
      if (regimeConfig) {
        for (const rc of regimeConfig) {
          if (rc.regime !== 'OLD' && rc.regime !== 'NEW') {
            throw new Error(`invalid regime "${rc.regime}"`);
          }
          await tx
            .insert(taxRegimeConfig)
            .values({
              fy,
              regime: rc.regime,
              standardDeductionPaisa: rc.standardDeductionPaisa,
              rebate87aThresholdPaisa: rc.rebate87aThresholdPaisa,
              rebate87aMaxPaisa: rc.rebate87aMaxPaisa,
              cessPct: rc.cessPct,
            })
            .onConflictDoUpdate({
              target: [taxRegimeConfig.fy, taxRegimeConfig.regime],
              set: {
                standardDeductionPaisa: rc.standardDeductionPaisa,
                rebate87aThresholdPaisa: rc.rebate87aThresholdPaisa,
                rebate87aMaxPaisa: rc.rebate87aMaxPaisa,
                cessPct: rc.cessPct,
              },
            });
        }
      }

      // ── tax_slabs — replace the FY's bands wholesale (delete + insert) ──
      // The slab set is a flat table with a (fy,regime,slabOrder) unique
      // index; the cleanest "edit" is to wipe this FY's rows and re-insert
      // the form's current bands so removed/reordered rows don't linger.
      if (slabs) {
        await tx.delete(taxSlabs).where(eq(taxSlabs.fy, fy));
        if (slabs.length > 0) {
          await tx.insert(taxSlabs).values(
            slabs.map((s) => ({
              fy,
              regime: s.regime,
              slabOrder: s.slabOrder,
              lowerPaisa: s.lowerPaisa,
              upperPaisa: s.upperPaisa,
              ratePct: s.ratePct,
            })),
          );
        }
      }
    });
  } catch (err) {
    console.error('[tax-rules PATCH]', err);
    const message = err instanceof Error ? err.message : 'Failed to update tax rules';
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // Re-read so the client gets the canonical persisted state.
  const [rulesRow] = await db.select().from(taxRules).where(eq(taxRules.fy, fy)).limit(1);
  const newRegimeConfig = await db
    .select()
    .from(taxRegimeConfig)
    .where(eq(taxRegimeConfig.fy, fy))
    .orderBy(asc(taxRegimeConfig.regime));
  const newSlabs = await db
    .select()
    .from(taxSlabs)
    .where(eq(taxSlabs.fy, fy))
    .orderBy(asc(taxSlabs.regime), asc(taxSlabs.slabOrder));

  return NextResponse.json({
    fy,
    rules: rulesRow ?? null,
    rulesSeeded: Boolean(rulesRow),
    regimeConfig: newRegimeConfig,
    slabs: newSlabs,
  });
}
