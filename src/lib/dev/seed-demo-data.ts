/**
 * Shared demo-seeder.
 *
 * Sprint 6.1.9a — Extracted from `POST /api/dev/load-demo-data` so two
 * callers can share the seed:
 *
 *   1. The /api/dev/load-demo-data route — authenticated user clicks
 *      "Explore with sample data".
 *   2. `ensureAccountExists('demo')` in src/lib/dev/account-switcher.ts
 *      — when the built-in two-account switcher provisions the Demo
 *      account on first click.
 *
 * The original route owns auth and the JSON response shape; this module
 * owns the seed payload itself. Behaviour is identical to the prior
 * version of the endpoint.
 *
 * Every row carries `notes` starting `DEMO-SEED:` so the wipe endpoint
 * (and this module's own cleanup pass) can find them. Re-running for
 * the same userId is idempotent: prior DEMO-SEED rows are deleted, then
 * fresh ones inserted, all inside one transaction.
 */

import { and, eq, inArray, like, sql } from 'drizzle-orm';
import {
  db,
  userPreferences,
  salaryIncome,
  otherSourcesIncome,
  realEstate,
  rentalHistory,
  capitalGains,
  taxDeductions,
  tdsCredits,
  holdings,
  mutualFunds,
  sips,
  goldHoldings,
  npsAccounts,
  epfAccounts,
  smallSavingsAccounts,
  fixedDeposits,
  forexDeposits,
  liabilities,
  insurancePolicies,
  healthInsurancePolicies,
  healthInsuranceCards,
  vehicles,
  vehicleInsurancePolicies,
  vehiclePuc,
  vehicleServiceLog,
  subscriptions,
  budgetCategories,
  budgetEntries,
  financialGoals,
  itrFormSelection,
} from '@/db';

// ─── helpers ─────────────────────────────────────────────────────────
/** ₹ → paisa (integer). */
const rs = (rupees: number) => Math.round(rupees * 100);
/** ₹ lakhs → paisa. */
const lakh = (n: number) => Math.round(n * 100_000 * 100);
/** ₹ crores → paisa. */
const cr = (n: number) => Math.round(n * 10_000_000 * 100);

const FY = '2025-26';
const FY_LABEL = `DEMO-SEED: ${FY} —`;
const NOTE = (bucket = '') =>
  bucket ? `${FY_LABEL} ${bucket}` : `${FY_LABEL} demo data`;

export interface SeedDemoResult {
  inserted: Record<string, number>;
  total: number;
}

/**
 * Seed (or re-seed) the BXDEva-style demo portfolio onto the given user.
 *
 * Caller must guarantee `userId` exists in the `users` table AND has a
 * `user_preferences` row (the seed UPDATEs prefs in-place, doesn't
 * INSERT). The account-switcher's `ensureAccountExists` provisions both
 * before invoking this.
 *
 * `displayName` is stamped onto policy-holder fields (NPS, EPF,
 * insurance, etc.). Default 'Demo User' matches the prior behaviour
 * when called from the unauthenticated path.
 */
