import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import {
  db,
  taxDeductions,
  taxDocuments,
  taxSectionPreferences,
} from '@/db';
import { and } from 'drizzle-orm';
import {
  SECTION_CAPS,
  TaxSection,
  getCurrentFinancialYear,
} from '@/lib/finance/tax-constants';
import { deriveDeductions } from '@/lib/finance/deduction-engine';
import { auth } from '@/auth';

interface SectionBucket {
  section: TaxSection;
  label: string;
  description: string;
  capPaisa: number | null;
  totalPaisa: number;
  usedPercent: number;
  sources: Array<{ source: string; amountPaisa: number }>;
  manualEntries: number;
  docCoverage: number; // 0-1
  isExcluded: boolean;
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const fy = searchParams.get('fy') || getCurrentFinancialYear();

  try {
    // Migrated to the shared deduction engine (Phase 1). The engine
    // derives every Chapter VI-A bucket from the user's real records —
    // same asset sources this route used to pull inline (ELSS, EPF,
    // small-savings, LIC, SGB, home-loan principal, NPS-1B, health
    // premiums), PLUS two correctness improvements over the previous
    // inline logic:
    //   • 80D now counts health_insurance_policies (dedicated table),
    //     not just HEALTH/CRITICAL_ILLNESS rows in insurance_policies,
    //     and applies the sr-citizen-aware per-bucket caps.
    //   • 80G now lands at its ELIGIBLE amount (50%/100% rate) via the
    //     category helper, instead of face value.
    //   • 24(b) + 80C home-loan now use the FY-aware amortisation
    //     aggregator (qualify flags) instead of the balance×rate
    //     estimate.
    // `deductions` + `docs` are still fetched here for the per-section
    // manualEntries count + doc-coverage stats (response-shape preserving).
    const [deductions, docs, engineResult] = await Promise.all([
      db.select().from(taxDeductions).where(and(eq(taxDeductions.financialYear, fy), eq(taxDeductions.userId, session.user.id))),
      db.select().from(taxDocuments).where(and(eq(taxDocuments.financialYear, fy), eq(taxDocuments.userId, session.user.id))),
      deriveDeductions(session.user.id, fy),
    ]);

    // Load section exclusion preferences for this FY
    const prefs = await db
      .select()
      .from(taxSectionPreferences)
      .where(and(eq(taxSectionPreferences.financialYear, fy), eq(taxSectionPreferences.userId, session.user.id)));
    const excludedSections = new Set(
      prefs.filter((p) => p.isExcluded).map((p) => p.section),
    );

    // Build buckets from the SECTION_CAPS scaffold, fed by the engine.
    const buckets: Record<string, SectionBucket> = {};
    for (const s of Object.keys(SECTION_CAPS) as TaxSection[]) {
      const meta = SECTION_CAPS[s];
      const engineBucket = engineResult.buckets[s];
      buckets[s] = {
        section: s,
        label: meta.label,
        description: meta.description,
        capPaisa: meta.capPaisa,
        // Engine already applies per-section caps → totalPaisa is post-cap.
        totalPaisa: engineBucket?.appliedPaisa ?? 0,
        usedPercent: 0,
        sources: engineBucket?.sources ?? [],
        manualEntries: 0,
        docCoverage: 0,
        isExcluded: excludedSections.has(s),
      };
    }

    // ---- Totals + usedPercent + manualEntries + doc coverage ----
    let totalDeductionsPaisa = 0;
    let overallDocTracked = 0;
    let overallDocWithFile = 0;

    for (const s of Object.keys(buckets) as TaxSection[]) {
      const bucket = buckets[s];
      const rawTotal = bucket.sources.reduce((sum, src) => sum + src.amountPaisa, 0);
      bucket.usedPercent = bucket.capPaisa
        ? Math.min(100, (rawTotal / bucket.capPaisa) * 100)
        : 0;
      // Only count toward total if section is not excluded.
      if (!bucket.isExcluded) {
        totalDeductionsPaisa += bucket.totalPaisa;
      }

      // Manual entries + doc coverage: count taxDeductions rows mapped
      // to this section (legacy SECTION_80* + 80CCD normalisation).
      const mappedIds = deductions
        .filter((d) => {
          let ds = d.section || '';
          if (ds.startsWith('SECTION_')) ds = ds.replace('SECTION_', '');
          if (ds === '80CCD') ds = '80CCD_1B';
          return ds === s;
        })
        .map((d) => d.id);
      bucket.manualEntries = mappedIds.length;
      const withDocs = mappedIds.filter((id) =>
        docs.some((doc) => doc.deductionId === id)
      ).length;
      bucket.docCoverage = mappedIds.length > 0 ? withDocs / mappedIds.length : 1;
      overallDocTracked += mappedIds.length;
      overallDocWithFile += withDocs;
    }

    const estimatedTaxSavedPaisa = Math.round(totalDeductionsPaisa * 0.3);
    const documentCoverage =
      overallDocTracked > 0 ? overallDocWithFile / overallDocTracked : 1;

    return NextResponse.json({
      financialYear: fy,
      totalDeductionsPaisa,
      estimatedTaxSavedPaisa,
      documentCoveragePercent: Math.round(documentCoverage * 100),
      buckets: Object.values(buckets),
    });
  } catch (err) {
    console.error('[tax/summary]', err);
    return NextResponse.json({ error: 'Failed to compute tax summary' }, { status: 500 });
  }
}

/** PATCH — toggle section inclusion/exclusion for a FY */
export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const body = await request.json();
    const { fy, section, exclude } = body;

    if (!fy || !section || exclude === undefined) {
      return NextResponse.json({ error: 'fy, section, and exclude required' }, { status: 400 });
    }

    const existing = await db
      .select()
      .from(taxSectionPreferences)
      .where(and(
        eq(taxSectionPreferences.financialYear, fy),
        eq(taxSectionPreferences.section, section),
        eq(taxSectionPreferences.userId, session.user.id),
      ));

    if (existing.length > 0) {
      await db
        .update(taxSectionPreferences)
        .set({ isExcluded: exclude })
        .where(and(eq(taxSectionPreferences.id, existing[0].id), eq(taxSectionPreferences.userId, session.user.id)));
    } else {
      await db.insert(taxSectionPreferences).values({
        userId: session.user.id,
        financialYear: fy,
        section,
        isExcluded: exclude,
      });
    }

    return NextResponse.json({
      success: true,
      message: `${section} ${exclude ? 'excluded' : 'included'} for FY ${fy}`,
    });
  } catch (err) {
    console.error('[tax/summary PATCH]', err);
    return NextResponse.json({ error: 'Failed to update preference' }, { status: 500 });
  }
}
