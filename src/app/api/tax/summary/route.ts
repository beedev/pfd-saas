import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import {
  db,
  taxDeductions,
  taxDocuments,
  mutualFunds,
  epfAccounts,
  smallSavingsAccounts,
  insurancePolicies,
  liabilities,
  npsAccounts,
  goldHoldings,
  taxSectionPreferences,
} from '@/db';
import { and } from 'drizzle-orm';
import {
  SECTION_CAPS,
  TaxSection,
  getCurrentFinancialYear,
} from '@/lib/finance/tax-constants';
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

// Annualise premium given frequency
function annualisePremium(amount: number, freq: string | null): number {
  switch ((freq || 'YEARLY').toUpperCase()) {
    case 'MONTHLY':
      return amount * 12;
    case 'QUARTERLY':
      return amount * 4;
    case 'HALF_YEARLY':
      return amount * 2;
    case 'SINGLE':
      return 0;
    case 'YEARLY':
    default:
      return amount;
  }
}

function estimateHomeLoanInterestAnnual(row: {
  currentBalance: number;
  interestRate: number;
  monthlyEmi: number;
}): number {
  // Approx: interest for 12 months = balance * rate/100, EMI limits it
  const annualInterest = Math.round((row.currentBalance * row.interestRate) / 100);
  const annualEmi = row.monthlyEmi * 12;
  return Math.min(annualInterest, annualEmi);
}

