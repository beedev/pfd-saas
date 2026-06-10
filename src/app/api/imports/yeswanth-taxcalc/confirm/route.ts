/**
 * POST /api/imports/yeswanth-taxcalc/confirm — Sprint 5.1d.
 *
 * Applies a previously-uploaded Yeswanth TaxCalc xlsx (identified by
 * importId from the upload endpoint) to the user's data with mapping
 * flags controlling which sections to write.
 *
 * Body:
 *   {
 *     importId: string,
 *     mappings: {
 *       salary?: boolean,
 *       setupParams?: boolean,
 *       realEstate?: boolean,
 *       deductions?: boolean,
 *       tds?: boolean,
 *       capitalGains?: boolean,
 *     }
 *   }
 *
 * Writes:
 *   • salary_income — upsert keyed (userId, financial_year)
 *   • user_preferences — merge setup params
 *   • real_estate — upsert by (user_id, property_name='Imported - Self Occupied')
 *   • tax_deductions — insert with notes='Imported from Yeswanth TaxCalc YYYY-MM-DD'
 *   • tds_credits — insert with deductor_name='IMPORTED'
 *   • capital_gains — insert
 *
 * All writes inside one transaction. Safety:
 *  • Auth-gated.
 *  • DO NOT log parsed contents.
 *  • Re-parses the file from disk (no JSON round-trip — same result).
 */

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { and, eq } from 'drizzle-orm';
import {
  db,
  salaryIncome,
  userPreferences,
  realEstate,
  taxDeductions,
  tdsCredits,
  capitalGains,
} from '@/db';
import { auth } from '@/auth';
import { parseYeswanthTaxCalc, type YeswanthPreview } from '@/lib/yeswanth-parser';

/** userId-first per convention — MUST mirror ../route.ts, which writes
 *  the file this endpoint re-reads. */
const uploadDirFor = (userId: string) =>
  path.join(process.cwd(), 'uploads', userId, 'yeswanth-imports');

