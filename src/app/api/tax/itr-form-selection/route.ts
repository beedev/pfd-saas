/**
 * ITR form selection persistence — Sprint 4 Phase 4.
 *
 * GET  /api/tax/itr-form-selection?fy=2026-27
 *   → returns existing wizard answers + recommended form, or null if
 *     the user hasn't filled out the wizard for this FY yet. The page
 *     also calls /detect (below) to surface auto-detected answers as
 *     prefilled defaults.
 *
 * POST /api/tax/itr-form-selection
 *   body: { fy, hasSalary, numHouseProperties, hasCapitalGains,
 *           hasBusinessIncome, hasPresumptive, hasForeignIncome,
 *           hasOtherSources, totalIncomePaisa }
 *   → applies the rule engine in src/lib/finance/itr-selector.ts and
 *     UPSERTS the selection. Returns { form, reasoning }.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, itrFormSelection, type ItrWizardAnswers } from '@/db';
import { auth } from '@/auth';
import { selectItrForm } from '@/lib/finance/itr-selector';
import { getTaxRules } from '@/lib/finance/tax-rules';

function findPgError(err: unknown): { code?: string; detail?: string } {
  let cur: unknown = err;
  for (let depth = 0; cur && depth < 5; depth++) {
    if (typeof cur === 'object' && cur !== null) {
      const c = cur as { code?: unknown; detail?: unknown; cause?: unknown };
      if (typeof c.code === 'string') {
        return {
          code: c.code,
          detail: typeof c.detail === 'string' ? c.detail : '',
        };
      }
      cur = c.cause;
    } else {
      break;
    }
  }
  return {};
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  try {
    const fy = new URL(request.url).searchParams.get('fy');
    if (!fy) return NextResponse.json({ error: 'fy required' }, { status: 400 });

    const [row] = await db
      .select()
      .from(itrFormSelection)
      .where(
        and(eq(itrFormSelection.userId, session.user.id), eq(itrFormSelection.fy, fy)),
      )
      .limit(1);

    return NextResponse.json({ selection: row ?? null });
  } catch (err) {
    console.error('[tax/itr-form-selection GET]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      fy,
      hasSalary,
      numHouseProperties,
      hasCapitalGains,
      hasBusinessIncome,
      hasPresumptive,
      hasForeignIncome,
      hasOtherSources,
      totalIncomePaisa,
      hasStcg,
      ltcg112aPaisa,
      hasOtherCapitalGains,
      isDirector,
      hasUnlistedShares,
      hasCarryForwardLosses,
    } = body ?? {};

    if (!fy || typeof fy !== 'string' || !/^\d{4}-\d{2}$/.test(fy)) {
      return NextResponse.json({ error: 'fy (YYYY-YY) required' }, { status: 400 });
    }

    const answers: ItrWizardAnswers = {
      hasSalary: !!hasSalary,
      numHouseProperties: Number(numHouseProperties) || 0,
      hasCapitalGains: !!hasCapitalGains,
      hasBusinessIncome: !!hasBusinessIncome,
      hasPresumptive: !!hasPresumptive,
      hasForeignIncome: !!hasForeignIncome,
      hasOtherSources: !!hasOtherSources,
      totalIncomePaisa: Math.max(0, Number(totalIncomePaisa) || 0),
      // Finer CG + disqualifier fields (optional; present from the updated wizard).
      hasStcg: !!hasStcg,
      ltcg112aPaisa: Math.max(0, Number(ltcg112aPaisa) || 0),
      hasOtherCapitalGains: !!hasOtherCapitalGains,
      isDirector: !!isDirector,
      hasUnlistedShares: !!hasUnlistedShares,
      hasCarryForwardLosses: !!hasCarryForwardLosses,
    };

    // Sahaj/Sugam thresholds (₹1.25L 112A, ₹50L cap) from the configurable
    // tax_rules so the selector tracks budget changes.
    const rules = await getTaxRules(fy);
    const { form, reasoning } = selectItrForm(answers, {
      ltcg112aExemptionPaisa: rules.capitalGains.sec112aExemptionPostPaisa,
    });

    const userId = session.user.id;

    // UPSERT — on conflict over (user_id, fy), overwrite. The unique
    // index from the schema is the source of truth.
    const [row] = await db
      .insert(itrFormSelection)
      .values({
        userId,
        fy,
        selectedForm: form,
        wizardAnswers: answers,
        reasoning,
      })
      .onConflictDoUpdate({
        target: [itrFormSelection.userId, itrFormSelection.fy],
        set: {
          selectedForm: form,
          wizardAnswers: answers,
          reasoning,
          updatedAt: new Date(),
        },
      })
      .returning();

    return NextResponse.json({ form, reasoning, selection: row });
  } catch (err) {
    const { code } = findPgError(err);
    if (code === '23505') {
      return NextResponse.json({ error: 'Selection already exists' }, { status: 409 });
    }
    console.error('[tax/itr-form-selection POST]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