function estimateHomeLoanPrincipalAnnual(row: {
  currentBalance: number;
  interestRate: number;
  monthlyEmi: number;
}): number {
  const annualEmi = row.monthlyEmi * 12;
  const annualInterest = estimateHomeLoanInterestAnnual(row);
  return Math.max(0, annualEmi - annualInterest);
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const fy = searchParams.get('fy') || getCurrentFinancialYear();

  try {
    const [deductions, docs, mfs, pfRows, ssRows, policies, debts, nps, gold] = await Promise.all([
      db.select().from(taxDeductions).where(and(eq(taxDeductions.financialYear, fy), eq(taxDeductions.userId, session.user.id))),
      db.select().from(taxDocuments).where(and(eq(taxDocuments.financialYear, fy), eq(taxDocuments.userId, session.user.id))),
      db.select().from(mutualFunds).where(eq(mutualFunds.userId, session.user.id)),
      db.select().from(epfAccounts).where(eq(epfAccounts.userId, session.user.id)),
      db.select().from(smallSavingsAccounts).where(eq(smallSavingsAccounts.userId, session.user.id)),
      db.select().from(insurancePolicies).where(eq(insurancePolicies.userId, session.user.id)),
      db.select().from(liabilities).where(eq(liabilities.userId, session.user.id)),
      db.select().from(npsAccounts).where(eq(npsAccounts.userId, session.user.id)),
      db.select().from(goldHoldings).where(eq(goldHoldings.userId, session.user.id)),
    ]);

    // Load section exclusion preferences for this FY
    const prefs = await db
      .select()
      .from(taxSectionPreferences)
      .where(and(eq(taxSectionPreferences.financialYear, fy), eq(taxSectionPreferences.userId, session.user.id)));
    const excludedSections = new Set(
      prefs.filter((p) => p.isExcluded).map((p) => p.section),
    );

    // Build empty buckets
    const buckets: Record<string, SectionBucket> = {};
    for (const s of Object.keys(SECTION_CAPS) as TaxSection[]) {
      const meta = SECTION_CAPS[s];
      buckets[s] = {
        section: s,
        label: meta.label,
        description: meta.description,
        capPaisa: meta.capPaisa,
        totalPaisa: 0,
        usedPercent: 0,
        sources: [],
        manualEntries: 0,
        docCoverage: 0,
        isExcluded: excludedSections.has(s),
      };
    }

    // ---- Auto-pull linked assets ----

    // 80C: ELSS equity funds (heuristic: schemeName contains ELSS or "Tax Saver")
    const elssTotal = mfs
      .filter((m) => {
        const name = (m.schemeName || '').toLowerCase();
        return (
          m.fundType === 'EQUITY' &&
          (name.includes('elss') || name.includes('tax saver') || name.includes('taxsaver'))
        );
      })
      .reduce((s, m) => s + (m.totalInvestment || 0), 0);
    if (elssTotal > 0) {
      buckets['80C'].sources.push({ source: 'ELSS mutual funds (invested)', amountPaisa: elssTotal });
    }

    // 80C: EPF employee balance (indicator — not precise YTD).
    // Sprint 3 Phase 5 split the table: epf_accounts now holds EPF only;
    // PPF/VPF moved to small_savings_accounts and are pulled separately.
    const pfContribution = pfRows.reduce((sum, p) => {
      if (p.accountType === 'EPF') return sum + (p.employeeBalance || 0);
      return sum;
    }, 0);
    if (pfContribution > 0) {
      buckets['80C'].sources.push({ source: 'EPF employee balance', amountPaisa: pfContribution });
    }

    // 80C: Small savings — PPF, VPF, NSC, SSY, SCSS deposits all qualify.
    // KVP does NOT qualify and is excluded. Same lifetime-balance caveat
    // applies as EPF above: we surface total_deposited_paisa as an
    // indicator, not FY-precise contribution.
    const SS_80C_SCHEMES = ['PPF', 'VPF', 'NSC', 'SSY', 'SCSS'];
    const ssContribution = ssRows
      .filter((a) => SS_80C_SCHEMES.includes(a.schemeType))
      .reduce((s, a) => s + (a.totalDepositedPaisa || 0), 0);
    if (ssContribution > 0) {
      buckets['80C'].sources.push({
        source: 'PPF/VPF/NSC/SSY/SCSS deposits',
        amountPaisa: ssContribution,
      });
    }

    // 80C: Life insurance premiums (TERM_LIFE, WHOLE_LIFE, ENDOWMENT, ULIP)
    const LIFE_TYPES = ['TERM_LIFE', 'WHOLE_LIFE', 'ENDOWMENT', 'ULIP'];
    const lifePremiums = policies
      .filter((p) => LIFE_TYPES.includes(p.policyType))
      .reduce((s, p) => s + annualisePremium(p.premiumAmount, p.premiumFrequency), 0);
    if (lifePremiums > 0) {
      buckets['80C'].sources.push({ source: 'Life insurance premiums (annualised)', amountPaisa: lifePremiums });
    }

    // 80C: Sovereign Gold Bonds (investment amount)
    const sgbInvestment = gold
      .filter((g) => g.type === 'GOLD_BOND')
      .reduce((s, g) => s + (g.totalInvestment ?? g.purchasePrice ?? 0), 0);
    if (sgbInvestment > 0) {
      buckets['80C'].sources.push({ source: 'Sovereign Gold Bonds', amountPaisa: sgbInvestment });
    }

    // 80C: Home loan principal (from liabilities type=HOME_LOAN)
    const homeLoans = debts.filter((d) => d.type === 'HOME_LOAN' && d.status !== 'CLOSED');
    const homePrincipalAnnual = homeLoans.reduce(
      (s, h) => s + estimateHomeLoanPrincipalAnnual(h),
      0
    );
    if (homePrincipalAnnual > 0) {
      buckets['80C'].sources.push({
        source: 'Home loan principal (est. annual)',
        amountPaisa: homePrincipalAnnual,
      });
    }

    // 24(b): Home loan interest
    const homeInterestAnnual = homeLoans.reduce(
      (s, h) => s + estimateHomeLoanInterestAnnual(h),
      0
    );
    if (homeInterestAnnual > 0) {
      buckets['24B'].sources.push({
        source: 'Home loan interest (est. annual)',
        amountPaisa: homeInterestAnnual,
      });
    }

    // 80CCD(1B): NPS Tier-I additional
    const nps1b = nps
      .filter((n) => n.tier === 'TIER1')
      .reduce((s, n) => s + (n.totalContributed || 0), 0);
    if (nps1b > 0) {
      buckets['80CCD_1B'].sources.push({
        source: 'NPS Tier-I contributed',
        amountPaisa: Math.min(nps1b, SECTION_CAPS['80CCD_1B'].capPaisa ?? nps1b),
      });
    }

    // 80D: Health insurance premiums (HEALTH, CRITICAL_ILLNESS)
    const HEALTH_TYPES = ['HEALTH', 'CRITICAL_ILLNESS'];
    const healthPremiums = policies
      .filter((p) => HEALTH_TYPES.includes(p.policyType))
      .reduce((s, p) => s + annualisePremium(p.premiumAmount, p.premiumFrequency), 0);
    if (healthPremiums > 0) {
      buckets['80D'].sources.push({
        source: 'Health insurance premiums (annualised)',
        amountPaisa: healthPremiums,
      });
    }

    // ---- Manual entries from taxDeductions ----
    for (const d of deductions) {
      // Map legacy SECTION_80* to 80*
      let sec = d.section || '';
      if (sec.startsWith('SECTION_')) sec = sec.replace('SECTION_', '');
      if (sec === '80CCD') sec = '80CCD_1B';
      if (!(sec in buckets)) continue;

      const amt = d.amountPaisa || d.deductibleAmount || 0;
      buckets[sec].sources.push({
        source: d.description || 'Manual entry',
        amountPaisa: amt,
      });
      buckets[sec].manualEntries += 1;
    }

    // ---- Totals + caps + doc coverage ----
    let totalDeductionsPaisa = 0;
    let overallDocTracked = 0;
    let overallDocWithFile = 0;

    for (const s of Object.keys(buckets) as TaxSection[]) {
      const bucket = buckets[s];
      const rawTotal = bucket.sources.reduce((sum, src) => sum + src.amountPaisa, 0);
      const capped = bucket.capPaisa != null ? Math.min(rawTotal, bucket.capPaisa) : rawTotal;
      bucket.totalPaisa = capped;
      bucket.usedPercent = bucket.capPaisa
        ? Math.min(100, (rawTotal / bucket.capPaisa) * 100)
        : 0;
      // Only count toward total if section is not excluded
      if (!bucket.isExcluded) {
        totalDeductionsPaisa += capped;
      }

      // Doc coverage: manual entries with a linked taxDocument
      const mappedIds = deductions
        .filter((d) => {
          let ds = d.section || '';
          if (ds.startsWith('SECTION_')) ds = ds.replace('SECTION_', '');
          if (ds === '80CCD') ds = '80CCD_1B';
          return ds === s;
        })
        .map((d) => d.id);
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