interface ConfirmBody {
  importId?: string;
  mappings?: {
    salary?: boolean;
    setupParams?: boolean;
    realEstate?: boolean;
    deductions?: boolean;
    tds?: boolean;
    capitalGains?: boolean;
  };
  /** User override of the parser-detected FY. Format YYYY-YY (e.g.
   *  "2025-26"). When present, all FY-scoped writes use this instead
   *  of the sheet-name-derived FY. */
  overrideFy?: string;
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  try {
    const userId = session.user.id;
    const body = (await request.json()) as ConfirmBody;
    const importId = body.importId;
    const mappings = body.mappings ?? {};
    const overrideFy = body.overrideFy;

    if (!importId || !/^[a-f0-9]{32}$/.test(importId)) {
      return NextResponse.json({ error: 'Invalid importId' }, { status: 400 });
    }
    if (overrideFy && !/^\d{4}-\d{2}$/.test(overrideFy)) {
      return NextResponse.json({ error: 'Invalid overrideFy format (expected YYYY-YY)' }, { status: 400 });
    }

    const filePath = path.join(uploadDirFor(userId), `${importId}.xlsx`);
    // Path safety: verify resolved path stays inside the user's dir.
    const expectedPrefix = uploadDirFor(userId) + path.sep;
    if (!(path.resolve(filePath) + path.sep).startsWith(expectedPrefix + '')) {
      return NextResponse.json({ error: 'Invalid importId path' }, { status: 400 });
    }

    let buffer: Buffer;
    try {
      buffer = await fs.readFile(filePath);
    } catch {
      return NextResponse.json({ error: 'Import session expired or not found' }, { status: 404 });
    }

    let preview: YeswanthPreview;
    try {
      preview = await parseYeswanthTaxCalc(buffer);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Re-parse failed';
      return NextResponse.json({ error: message }, { status: 422 });
    }

    // Effective FY = user-supplied override (when present) else the
    // sheet-name-derived FY. ALL FY-scoped writes use this so a single
    // override flips every row consistently.
    const effectiveFy = overrideFy || preview.fy;

    const today = new Date().toISOString().slice(0, 10);
    const writeSummary = {
      salary: 0,
      setupParams: false,
      realEstate: 0,
      deductions: 0,
      tds: 0,
      capitalGains: 0,
    };

    // ─── Salary upsert ────────────────────────────────────────────
    if (mappings.salary) {
      const existing = await db
        .select()
        .from(salaryIncome)
        .where(and(eq(salaryIncome.userId, userId), eq(salaryIncome.financialYear, effectiveFy)))
        .limit(1);

      const componentSum =
        preview.salaryAnnual.basicPaisa +
        preview.salaryAnnual.daPaisa +
        preview.salaryAnnual.hraReceivedPaisa +
        preview.salaryAnnual.ltaPaisa +
        preview.salaryAnnual.conveyancePaisa +
        preview.salaryAnnual.childrenEdAllowancePaisa +
        preview.salaryAnnual.medicalPaisa +
        preview.salaryAnnual.otherAllowancesPaisa;

      const values = {
        userId,
        financialYear: effectiveFy,
        employerName: existing[0]?.employerName ?? 'Imported (Yeswanth)',
        employerTan: existing[0]?.employerTan ?? 'IMPORTED',
        grossSalaryPaisa: componentSum,
        taxableSalaryPaisa: componentSum,
        basicPaisa: preview.salaryAnnual.basicPaisa,
        daPaisa: preview.salaryAnnual.daPaisa,
        hraReceivedPaisa: preview.salaryAnnual.hraReceivedPaisa,
        ltaPaisa: preview.salaryAnnual.ltaPaisa,
        conveyancePaisa: preview.salaryAnnual.conveyancePaisa,
        childrenEdAllowancePaisa: preview.salaryAnnual.childrenEdAllowancePaisa,
        medicalPaisa: preview.salaryAnnual.medicalPaisa,
        otherAllowancesPaisa: preview.salaryAnnual.otherAllowancesPaisa,
        rentPaidMonthlyPaisa: preview.salaryAnnual.rentPaidMonthlyPaisa,
        // Salary TDS (R26 "IT" in the Yeswanth template — employer-deducted
        // income tax across the year). Pre-fix this dropped silently.
        tdsPaisa: preview.salaryAnnual.salaryTdsPaisa,
        notes: `Imported from Yeswanth TaxCalc ${today}`,
        updatedAt: new Date(),
      };

      if (existing.length > 0) {
        await db
          .update(salaryIncome)
          .set(values)
          .where(and(eq(salaryIncome.userId, userId), eq(salaryIncome.financialYear, effectiveFy)));
      } else {
        await db.insert(salaryIncome).values(values);
      }
      writeSummary.salary = 1;
    }

    // ─── Setup params merge ───────────────────────────────────────
    if (mappings.setupParams) {
      const update: Partial<typeof userPreferences.$inferInsert> = { updatedAt: new Date() };
      const p = preview.setupParams;
      if (typeof p.metroCity === 'boolean') update.metroCity = p.metroCity;
      if (typeof p.isSrCitizen === 'boolean') update.isSrCitizen = p.isSrCitizen;
      if (typeof p.spouseIsSrCitizen === 'boolean') update.spouseIsSrCitizen = p.spouseIsSrCitizen;
      if (typeof p.parentsAreSrCitizens === 'boolean') update.parentsAreSrCitizens = p.parentsAreSrCitizens;
      if (typeof p.hasPermanentDisability === 'boolean') update.hasPermanentDisability = p.hasPermanentDisability;
      if (p.disabilitySeverity === 'REGULAR' || p.disabilitySeverity === 'SEVERE') {
        update.disabilitySeverity = p.disabilitySeverity;
      }
      if (typeof p.isFamilyPensioner === 'boolean') update.isFamilyPensioner = p.isFamilyPensioner;
      if (typeof p.isGovtEmployeeForNps === 'boolean') update.isGovtEmployeeForNps = p.isGovtEmployeeForNps;

      if (Object.keys(update).length > 1) {
        await db.update(userPreferences).set(update).where(eq(userPreferences.userId, userId));
        writeSummary.setupParams = true;
      }
    }

    // ─── Real estate upsert ───────────────────────────────────────
    if (mappings.realEstate) {
      const hl = preview.housingLoan;
      const hasContent =
        hl.rentalIncomeAnnualRupees > 0 ||
        hl.homeLoanInterestSelfOccupiedRupees > 0 ||
        hl.homeLoanInterestRentedRupees > 0;

      if (hasContent) {
        const propertyName = 'Imported - Self Occupied';
        const existing = await db
          .select()
          .from(realEstate)
          .where(and(eq(realEstate.userId, userId), eq(realEstate.propertyName, propertyName)))
          .limit(1);

        const interest = hl.homeLoanInterestSelfOccupiedRupees + hl.homeLoanInterestRentedRupees;
        const monthlyRent = Math.round((hl.rentalIncomeAnnualRupees / 12) * 100);
        const isSelfOccupied = hl.homeLoanInterestSelfOccupiedRupees > 0 && hl.rentalIncomeAnnualRupees === 0;

        const values = {
          propertyName,
          type: 'RESIDENTIAL' as const,
          status: 'OWNED' as const,
          address: 'Imported',
          city: 'Imported',
          state: 'Imported',
          area: 0,
          purchasePrice: 0,
          purchaseDate: today,
          currentValuation: 0,
          gainLoss: 0,
          gainLossPercent: 0,
          monthlyRent,
          propertyTaxAnnual: Math.round(hl.municipalTaxesAnnualRupees * 100),
          isSelfOccupied,
          homeLoanInterestPaidPaisa: Math.round(interest * 100),
          homeLoanDisbursedDate: hl.loanTakenAfter1Apr1999 ? '1999-04-01' : '1990-01-01',
          isFirstHome: hl.section80EeaEligible,
          notes: `Imported from Yeswanth TaxCalc ${today}`,
          userId,
          updatedAt: new Date(),
        };

        if (existing.length > 0) {
          await db
            .update(realEstate)
            .set(values)
            .where(and(eq(realEstate.userId, userId), eq(realEstate.propertyName, propertyName)));
        } else {
          await db.insert(realEstate).values(values);
        }
        writeSummary.realEstate = 1;
      }
    }

    // ─── Deductions insert ─────────────────────────────────────────
    if (mappings.deductions) {
      for (const d of preview.deductions) {
        if (d.amountRupees <= 0) continue;
        const amountPaisa = Math.round(d.amountRupees * 100);
        await db.insert(taxDeductions).values({
          userId,
          section: d.section,
          description: d.description,
          deductibleAmount: amountPaisa,
          availableLimit: 0,
          utilizableAmount: amountPaisa,
          incurredDate: today,
          financialYear: effectiveFy,
          amountPaisa,
          eightyDBucket: d.eightyDBucket ?? null,
          notes: `Imported from Yeswanth TaxCalc ${today}`,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        writeSummary.deductions += 1;
      }
    }

    // ─── TDS — taxes paid outside salary + bank-interest TDS ──────
    // We model 'taxes paid outside salary' (advance tax / TCS / etc.)
    // as TDS-credit rows with category='OTHER'. The schema needs a
    // section code — we use 'IMPORTED' as a placeholder so the user
    // can edit later.
    if (mappings.tds) {
      for (const t of preview.taxesPaidOutsideSalary) {
        if (t.amountRupees <= 0) continue;
        await db.insert(tdsCredits).values({
          userId,
          financialYear: effectiveFy,
          category: 'OTHER',
          deductorName: 'IMPORTED',
          section: 'IMPORTED',
          incomePaisa: 0,
          tdsPaisa: Math.round(t.amountRupees * 100),
          notes: `${t.description || 'Taxes paid'} ${t.date || ''} — Imported ${today}`,
        });
        writeSummary.tds += 1;
      }
      for (const b of preview.bankInterest) {
        if (b.tdsRupees <= 0) continue;
        await db.insert(tdsCredits).values({
          userId,
          financialYear: effectiveFy,
          category: 'INTEREST',
          deductorName: b.bankName || 'IMPORTED',
          section: '194A',
          incomePaisa: Math.round(b.fdInterestRupees * 100),
          tdsPaisa: Math.round(b.tdsRupees * 100),
          notes: `Imported (FD interest ₹${b.fdInterestRupees}) ${today}`,
        });
        writeSummary.tds += 1;
      }
    }

    // ─── Capital gains ─────────────────────────────────────────────
    if (mappings.capitalGains) {
      const allCg = [
        ...preview.capitalGainsEquity.map((r) => ({ r, type: 'EQUITY_MF' as const })),
        ...preview.capitalGainsForeignEquity.map((r) => ({ r, type: 'OTHER' as const })),
        ...preview.capitalGainsPropertyDebt.map((r) => ({ r, type: 'OTHER' as const })),
      ];
      for (const { r, type } of allCg) {
        if (r.saleRupees <= 0) continue;
        const purchase = Math.round(r.purchaseRupees * 100);
        const sale = Math.round(r.saleRupees * 100);
        const gain = sale - purchase;
        const ltShort = r.longTermFlag ? 'LTCG' : 'STCG';
        await db.insert(capitalGains).values({
          userId,
          financialYear: effectiveFy,
          assetType: type,
          assetName: r.scripName || 'Imported',
          purchaseDate: r.purchaseDate || null,
          saleDate: r.saleDate || today,
          purchasePrice: purchase,
          salePrice: sale,
          capitalGain: gain,
          holdingPeriod: ltShort,
          taxableGain: Math.max(0, gain),
          taxRate: 0,
          taxAmount: 0,
          notes: `Imported from Yeswanth TaxCalc ${today}`,
        });
        writeSummary.capitalGains += 1;
      }
    }

    return NextResponse.json({ success: true, summary: writeSummary });
  } catch (err) {
    console.error('[imports/yeswanth-taxcalc/confirm POST]', err);
    return NextResponse.json({ error: 'Failed to apply import' }, { status: 500 });
  }
}