export async function seedDemoDataForUser(
  userId: string,
  displayName: string = 'Demo User',
): Promise<SeedDemoResult> {
  const inserted: Record<string, number> = {};
  const tally = (table: string, n = 1) => {
    inserted[table] = (inserted[table] ?? 0) + n;
  };

  await db.transaction(async (tx) => {
    // ─── cleanup: wipe prior DEMO-SEED rows for this user ───────────
    const NOTES_TABLES = [
      salaryIncome,
      otherSourcesIncome,
      rentalHistory,
      realEstate,
      capitalGains,
      taxDeductions,
      tdsCredits,
      sips,
      holdings,
      mutualFunds,
      goldHoldings,
      npsAccounts,
      epfAccounts,
      smallSavingsAccounts,
      fixedDeposits,
      forexDeposits,
      liabilities,
      insurancePolicies,
      healthInsurancePolicies,
      vehicles,
      subscriptions,
    ] as const;

    for (const t of NOTES_TABLES) {
      await tx
        .delete(t)
        .where(and(eq(t.userId, userId), like(t.notes, 'DEMO-SEED:%')));
    }

    await tx
      .delete(budgetCategories)
      .where(
        and(
          eq(budgetCategories.userId, userId),
          sql`${budgetCategories.sortOrder} >= 9000`,
        ),
      );

    await tx
      .delete(itrFormSelection)
      .where(
        and(eq(itrFormSelection.userId, userId), eq(itrFormSelection.fy, FY)),
      );

    await tx
      .delete(financialGoals)
      .where(
        and(
          eq(financialGoals.userId, userId),
          inArray(financialGoals.name, [
            "Daughter's higher education",
            'Retirement corpus',
            'House upgrade',
          ]),
        ),
      );

    // ─── user_preferences — UPDATE in place ───────────────────────
    await tx
      .update(userPreferences)
      .set({
        metroCity: true,
        parentsAreSrCitizens: true,
        isSrCitizen: false,
        isFamilyPensioner: false,
        isGovtEmployeeForNps: false,
        hasPermanentDisability: false,
        disabilitySeverity: null,
        updatedAt: new Date(),
      })
      .where(eq(userPreferences.userId, userId));
    tally('user_preferences', 1);

    // ─── salary_income ────────────────────────────────────────────
    const basic = rs(600_000);
    const da = rs(60_000);
    const hra = rs(240_000);
    const lta = rs(40_000);
    const conv = rs(19_200);
    const childEd = rs(0);
    const medical = rs(15_000);
    const otherAl = rs(86_800);
    const grossSalary =
      basic + da + hra + lta + conv + childEd + medical + otherAl;
    const tds = rs(120_000);
    const rentMonthly = rs(30_000);

    await tx.insert(salaryIncome).values({
      userId,
      financialYear: FY,
      employerName: 'Heartfulness Institute',
      employerTan: 'BLRX99999E',
      grossSalaryPaisa: grossSalary,
      exemptionsPaisa: 0,
      section16Paisa: 5_000_000,
      taxableSalaryPaisa: grossSalary - 5_000_000,
      tdsPaisa: tds,
      basicPaisa: basic,
      daPaisa: da,
      hraReceivedPaisa: hra,
      ltaPaisa: lta,
      conveyancePaisa: conv,
      childrenEdAllowancePaisa: childEd,
      medicalPaisa: medical,
      otherAllowancesPaisa: otherAl,
      rentPaidMonthlyPaisa: rentMonthly,
      notes: NOTE('salary'),
    });
    tally('salary_income', 1);

    // ─── other_sources_income ─────────────────────────────────────
    const otherSources = [
      {
        source: 'BANK_INTEREST' as const,
        desc: 'Savings + sweep interest (multi-bank)',
        amt: rs(35_000),
      },
      {
        source: 'FD_INTEREST' as const,
        desc: 'Fixed deposit accrued interest',
        amt: rs(85_000),
      },
      {
        source: 'DIVIDEND' as const,
        desc: 'Equity + MF dividends',
        amt: rs(15_000),
      },
    ];
    for (const o of otherSources) {
      await tx.insert(otherSourcesIncome).values({
        userId,
        financialYear: FY,
        source: o.source,
        description: o.desc,
        amountPaisa: o.amt,
        isTaxExempt: false,
        taxSection: null,
        notes: NOTE('os-' + o.source.toLowerCase()),
      });
      tally('other_sources_income', 1);
    }

    // ─── real_estate — 3 properties ───────────────────────────────
    const anandBuy = lakh(85);
    const anandCur = cr(1.2);
    await tx.insert(realEstate).values({
      userId,
      propertyName: 'Anand Apartment, Bengaluru',
      type: 'RESIDENTIAL',
      status: 'OWNED',
      address: 'Anand Apartment, Indiranagar',
      city: 'Bengaluru',
      state: 'Karnataka',
      area: 1450,
      areaUnit: 'sqft',
      purchasePrice: anandBuy,
      purchaseDate: '2018-05-15',
      currentValuation: anandCur,
      valuationDate: '2026-03-31',
      gainLoss: anandCur - anandBuy,
      gainLossPercent: ((anandCur - anandBuy) / anandBuy) * 100,
      monthlyRent: 0,
      isSelfOccupied: true,
      homeLoanInterestPaidPaisa: lakh(1.8),
      homeLoanDisbursedDate: '2018-06-01',
      isFirstHome: false,
      notes: NOTE('re-anand'),
    });
    tally('real_estate', 1);

    const wfBuy = lakh(65);
    const wfCur = lakh(95);
    const [whitefieldRow] = await tx
      .insert(realEstate)
      .values({
        userId,
        propertyName: 'Whitefield Flat, Bengaluru',
        type: 'RESIDENTIAL',
        status: 'OWNED',
        address: 'Whitefield, Phase 2',
        city: 'Bengaluru',
        state: 'Karnataka',
        area: 1100,
        areaUnit: 'sqft',
        purchasePrice: wfBuy,
        purchaseDate: '2020-08-15',
        currentValuation: wfCur,
        valuationDate: '2026-03-31',
        gainLoss: wfCur - wfBuy,
        gainLossPercent: ((wfCur - wfBuy) / wfBuy) * 100,
        monthlyRent: rs(25_000),
        rentStartDate: '2022-04-01',
        rentTenantName: 'Tenant XYZ',
        propertyTaxAnnual: rs(18_000),
        isSelfOccupied: false,
        homeLoanInterestPaidPaisa: 0,
        notes: NOTE('re-whitefield'),
      })
      .returning({ id: realEstate.id });
    tally('real_estate', 1);
    const whitefieldId = whitefieldRow!.id;

    const hosurBuy = lakh(35);
    const hosurCur = lakh(48);
    await tx.insert(realEstate).values({
      userId,
      propertyName: 'Hosur Plot',
      type: 'LAND',
      status: 'OWNED',
      address: 'Hosur Industrial Area',
      city: 'Hosur',
      state: 'Tamil Nadu',
      area: 850,
      areaUnit: 'sqft',
      purchasePrice: hosurBuy,
      purchaseDate: '2020-08-15',
      currentValuation: hosurCur,
      valuationDate: '2026-03-31',
      gainLoss: hosurCur - hosurBuy,
      gainLossPercent: ((hosurCur - hosurBuy) / hosurBuy) * 100,
      monthlyRent: 0,
      isSelfOccupied: false,
      homeLoanInterestPaidPaisa: lakh(2.4),
      homeLoanDisbursedDate: '2020-08-15',
      isFirstHome: true,
      stampValuePaisa: lakh(42),
      carpetAreaSqft: 850,
      notes: NOTE('re-hosur'),
    });
    tally('real_estate', 1);

    // ─── rental_history ───────────────────────────────────────────
    const history = [
      { fy: '2022-23', rent: rs(240_000) },
      { fy: '2023-24', rent: rs(252_000) },
      { fy: '2024-25', rent: rs(276_000) },
    ];
    for (const h of history) {
      await tx.insert(rentalHistory).values({
        userId,
        realEstateId: whitefieldId,
        fy: h.fy,
        rentReceivedPaisa: h.rent,
        monthsLet: 12,
        notes: 'DEMO-SEED: rental history for prior FYs',
      });
      tally('rental_history', 1);
    }

    // ─── capital_gains ────────────────────────────────────────────
    const capRows = [
      {
        assetType: 'EQUITY_MF' as const,
        assetName: 'SBI Bluechip — sold pre-reform',
        purchaseDate: '2020-04-10',
        saleDate: '2024-06-15',
        purchasePrice: lakh(5),
        salePrice: lakh(7.5),
        gain: lakh(2.5),
        taxable: lakh(2.5),
        holding: 'LTCG' as const,
        rate: 10,
        bucket: 'cg-equity-ltcg-pre-jul24',
      },
      {
        assetType: 'EQUITY_MF' as const,
        assetName: 'Parag Parikh Flexi — post-reform',
        purchaseDate: '2022-01-10',
        saleDate: '2025-10-20',
        purchasePrice: lakh(6),
        salePrice: lakh(9.5),
        gain: lakh(3.5),
        taxable: lakh(3.5),
        holding: 'LTCG' as const,
        rate: 12.5,
        bucket: 'cg-equity-ltcg-post-jul24',
      },
      {
        assetType: 'DEBT_MF' as const,
        assetName: 'HDFC Corporate Bond — indexed',
        purchaseDate: '2018-04-01',
        saleDate: '2025-08-10',
        purchasePrice: lakh(8),
        salePrice: lakh(9.2),
        gain: lakh(1.2),
        taxable: lakh(1.2),
        holding: 'LTCG' as const,
        rate: 20,
        bucket: 'cg-debt-ltcg',
      },
      {
        assetType: 'STOCKS' as const,
        assetName: 'Reliance — STCG',
        purchaseDate: '2025-08-01',
        saleDate: '2025-12-05',
        purchasePrice: lakh(2.85),
        salePrice: lakh(3.5),
        gain: rs(65_000),
        taxable: rs(65_000),
        holding: 'STCG' as const,
        rate: 20,
        bucket: 'cg-equity-stcg',
      },
    ];
    for (const r of capRows) {
      const taxAmount = Math.round(r.taxable * (r.rate / 100));
      await tx.insert(capitalGains).values({
        userId,
        financialYear: FY,
        assetType: r.assetType,
        assetName: r.assetName,
        purchaseDate: r.purchaseDate,
        saleDate: r.saleDate,
        purchasePrice: r.purchasePrice,
        salePrice: r.salePrice,
        capitalGain: r.gain,
        holdingPeriod: r.holding,
        exemptionApplied: 0,
        taxableGain: r.taxable,
        taxRate: r.rate,
        taxAmount,
        notes: NOTE(r.bucket),
      });
      tally('capital_gains', 1);
    }

    // ─── tax_deductions ───────────────────────────────────────────
    type DedRow = {
      sec: string;
      desc: string;
      amount: number;
      pd: string;
      bucket: string;
      eligibleNew?: boolean;
      eightyDBucket?: string;
      eightyGCategory?: string;
      recipientName?: string;
      recipientPan?: string;
      recipient80gNumber?: string;
      qualifyingPercent?: number;
    };
    const dedRows: DedRow[] = [
      { sec: '80C', desc: 'PPF deposit', amount: lakh(1.0), pd: '2025-06-15', bucket: '80c-ppf' },
      { sec: '80C', desc: 'ELSS investment', amount: rs(50_000), pd: '2025-12-10', bucket: '80c-elss' },
      { sec: '80C', desc: 'Term life insurance premium', amount: rs(45_000), pd: '2025-07-20', bucket: '80c-term-life' },
      { sec: '80C', desc: 'Tuition fees', amount: rs(35_000), pd: '2025-06-30', bucket: '80c-tuition' },
      { sec: '80C', desc: 'EPF contribution (employee share)', amount: rs(72_000), pd: '2025-12-31', bucket: '80c-epf' },
      { sec: '80CCD_1B', desc: 'NPS Tier-I additional contribution', amount: rs(50_000), pd: '2025-12-20', bucket: '80ccd1b-nps-self', eligibleNew: false },
      { sec: '80CCD_2', desc: 'NPS employer contribution (10% of basic+da)', amount: rs(84_800), pd: '2025-12-31', bucket: '80ccd2-nps-employer', eligibleNew: true },
      { sec: '80D', desc: 'Self/family health insurance premium', amount: rs(28_000), pd: '2025-05-15', bucket: '80d-self', eightyDBucket: 'SELF_FAMILY' },
      { sec: '80D', desc: 'Parents health insurance + preventive check-up', amount: rs(42_000), pd: '2025-05-15', bucket: '80d-parents', eightyDBucket: 'PARENTS' },
      { sec: '80E', desc: 'Education loan interest', amount: rs(65_000), pd: '2025-09-15', bucket: '80e-edu-loan' },
      {
        sec: '80G', desc: 'PM CARES donation', amount: rs(25_000), pd: '2025-04-15', bucket: '80g-pmcares',
        eightyGCategory: '100_NO_LIMIT', recipientName: 'PM CARES Fund', qualifyingPercent: 100,
      },
      {
        sec: '80G', desc: 'Local NGO donation', amount: rs(15_000), pd: '2025-08-10', bucket: '80g-ngo',
        eightyGCategory: '50_WITH_LIMIT', recipientName: 'Saksham Trust',
        recipientPan: 'AAATS1234F', recipient80gNumber: 'AAATS1234F/CIT(E)/2024-25',
        qualifyingPercent: 50,
      },
      { sec: '80TTA', desc: 'Savings bank interest deduction', amount: rs(10_000), pd: '2026-03-31', bucket: '80tta-savings' },
      { sec: '80EEB', desc: 'Electric vehicle loan interest', amount: rs(40_000), pd: '2025-11-01', bucket: '80eeb-ev' },
    ];
    for (const r of dedRows) {
      await tx.insert(taxDeductions).values({
        userId,
        section: r.sec,
        description: r.desc,
        financialYear: FY,
        deductibleAmount: r.amount,
        availableLimit: 0,
        utilizableAmount: 0,
        claimed: true,
        claimedAmount: r.amount,
        amountPaisa: r.amount,
        paymentDate: r.pd,
        paymentMethod: 'NEFT',
        incurredDate: r.pd,
        eligibleUnderNew: r.eligibleNew ?? false,
        eightyGCategory: r.eightyGCategory ?? null,
        eightyDBucket: r.eightyDBucket ?? null,
        recipientName: r.recipientName ?? null,
        recipientPan: r.recipientPan ?? null,
        recipient80gNumber: r.recipient80gNumber ?? null,
        qualifyingPercent: r.qualifyingPercent ?? null,
        hasUpperLimit: false,
        notes: NOTE(r.bucket),
      });
      tally('tax_deductions', 1);
    }

    // ─── tds_credits ──────────────────────────────────────────────
    type TdsRow = {
      category: 'CONSULTING' | 'INTEREST' | 'RENT' | 'PROPERTY' | 'OTHER';
      deductor: string;
      tan?: string;
      pan?: string;
      section: string;
      income: number;
      tds: number;
      bucket: string;
    };
    const tdsRows: TdsRow[] = [
      { category: 'OTHER', deductor: 'Heartfulness Institute', tan: 'BLRX99999E', section: '192', income: grossSalary, tds: rs(120_000), bucket: 'tds-salary' },
      { category: 'INTEREST', deductor: 'SBI Bank', tan: 'MUMS00001E', section: '194A', income: rs(85_000), tds: rs(8_500), bucket: 'tds-fd-interest' },
      { category: 'CONSULTING', deductor: 'TechClient Pvt Ltd', tan: 'BLRT88888E', section: '194J', income: rs(150_000), tds: rs(15_000), bucket: 'tds-194j' },
      { category: 'RENT', deductor: 'Tenant XYZ', tan: 'BLRR77777E', section: '194I', income: rs(300_000), tds: rs(7_500), bucket: 'tds-194i' },
      { category: 'PROPERTY', deductor: 'Buyer ABC', pan: 'XXXXX1234X', section: '194-IA', income: lakh(40), tds: rs(20_000), bucket: 'tds-194ia' },
    ];
    for (const r of tdsRows) {
      await tx.insert(tdsCredits).values({
        userId,
        financialYear: FY,
        category: r.category,
        deductorName: r.deductor,
        deductorTan: r.tan ?? null,
        deductorPan: r.pan ?? null,
        section: r.section,
        incomePaisa: r.income,
        tdsPaisa: r.tds,
        isReconciled: false,
        notes: NOTE(r.bucket),
      });
      tally('tds_credits', 1);
    }

    // ─── holdings — 5 stocks ──────────────────────────────────────
    const stocks = [
      { sym: 'RELIANCE.NS', qty: 100, avg: rs(1_250), cur: rs(1_310), purchase: '2024-02-15' },
      { sym: 'INFY.NS', qty: 50, avg: rs(1_520), cur: rs(1_605), purchase: '2024-04-10' },
      { sym: 'HDFCBANK.NS', qty: 75, avg: rs(1_680), cur: rs(1_640), purchase: '2024-01-20' },
      { sym: 'TCS.NS', qty: 30, avg: rs(3_400), cur: rs(3_520), purchase: '2024-06-05' },
      { sym: 'ITC.NS', qty: 200, avg: rs(450), cur: rs(472), purchase: '2024-03-12' },
    ];
    for (const s of stocks) {
      const totInv = s.qty * s.avg;
      const curVal = s.qty * s.cur;
      const gain = curVal - totInv;
      const gainPct = (gain / totInv) * 100;
      await tx.insert(holdings).values({
        userId,
        symbol: s.sym,
        quantity: s.qty,
        averagePrice: s.avg,
        currentPrice: s.cur,
        purchaseDate: s.purchase,
        totalInvestment: totInv,
        currentValue: curVal,
        gainLoss: gain,
        gainLossPercent: gainPct,
        notes: NOTE('stock-' + s.sym.split('.')[0].toLowerCase()),
      });
      tally('holdings', 1);
    }

    // ─── mutual_funds ─────────────────────────────────────────────
    const funds = [
      { isin: 'INF879O01027', name: 'Parag Parikh Flexi Cap - Direct Growth', type: 'EQUITY' as const, cat: 'EQUITY' as const, units: 1850.5, nav: rs(82.4), totInv: lakh(1.2), start: '2023-04-10' },
      { isin: 'INF769K01010', name: 'Mirae Asset Large Cap - Direct Growth', type: 'EQUITY' as const, cat: 'EQUITY' as const, units: 1320.0, nav: rs(108.2), totInv: lakh(1.3), start: '2023-05-05' },
      { isin: 'INF200K01QX4', name: 'SBI Small Cap - Direct Growth', type: 'EQUITY' as const, cat: 'EQUITY' as const, units: 720.0, nav: rs(168.5), totInv: lakh(1.0), start: '2023-08-15' },
      { isin: 'INF846K01EW2', name: 'Axis Bluechip - Direct Growth', type: 'EQUITY' as const, cat: 'EQUITY' as const, units: 2100.0, nav: rs(58.7), totInv: lakh(1.1), start: '2023-06-20' },
      { isin: 'INF204KB1FD3', name: 'Nippon India Multi Asset - Direct Growth', type: 'HYBRID' as const, cat: 'HYBRID' as const, units: 4500.0, nav: rs(18.9), totInv: lakh(0.8), start: '2023-09-10' },
      { isin: 'INF966L01A35', name: 'Quant ELSS Tax Saver - Direct Growth', type: 'EQUITY' as const, cat: 'EQUITY' as const, units: 1100.0, nav: rs(412.3), totInv: lakh(4.0), start: '2022-12-05' },
      { isin: 'INF179K01OC6', name: 'HDFC Corporate Bond - Direct Growth', type: 'DEBT' as const, cat: 'DEBT' as const, units: 12000.0, nav: rs(31.5), totInv: lakh(3.5), start: '2022-04-15' },
      { isin: 'INF109K01F18', name: 'ICICI Pru Liquid - Direct Growth', type: 'LIQUID' as const, cat: 'DEBT' as const, units: 450.0, nav: rs(356.0), totInv: lakh(1.5), start: '2024-01-08' },
    ];
    const isinToMfId = new Map<string, number>();
    for (const f of funds) {
      const curVal = Math.round(f.units * f.nav);
      const gain = curVal - f.totInv;
      const gainPct = f.totInv === 0 ? 0 : (gain / f.totInv) * 100;
      const [row] = await tx
        .insert(mutualFunds)
        .values({
          userId,
          isin: f.isin,
          schemeName: f.name,
          fundType: f.type,
          category: f.cat,
          units: f.units,
          nav: f.nav,
          totalInvestment: f.totInv,
          currentValue: curVal,
          gainLoss: gain,
          gainLossPercent: gainPct,
          lastNavDate: '2026-06-01',
          investmentStartDate: f.start,
          notes: NOTE('mf-' + f.isin.toLowerCase()),
        })
        .returning({ id: mutualFunds.id });
      isinToMfId.set(f.isin, row!.id);
      tally('mutual_funds', 1);
    }

    // ─── sips ─────────────────────────────────────────────────────
    const sipPlan = [
      { isin: 'INF879O01027', amt: rs(20_000), day: 5, startMonth: 4, startUnits: 100.0, startNav: rs(80) },
      { isin: 'INF769K01010', amt: rs(15_000), day: 10, startMonth: 4, startUnits: 80.0, startNav: rs(100) },
      { isin: 'INF200K01QX4', amt: rs(10_000), day: 15, startMonth: 5, startUnits: 30.0, startNav: rs(160) },
      { isin: 'INF966L01A35', amt: rs(12_500), day: 25, startMonth: 6, startUnits: 25.0, startNav: rs(390) },
    ];
    for (const s of sipPlan) {
      const mfId = isinToMfId.get(s.isin);
      if (!mfId) continue;
      const nextDay = String(s.day).padStart(2, '0');
      const startMonth = String(s.startMonth).padStart(2, '0');
      await tx.insert(sips).values({
        userId,
        mutualFundId: mfId,
        status: 'ACTIVE',
        frequency: 'MONTHLY',
        monthlyAmount: s.amt,
        startDate: `2024-${startMonth}-${nextDay}`,
        nextExecutionDate: `2026-07-${nextDay}`,
        totalInvestedSoFar: s.amt * 24,
        startingUnits: s.startUnits,
        startingNav: s.startNav,
        notes: NOTE('sip-' + s.isin.toLowerCase()),
      });
      tally('sips', 1);
    }

    // ─── gold_holdings ────────────────────────────────────────────
    {
      const grams = 50;
      const buyPg = rs(4_500);
      const nowPg = rs(7_300);
      const totInv = grams * buyPg;
      const curVal = grams * nowPg;
      await tx.insert(goldHoldings).values({
        userId,
        type: 'GOLD_BOND',
        quantity: grams,
        currentPrice: nowPg,
        totalValue: curVal,
        grams,
        purity: '999',
        purchaseDate: '2022-03-15',
        purchasePricePerGram: buyPg,
        currentRatePerGram: nowPg,
        totalInvestment: totInv,
        currentValue: curVal,
        gainLoss: curVal - totInv,
        gainLossPercent: ((curVal - totInv) / totInv) * 100,
        name: 'SGB 2021-22 Series VIII',
        notes: NOTE('gold-sgb'),
      });
      tally('gold_holdings', 1);
    }

    // ─── nps_accounts ─────────────────────────────────────────────
    {
      const equity = lakh(4.5);
      const debt = lakh(2.5);
      const alt = lakh(1.5);
      const total = equity + debt + alt;
      const yearlyContrib = rs(50_000) + rs(84_800);
      const monthlyContrib = Math.round(yearlyContrib / 12);
      await tx.insert(npsAccounts).values({
        userId,
        accountNumber: 'PRAN110099887766',
        accountHolder: displayName,
        pan: 'XXXXX1234X',
        tier: 'TIER1',
        status: 'ACTIVE',
        equityFundValue: equity,
        debtFundValue: debt,
        alternativeFundValue: alt,
        totalValue: total,
        totalContributed: yearlyContrib * 4,
        employerContribution: rs(84_800),
        monthlyContributionPaisa: monthlyContrib,
        gainLoss: total - yearlyContrib * 4,
        openingDate: '2020-04-15',
        notes: NOTE('nps-tier1'),
      });
      tally('nps_accounts', 1);
    }

    // ─── epf_accounts ─────────────────────────────────────────────
    {
      const emp = lakh(3.8);
      const empr = lakh(3.8);
      const interest = 0;
      const total = emp + empr + interest;
      const monthlyContrib = rs(15_840);
      await tx.insert(epfAccounts).values({
        userId,
        accountType: 'EPF',
        accountHolder: displayName,
        pan: 'XXXXX1234X',
        universalAccountNumber: 'UAN100200300',
        employeeBalance: emp,
        employerBalance: empr,
        interestBalance: interest,
        totalBalance: total,
        totalContributed: emp + empr,
        interestEarned: interest,
        monthlyContributionPaisa: monthlyContrib,
        openingDate: '2018-06-01',
        isActive: true,
        notes: NOTE('epf-heartfulness'),
      });
      tally('epf_accounts', 1);
    }

    // ─── small_savings_accounts ───────────────────────────────────
    type SSRow = {
      scheme: 'PPF' | 'SSY' | 'NSC';
      acct: string;
      holder: string;
      dob?: string;
      institution: string;
      open: string;
      maturity: string;
      rate: number;
      bal: number;
      totDep: number;
      totInt: number;
      bucket: string;
      periodicContrib: number;
      contribFreq: 'MONTHLY' | 'YEARLY';
    };
    const ssRows: SSRow[] = [
      {
        scheme: 'PPF', acct: 'PPF8001100200300', holder: displayName,
        institution: 'SBI Indiranagar',
        open: '2017-04-10', maturity: '2032-04-10', rate: 7.1,
        bal: lakh(6.5), totDep: lakh(7.5), totInt: lakh(0.5),
        bucket: 'ss-ppf',
        periodicContrib: rs(8_333), contribFreq: 'MONTHLY',
      },
      {
        scheme: 'SSY', acct: 'SSY8001234567890', holder: 'Daughter',
        dob: '2017-08-22',
        institution: 'India Post Indiranagar',
        open: '2018-09-05', maturity: '2038-08-22', rate: 8.2,
        bal: lakh(1.8), totDep: lakh(2.0), totInt: rs(20_000),
        bucket: 'ss-ssy',
        periodicContrib: rs(15_000), contribFreq: 'MONTHLY',
      },
      {
        scheme: 'NSC', acct: 'NSC8009988776655', holder: displayName,
        institution: 'India Post Indiranagar',
        open: '2022-10-10', maturity: '2027-10-10', rate: 7.7,
        bal: rs(58_000), totDep: rs(50_000), totInt: rs(8_000),
        bucket: 'ss-nsc',
        periodicContrib: 0, contribFreq: 'MONTHLY',
      },
    ];
    for (const s of ssRows) {
      await tx.insert(smallSavingsAccounts).values({
        userId,
        schemeType: s.scheme,
        accountNumber: s.acct,
        holderName: s.holder,
        holderDob: s.dob ?? null,
        institution: s.institution,
        openingDate: s.open,
        maturityDate: s.maturity,
        depositAmountPaisa: 0,
        currentBalancePaisa: s.bal,
        interestRatePercent: s.rate,
        interestCompounding: 'YEARLY',
        lockInEndDate: s.maturity,
        totalDepositedPaisa: s.totDep,
        totalInterestPaisa: s.totInt,
        periodicContributionPaisa: s.periodicContrib,
        contributionFrequency: s.contribFreq,
        status: 'ACTIVE',
        notes: NOTE(s.bucket),
      });
      tally('small_savings_accounts', 1);
    }

    // ─── fixed_deposits ───────────────────────────────────────────
    const fds = [
      { bank: 'SBI', acct: 'SBIFD0001', principal: lakh(3), rate: 7.1, start: '2025-03-01', mat: '2026-03-01', tenure: 12, comp: 'QUARTERLY' as const },
      { bank: 'HDFC', acct: 'HDFCFD002', principal: lakh(2), rate: 7.25, start: '2025-08-01', mat: '2026-08-01', tenure: 12, comp: 'QUARTERLY' as const },
      { bank: 'ICICI', acct: 'ICICIFD003', principal: lakh(5), rate: 7.0, start: '2024-12-01', mat: '2027-12-01', tenure: 36, comp: 'QUARTERLY' as const },
      { bank: 'Axis', acct: 'AXISFD004', principal: lakh(1.5), rate: 7.4, start: '2025-06-01', mat: '2026-06-01', tenure: 12, comp: 'QUARTERLY' as const },
      { bank: 'Kotak', acct: 'KOTAKFD005', principal: lakh(4), rate: 7.15, start: '2025-10-01', mat: '2028-10-01', tenure: 36, comp: 'QUARTERLY' as const },
    ];
    for (const f of fds) {
      const periods = f.tenure / 3;
      const matAmt = Math.round(f.principal * Math.pow(1 + f.rate / 400, periods));
      await tx.insert(fixedDeposits).values({
        userId,
        bankName: f.bank,
        accountNumber: f.acct,
        principalPaisa: f.principal,
        interestRate: f.rate,
        compoundingFreq: f.comp,
        interestType: 'CUMULATIVE',
        startDate: f.start,
        maturityDate: f.mat,
        tenureMonths: f.tenure,
        maturityAmountPaisa: matAmt,
        status: 'ACTIVE',
        isTaxSaver: false,
        autoRenew: false,
        notes: NOTE('fd-' + f.bank.toLowerCase()),
      });
      tally('fixed_deposits', 1);
    }

    // ─── forex_deposits ───────────────────────────────────────────
    const forex = [
      { bank: 'HDFC NRE', acct: 'HDFC-NRE-001', ccy: 'USD', amt: '5000.0000', rate: 4.0, opening: '2024-09-15', maturity: null, note: 'forex-hdfc-usd' },
      { bank: 'ICICI NRE Bank', acct: 'ICICI-NRE-002', ccy: 'EUR', amt: '2000.0000', rate: 2.5, opening: '2025-06-01', maturity: '2028-06-01', note: 'forex-icici-eur' },
      { bank: 'ENBD', acct: 'ENBD-DBX-003', ccy: 'AED', amt: '10000.0000', rate: 1.5, opening: '2023-04-12', maturity: null, note: 'forex-enbd-aed' },
    ];
    for (const f of forex) {
      await tx.insert(forexDeposits).values({
        userId,
        bankName: f.bank,
        accountNumber: f.acct,
        currencyCode: f.ccy,
        amountInCurrency: f.amt,
        interestRate: f.rate,
        openingDate: f.opening,
        maturityDate: f.maturity,
        status: 'ACTIVE',
        notes: NOTE(f.note),
      });
      tally('forex_deposits', 1);
    }

    // ─── liabilities ──────────────────────────────────────────────
    await tx.insert(liabilities).values({
      userId,
      name: 'Anand Apartment home loan',
      type: 'HOME_LOAN',
      status: 'ACTIVE',
      creditorName: 'HDFC Bank',
      originalAmount: lakh(65),
      currentBalance: lakh(52),
      interestRate: 8.6,
      monthlyEmi: rs(58_000),
      startDate: '2018-07-01',
      maturityDate: '2038-07-01',
      remainingTenor: 144,
      nextPaymentDate: '2026-07-05',
      principalQualifies80c: true,
      interestQualifies24b: true,
      notes: NOTE('liab-home-loan'),
    });
    tally('liabilities', 1);

    await tx.insert(liabilities).values({
      userId,
      name: 'HDFC Regalia Credit Card',
      type: 'CREDIT_CARD',
      status: 'ACTIVE',
      creditorName: 'HDFC Bank',
      originalAmount: rs(300_000),
      currentBalance: rs(35_000),
      interestRate: 42.0,
      monthlyEmi: rs(5_000),
      startDate: '2020-04-01',
      nextPaymentDate: '2026-06-15',
      notes: NOTE('liab-credit-card'),
    });
    tally('liabilities', 1);

    // ─── insurance_policies ───────────────────────────────────────
    type LifePolicy = {
      policyNo: string;
      type: 'TERM_LIFE' | 'ENDOWMENT' | 'ULIP';
      insurer: string;
      sumAssured: number;
      premium: number;
      freq: string;
      start: string;
      term: number;
      ppt: number;
      nextDue: string;
      bucket: string;
      maturity?: string;
      maturityBenefit?: number;
    };
    const lifePolicies: LifePolicy[] = [
      {
        policyNo: 'LICTERM10001', type: 'TERM_LIFE', insurer: 'LIC of India',
        sumAssured: cr(1), premium: rs(18_000),
        freq: 'ANNUAL', start: '2018-04-15', term: 30, ppt: 30,
        nextDue: '2026-04-15', bucket: 'ins-lic-term',
      },
      {
        policyNo: 'LICEND20002', type: 'ENDOWMENT', insurer: 'LIC of India',
        sumAssured: lakh(15), premium: rs(35_000),
        freq: 'ANNUAL', start: '2015-07-10', term: 20, ppt: 20,
        nextDue: '2026-07-10', bucket: 'ins-lic-endowment',
        maturity: '2035-07-10', maturityBenefit: lakh(25),
      },
      {
        policyNo: 'HDFCULIP30003', type: 'ULIP', insurer: 'HDFC Life',
        sumAssured: lakh(30), premium: rs(50_000),
        freq: 'ANNUAL', start: '2020-05-20', term: 15, ppt: 15,
        nextDue: '2026-05-20', bucket: 'ins-hdfc-ulip',
        maturity: '2035-05-20', maturityBenefit: lakh(45),
      },
    ];
    for (const p of lifePolicies) {
      await tx.insert(insurancePolicies).values({
        userId,
        policyNumber: p.policyNo,
        policyType: p.type,
        status: 'ACTIVE',
        policyHolder: displayName,
        insurer: p.insurer,
        sumAssured: p.sumAssured,
        maturityBenefit: p.maturityBenefit ?? null,
        premiumAmount: p.premium,
        premiumFrequency: p.freq,
        policyStartDate: p.start,
        maturityDate: p.maturity ?? null,
        policyTerm: p.term,
        premiumPaymentTerm: p.ppt,
        nextPremiumDueDate: p.nextDue,
        notes: NOTE(p.bucket),
      });
      tally('insurance_policies', 1);
    }

    // ─── health_insurance ─────────────────────────────────────────
    const [healthRow] = await tx
      .insert(healthInsurancePolicies)
      .values({
        userId,
        insurer: 'Star Health',
        policyNumber: 'STARHEALTHFAM12345',
        policyType: 'FAMILY_FLOATER',
        status: 'ACTIVE',
        policyHolder: displayName,
        sumInsuredPaisa: lakh(10),
        premiumPaisa: rs(28_000),
        premiumFrequency: 'ANNUAL',
        startDate: '2023-04-15',
        renewalDate: '2026-04-15',
        waitingPeriodMonths: 48,
        servedWaitingMonths: 36,
        cashlessAvailable: true,
        networkHospitalCount: 12_000,
        notes: NOTE('health-star-family-floater'),
      })
      .returning({ id: healthInsurancePolicies.id });
    tally('health_insurance_policies', 1);
    const healthPolicyId = healthRow!.id;

    const fam = [
      { name: displayName, rel: 'SELF' as const, dob: '1988-04-12', gender: 'M' },
      { name: 'Spouse Demo', rel: 'SPOUSE' as const, dob: '1990-08-22', gender: 'F' },
      { name: 'Child 1 Demo', rel: 'DAUGHTER' as const, dob: '2017-08-22', gender: 'F' },
      { name: 'Child 2 Demo', rel: 'SON' as const, dob: '2020-03-05', gender: 'M' },
    ];
    for (const m of fam) {
      await tx.insert(healthInsuranceCards).values({
        userId,
        policyId: healthPolicyId,
        memberName: m.name,
        memberId: `SH-${healthPolicyId}-${m.rel}`,
        relationship: m.rel,
        dateOfBirth: m.dob,
        gender: m.gender,
        notes: NOTE('health-card-' + m.rel.toLowerCase()),
      });
      tally('health_insurance_cards', 1);
    }

    // ─── vehicle ──────────────────────────────────────────────────
    const [vehRow] = await tx
      .insert(vehicles)
      .values({
        userId,
        registrationNumber: 'KA01XX1234',
        make: 'Honda',
        model: 'City',
        variant: 'V CVT',
        year: 2020,
        fuelType: 'PETROL',
        transmission: 'AUTOMATIC',
        color: 'Pearl White',
        bodyType: 'SEDAN',
        purchaseDate: '2020-03-15',
        purchasePricePaisa: lakh(12),
        currentIdvPaisa: lakh(8),
        odometerKm: 65_000,
        status: 'ACTIVE',
        notes: NOTE('veh-honda-city'),
      })
      .returning({ id: vehicles.id });
    tally('vehicles', 1);
    const vehicleId = vehRow!.id;

    await tx.insert(vehicleInsurancePolicies).values({
      userId,
      vehicleId,
      insurer: 'ICICI Lombard',
      policyNumber: `VEHINS-${vehicleId}-2025`,
      insuranceType: 'COMPREHENSIVE',
      idvPaisa: lakh(8),
      premiumPaisa: rs(18_500),
      ownDamagePremiumPaisa: rs(12_000),
      thirdPartyPremiumPaisa: rs(4_500),
      ncbPercent: 35,
      addons: '["ZERO_DEP","ENGINE_PROTECT","RSA"]',
      premiumFrequency: 'ANNUAL',
      startDate: '2025-09-15',
      renewalDate: '2026-09-15',
      claimsMadeCount: 0,
      status: 'ACTIVE',
      notes: NOTE('vehins-honda-city'),
    });
    tally('vehicle_insurance_policies', 1);

    await tx.insert(vehiclePuc).values({
      userId,
      vehicleId,
      certificateNumber: `PUC-${vehicleId}-2025`,
      issuedDate: '2025-12-01',
      validUntil: '2026-12-01',
      issuingAuthority: 'Authorised PUC Center, Indiranagar',
      costPaisa: rs(150),
      notes: NOTE('puc-honda-city'),
    });
    tally('vehicle_puc', 1);

    await tx.insert(vehicleServiceLog).values({
      userId,
      vehicleId,
      serviceDate: '2026-02-10',
      odometerKm: 62_000,
      serviceType: 'REGULAR',
      garageName: 'Honda Authorised Service Center',
      costPaisa: rs(8_500),
      description: '60k km service — oil, filter, brake pads',
      nextServiceDueDate: '2026-08-10',
      nextServiceDueKm: 70_000,
      notes: NOTE('veh-service-honda-60k'),
    });
    tally('vehicle_service_log', 1);

    // ─── subscriptions ────────────────────────────────────────────
    const subs = [
      { name: 'Netflix', prov: 'Netflix', cat: 'STREAMING' as const, plan: 'Standard', amt: rs(649), freq: 'MONTHLY' as const },
      { name: 'Spotify', prov: 'Spotify', cat: 'STREAMING' as const, plan: 'Individual', amt: rs(119), freq: 'MONTHLY' as const },
      { name: 'Notion', prov: 'Notion Labs', cat: 'PRODUCTIVITY' as const, plan: 'Plus', amt: rs(950), freq: 'MONTHLY' as const },
      { name: 'ChatGPT Plus', prov: 'OpenAI', cat: 'AI' as const, plan: 'Plus', amt: rs(1_650), freq: 'MONTHLY' as const },
      { name: 'AWS Personal Cloud', prov: 'Amazon Web Services', cat: 'CLOUD' as const, plan: 'Reserved + EC2', amt: rs(4_200), freq: 'MONTHLY' as const },
      { name: 'Times Prime', prov: 'Times Internet', cat: 'NEWS' as const, plan: 'Annual', amt: rs(1_499), freq: 'ANNUAL' as const },
    ];
    for (const s of subs) {
      await tx.insert(subscriptions).values({
        userId,
        name: s.name,
        provider: s.prov,
        category: s.cat,
        planName: s.plan,
        amountPaisa: s.amt,
        billingFrequency: s.freq,
        startDate: '2025-04-01',
        nextRenewalDate: s.freq === 'ANNUAL' ? '2026-04-01' : '2026-06-15',
        paymentMethod: 'HDFC Regalia',
        autoRenew: true,
        status: 'ACTIVE',
        notes: NOTE('sub-' + s.name.toLowerCase().replace(/\W+/g, '-')),
      });
      tally('subscriptions', 1);
    }

    // ─── budget_categories + budget_entries ───────────────────────
    const [groceriesRow] = await tx
      .insert(budgetCategories)
      .values({
        userId,
        name: 'Groceries (Demo)',
        type: 'EXPENSE',
        sortOrder: 9001,
        isActive: true,
      })
      .returning({ id: budgetCategories.id });
    tally('budget_categories', 1);
    const groceriesId = groceriesRow!.id;

    const [utilitiesRow] = await tx
      .insert(budgetCategories)
      .values({
        userId,
        name: 'Utilities (Demo)',
        type: 'EXPENSE',
        sortOrder: 9002,
        isActive: true,
      })
      .returning({ id: budgetCategories.id });
    tally('budget_categories', 1);
    const utilitiesId = utilitiesRow!.id;

    const monthsFY = [
      { m: 4, y: 2025 }, { m: 5, y: 2025 }, { m: 6, y: 2025 },
      { m: 7, y: 2025 }, { m: 8, y: 2025 }, { m: 9, y: 2025 },
      { m: 10, y: 2025 }, { m: 11, y: 2025 }, { m: 12, y: 2025 },
      { m: 1, y: 2026 }, { m: 2, y: 2026 }, { m: 3, y: 2026 },
    ];
    for (let i = 0; i < monthsFY.length; i++) {
      const { m, y } = monthsFY[i];
      const period = `${String(m).padStart(2, '0')}${y}`;
      const variance = ((i * 37) % 41) / 100 - 0.2;
      const groceries = Math.round(rs(15_000) * (1 + variance));
      const utilities = Math.round(rs(4_500) * (1 - variance));
      await tx.insert(budgetEntries).values({
        userId,
        categoryId: groceriesId,
        period,
        plannedAmount: rs(15_000),
        actualAmount: groceries,
        notes: NOTE('budget-groceries-' + period),
      });
      tally('budget_entries', 1);
      await tx.insert(budgetEntries).values({
        userId,
        categoryId: utilitiesId,
        period,
        plannedAmount: rs(4_500),
        actualAmount: utilities,
        notes: NOTE('budget-utilities-' + period),
      });
      tally('budget_entries', 1);
    }

    // ─── financial_goals ──────────────────────────────────────────
    type GoalRow = {
      name: string;
      target: number;
      tdate: string;
      goalType: 'EDUCATION' | 'HOUSE' | 'OTHER';
      disb: 'LUMPSUM' | 'INFLATION_SWP' | 'FIXED_PERIOD_SWP';
      growthPct?: number;
      disbAmountPerYr?: number;
      disbYears?: number;
      disbStart?: string;
    };
    const goals: GoalRow[] = [
      {
        name: "Daughter's higher education",
        target: lakh(50),
        tdate: '2032-12-31',
        goalType: 'EDUCATION',
        disb: 'LUMPSUM',
      },
      {
        name: 'Retirement corpus',
        target: cr(5),
        tdate: '2045-12-31',
        goalType: 'OTHER',
        disb: 'INFLATION_SWP',
        growthPct: 6,
        disbAmountPerYr: lakh(15),
        disbYears: 30,
        disbStart: '2046-01-01',
      },
      {
        name: 'House upgrade',
        target: lakh(40),
        tdate: '2030-12-31',
        goalType: 'HOUSE',
        disb: 'LUMPSUM',
      },
    ];
    for (const g of goals) {
      await tx.insert(financialGoals).values({
        userId,
        name: g.name,
        targetAmount: g.target,
        targetDate: g.tdate,
        currentAmount: 0,
        color: '#10b981',
        isActive: true,
        goalType: g.goalType,
        disbursementType: g.disb,
        disbursementAmountPerYrPaisa: g.disbAmountPerYr ?? null,
        disbursementYears: g.disbYears ?? null,
        disbursementStartDate: g.disbStart ?? null,
        growthPctPerYr: g.growthPct ?? 0,
        expectedReturnPct: 10,
        inflationPct: 6,
      });
      tally('financial_goals', 1);
    }

    // ─── itr_form_selection ───────────────────────────────────────
    const wizardAnswers = {
      hasSalary: true,
      numHouseProperties: 3,
      hasCapitalGains: true,
      hasBusinessIncome: false,
      hasPresumptive: false,
      hasForeignIncome: false,
      hasOtherSources: true,
      totalIncomePaisa:
        grossSalary + rs(35_000) + rs(85_000) + rs(15_000),
    };
    await tx.insert(itrFormSelection).values({
      userId,
      fy: FY,
      selectedForm: 'ITR-2',
      wizardAnswers,
      reasoning:
        'Multiple house properties (3) + capital gains require ITR-2 (ITR-1 caps at 1 property and no capital gains).',
    });
    tally('itr_form_selection', 1);
  });

  return {
    inserted,
    total: Object.values(inserted).reduce((s, n) => s + n, 0),
  };
}
