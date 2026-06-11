/**
 * POST /api/investments/import/commit
 *
 * Body shape:
 *   { type: 'lic',  data: LicCommitData,  options?: LicCommitOptions }
 *   { type: 'chit', data: ChitCommitData, options?: ChitCommitOptions }
 *   { type: 'mf-sip', data: ... } (not yet implemented)
 *
 * Dispatches to the right writer based on `type`. Each writer is responsible
 * for idempotent UPSERT into its destination table(s).
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import {
  db,
  insurancePolicies,
  chitFunds,
  capitalGains,
  epfAccounts,
  npsAccounts,
  type PolicyType,
  type CapGainAssetType,
  type HoldingPeriod,
} from '@/db';
import { auth } from '@/auth';
import type {
  LicPaymentMode,
  ChitParsed,
  CgStatementRow,
  EpfPassbookData,
  NpsSotData,
} from '@/lib/services/statement-parsers';
import { calculateChitXirrFromSummary } from '@/lib/finance/chit-xirr';

export const runtime = 'nodejs';

/* ─── LIC commit ──────────────────────────────────────────────────────── */

interface LicImportRow {
  policyNumber: string;
  policyHolder: string;
  startDate: string;
  paymentMode: LicPaymentMode;
  premiumPerInstallmentPaisa: number;
  annualPremiumPaisa: number;
  nextDueDate: string;
  lastDueTo?: string;
  totalPaidPaisa: number;
  totalGstPaisa: number;
}

interface LicCommitBody {
  type: 'lic';
  data: {
    policies: LicImportRow[];
    statementYear?: string;
    defaultPolicyType?: PolicyType;
  };
}

const MODE_TO_FREQUENCY: Record<LicPaymentMode, string> = {
  Mly: 'MONTHLY',
  Qly: 'QUARTERLY',
  Hly: 'HALF_YEARLY',
  Yly: 'YEARLY',
  Sly: 'SINGLE',
};

const VALID_POLICY_TYPES: PolicyType[] = [
  'TERM_LIFE',
  'WHOLE_LIFE',
  'ENDOWMENT',
  'ULIP',
  'HEALTH',
  'CRITICAL_ILLNESS',
  'DISABILITY',
  'ACCIDENT',
];

async function commitLic(body: LicCommitBody, userId: string) {
  const rows = body.data.policies;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('policies array is required and must be non-empty');
  }
  const defaultType: PolicyType =
    body.data.defaultPolicyType && VALID_POLICY_TYPES.includes(body.data.defaultPolicyType)
      ? body.data.defaultPolicyType
      : 'ENDOWMENT';

  let inserted = 0;
  let updated = 0;
  const errors: Array<{ key: string; error: string }> = [];

  for (const row of rows) {
    try {
      if (!row.policyNumber || !row.policyHolder || !row.startDate) {
        throw new Error('missing policyNumber / policyHolder / startDate');
      }
      const frequency = MODE_TO_FREQUENCY[row.paymentMode] ?? 'YEARLY';
      const importNote = body.data.statementYear
        ? `LIC import ${body.data.statementYear}: paid ₹${(row.totalPaidPaisa / 100).toFixed(0)}`
        : `LIC import: paid ₹${(row.totalPaidPaisa / 100).toFixed(0)}`;

      const existing = await db
        .select({ id: insurancePolicies.id, notes: insurancePolicies.notes })
        .from(insurancePolicies)
        .where(and(eq(insurancePolicies.policyNumber, row.policyNumber), eq(insurancePolicies.userId, userId)))
        .limit(1);

      if (existing[0]) {
        const prevNotes = existing[0].notes ?? '';
        const mergedNotes = prevNotes.includes(importNote)
          ? prevNotes
          : [prevNotes, importNote].filter(Boolean).join(' · ');

        await db
          .update(insurancePolicies)
          .set({
            premiumAmount: row.premiumPerInstallmentPaisa,
            premiumFrequency: frequency,
            nextPremiumDueDate: row.nextDueDate,
            lastPremiumPaidDate: row.lastDueTo ?? null,
            notes: mergedNotes || null,
            updatedAt: new Date(),
          })
          .where(and(eq(insurancePolicies.id, existing[0].id), eq(insurancePolicies.userId, userId)));
        updated++;
      } else {
        await db.insert(insurancePolicies).values({
          userId,
          policyNumber: row.policyNumber,
          policyType: defaultType,
          status: 'ACTIVE',
          policyHolder: row.policyHolder,
          insurer: 'LIC',
          insurerCode: 'LIC',
          sumAssured: 0,
          premiumAmount: row.premiumPerInstallmentPaisa,
          premiumFrequency: frequency,
          policyStartDate: row.startDate,
          nextPremiumDueDate: row.nextDueDate,
          lastPremiumPaidDate: row.lastDueTo ?? null,
          notes: `${importNote} · Imported from LIC PDF — set sum assured manually`,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        inserted++;
      }
    } catch (err) {
      errors.push({
        key: row.policyNumber || '(unknown)',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { inserted, updated, errors };
}

/* ─── Chit commit ─────────────────────────────────────────────────────── */

interface ChitCommitBody {
  type: 'chit';
  data: ChitParsed;
}

async function commitChit(body: ChitCommitBody, userId: string) {
  const c = body.data;
  if (!c.foremanName || !c.schemeName || !c.startDate || !c.expectedEndDate) {
    throw new Error('chit is missing required fields (foremanName / schemeName / startDate / expectedEndDate)');
  }

  // Match by (foremanName, schemeName, ticketNumber)
  const existing = await db
    .select({ id: chitFunds.id, notes: chitFunds.notes })
    .from(chitFunds)
    .where(
      and(
        eq(chitFunds.userId, userId),
        eq(chitFunds.foremanName, c.foremanName),
        eq(chitFunds.schemeName, c.schemeName),
        c.ticketNumber
          ? eq(chitFunds.ticketNumber, c.ticketNumber)
          : eq(chitFunds.schemeName, c.schemeName)
      )
    )
    .limit(1);

  const importNote = c.reportDate
    ? `Imported from PDF (statement dated ${c.reportDate})`
    : 'Imported from chit PDF';

  // Compute XIRR from summary state — assumes win at face value on the last
  // installment date (worst case). Real XIRR will be higher if dividends
  // accumulate or the user wins earlier.
  const computedXirr = calculateChitXirrFromSummary({
    startDate: c.startDate,
    expectedEndDate: c.expectedEndDate,
    durationMonths: c.durationMonths,
    installmentsPaid: c.installmentsPaid,
    monthlyInstallmentPaisa: c.monthlyInstallmentPaisa,
    totalPaidPaisa: c.totalPaidPaisa,
    chitValuePaisa: c.chitValuePaisa,
    status: c.status,
  });

  if (existing[0]) {
    const prevNotes = existing[0].notes ?? '';
    const mergedNotes = prevNotes.includes('Imported from')
      ? prevNotes
      : [prevNotes, importNote].filter(Boolean).join(' · ');

    await db
      .update(chitFunds)
      .set({
        installmentsPaid: c.installmentsPaid,
        totalPaid: c.totalPaidPaisa,
        totalDividends: c.totalDividendsPaisa,
        netContribution: c.netContributionPaisa,
        nextDueDate: c.nextDueDate,
        status: c.status,
        xirr: computedXirr,
        notes: mergedNotes || null,
        updatedAt: new Date(),
      })
      .where(and(eq(chitFunds.id, existing[0].id), eq(chitFunds.userId, userId)));
    return { inserted: 0, updated: 1, chitId: existing[0].id, xirr: computedXirr };
  }

  const inserted = await db
    .insert(chitFunds)
    .values({
      userId,
      foremanName: c.foremanName,
      schemeName: c.schemeName,
      registrationNumber: c.registrationNumber,
      isRegistered: c.isRegistered,
      chitValue: c.chitValuePaisa,
      monthlyInstallment: c.monthlyInstallmentPaisa,
      durationMonths: c.durationMonths,
      groupSize: c.groupSize,
      ticketNumber: c.ticketNumber,
      startDate: c.startDate,
      expectedEndDate: c.expectedEndDate,
      foremanCommissionPct: 5,
      installmentsPaid: c.installmentsPaid,
      totalPaid: c.totalPaidPaisa,
      totalDividends: c.totalDividendsPaisa,
      netContribution: c.netContributionPaisa,
      status: c.status,
      nextDueDate: c.nextDueDate,
      xirr: computedXirr,
      notes: [
        importNote,
        c.subscriberName ? `Subscriber: ${c.subscriberName}` : null,
        c.branch ? `Branch: ${c.branch}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning({ id: chitFunds.id });

  return { inserted: 1, updated: 0, chitId: inserted[0].id, xirr: computedXirr };
}

/* ─── Capital-gains commit ────────────────────────────────────────────── */

interface CgCommitBody {
  type: 'cg-statement';
  fy: string;
  rows: CgStatementRow[];
}

const FY_RE = /^\d{4}-\d{2}$/;

/**
 * Map a cg-statement assetType string onto a valid CapGainAssetType.
 * The cg parsers emit EQUITY / EQUITY_MF / DEBT / DEBT_MF; the schema's
 * union has no plain EQUITY/DEBT, so direct equity → STOCKS and bare
 * DEBT → DEBT_MF (closest valid). Anything unrecognised → OTHER.
 */
function mapCapGainAssetType(raw: string): CapGainAssetType {
  switch (raw.toUpperCase()) {
    case 'EQUITY':
      return 'STOCKS';
    case 'EQUITY_MF':
      return 'EQUITY_MF';
    case 'DEBT':
    case 'DEBT_MF':
      return 'DEBT_MF';
    case 'STOCKS':
    case 'GOLD':
    case 'REAL_ESTATE':
      return raw.toUpperCase() as CapGainAssetType;
    default:
      return 'OTHER';
  }
}

/** Whether a mapped asset class is taxed as equity (STT-paid) capital gains. */
function isEquityClass(assetType: CapGainAssetType): boolean {
  return assetType === 'STOCKS' || assetType === 'EQUITY_MF';
}

/**
 * Per-(assetType, holdingPeriod) display tax rate (%). The authoritative
 * netting + sec-112A exemption happens in the aggregate engine
 * (capital-gains-tax.ts) — these are per-row estimates only.
 *   • equity LTCG (112A) → 12.5%
 *   • equity STCG (111A) → 20%
 *   • debt/other LTCG    → 12.5%
 *   • debt/other STCG    → 0% (taxed at slab; not modelled per-row)
 */
function displayTaxRate(assetType: CapGainAssetType, holdingPeriod: HoldingPeriod): number {
  const equity = isEquityClass(assetType);
  if (holdingPeriod === 'LTCG') return 12.5;
  // STCG
  return equity ? 20 : 0;
}

async function commitCgStatement(body: CgCommitBody, userId: string) {
  const fy = body.fy;
  if (!fy || !FY_RE.test(fy)) {
    throw new Error('fy is required and must match YYYY-YY (e.g. 2025-26)');
  }
  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    throw new Error('rows array is required and must be non-empty');
  }

  const fallbackSaleDate = `${Number(fy.slice(0, 4)) + 1}-03-31`;

  const values = body.rows.map((row) => {
    const assetType = mapCapGainAssetType(row.assetType);
    const holdingPeriod = row.holdingPeriod;
    const capitalGain = row.capitalGainPaisa;
    // Only the net gain is known from a summary statement — synthesise a
    // purchase/sale pair so salePrice − purchasePrice === capitalGain, both ≥0.
    const purchasePrice = capitalGain >= 0 ? 0 : -capitalGain;
    const salePrice = capitalGain >= 0 ? capitalGain : 0;
    const taxableGain = Math.max(0, capitalGain);
    const taxRate = displayTaxRate(assetType, holdingPeriod);
    const taxAmount = Math.round((taxableGain * taxRate) / 100);

    return {
      userId,
      financialYear: fy,
      assetType,
      assetName: row.scrip || 'Capital gains (imported)',
      saleDate: row.saleDate || fallbackSaleDate,
      purchasePrice,
      salePrice,
      capitalGain,
      holdingPeriod,
      taxableGain,
      taxRate,
      taxAmount,
      notes: 'Imported from capital-gains statement',
    };
  });

  await db.transaction(async (tx) => {
    await tx.insert(capitalGains).values(values);
  });

  return { inserted: values.length };
}

/* ─── EPF passbook commit ─────────────────────────────────────────────── */

interface EpfPassbookCommitBody {
  type: 'epf-passbook';
  data: EpfPassbookData;
}

/** Today as an ISO yyyy-mm-dd string. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Insert (or update) a single EPF account from a parsed passbook.
 *
 * The passbook gives employee + employer closing balances; it does NOT
 * give a separate "total contributed" figure, so we estimate
 * `totalContributed` as the sum of the two shares (best available).
 *
 * Respects the `epf_account_number_unique` (userId, accountNumber) index:
 * when an `accountNumber` (member id) is present and a row already exists,
 * we UPDATE it instead of inserting a duplicate. When `accountNumber` is
 * null the unique index does not bind a second null the same way, so we
 * fall back to a plain insert.
 */
async function commitEpfPassbook(body: EpfPassbookCommitBody, userId: string) {
  const d = body.data;
  const employee = d.employeeBalancePaisa ?? 0;
  const employer = d.employerBalancePaisa ?? 0;
  const total = employee + employer;
  const accountNumber = d.memberId ?? null;
  const openingDate = d.asOfDate || todayIso();

  const baseValues = {
    accountType: 'EPF' as const,
    accountHolder: d.employerName || 'EPF account',
    universalAccountNumber: d.uan ?? null,
    accountNumber,
    employeeBalance: employee,
    employerBalance: employer,
    totalBalance: total,
    totalContributed: total,
    monthlyContributionPaisa: d.monthlyContributionPaisa ?? 0,
    openingDate,
    lastContributionDate: d.asOfDate ?? null,
    notes: 'Imported from EPF passbook',
    userId,
  };

  // If we have a member id, honour the (userId, accountNumber) uniqueness.
  if (accountNumber) {
    const existing = await db
      .select({ id: epfAccounts.id })
      .from(epfAccounts)
      .where(and(eq(epfAccounts.userId, userId), eq(epfAccounts.accountNumber, accountNumber)))
      .limit(1);

    if (existing[0]) {
      await db
        .update(epfAccounts)
        .set({
          accountHolder: baseValues.accountHolder,
          universalAccountNumber: baseValues.universalAccountNumber,
          employeeBalance: baseValues.employeeBalance,
          employerBalance: baseValues.employerBalance,
          totalBalance: baseValues.totalBalance,
          totalContributed: baseValues.totalContributed,
          monthlyContributionPaisa: baseValues.monthlyContributionPaisa,
          lastContributionDate: baseValues.lastContributionDate,
          notes: baseValues.notes,
          updatedAt: new Date(),
        })
        .where(and(eq(epfAccounts.id, existing[0].id), eq(epfAccounts.userId, userId)));
      return { type: 'epf-passbook', inserted: 0, updated: 1 };
    }
  }

  await db.insert(epfAccounts).values({
    ...baseValues,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return { type: 'epf-passbook', inserted: 1 };
}

/* ─── NPS Statement-of-Transactions commit ────────────────────────────── */

interface NpsSotCommitBody {
  type: 'nps-sot';
  data: NpsSotData;
}

/**
 * Insert a single NPS account from a parsed Statement of Transactions.
 *
 * `npsAccounts` requires accountNumber (PRAN), accountHolder, pan, tier,
 * totalValue, totalContributed, monthlyContributionPaisa and openingDate
 * (all notNull). The SoT carries no PAN, so `pan` is placeholdered with
 * 'UNKNOWN' and a warning is surfaced to the caller. PRAN missing → a
 * clear placeholder so the notNull constraint holds.
 */
async function commitNpsSot(body: NpsSotCommitBody, userId: string) {
  const d = body.data;
  const warnings: string[] = [];

  const accountNumber = d.pran || `NPS-${todayIso()}`;
  if (!d.pran) warnings.push('PRAN missing from statement — used a placeholder account number.');

  // pan is notNull on npsAccounts; the SoT has none.
  const pan = 'UNKNOWN';
  warnings.push('PAN not present in NPS statement — set it manually on the account.');

  await db.insert(npsAccounts).values({
    accountNumber,
    accountHolder: d.subscriberName || 'NPS subscriber',
    pan,
    tier: d.tier || 'TIER1',
    equityFundValue: d.equityFundValuePaisa ?? 0,
    debtFundValue: d.debtFundValuePaisa ?? 0,
    alternativeFundValue: d.alternativeFundValuePaisa ?? 0,
    totalValue: d.totalValuePaisa ?? 0,
    totalContributed: d.totalContributedPaisa ?? 0,
    monthlyContributionPaisa: d.monthlyContributionPaisa ?? 0,
    openingDate: d.asOfDate || todayIso(),
    notes: 'Imported from NPS Statement of Transactions',
    userId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return { type: 'nps-sot', inserted: 1, warnings };
}

/* ─── dispatcher ──────────────────────────────────────────────────────── */

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const body = (await request.json()) as
      | LicCommitBody
      | ChitCommitBody
      | CgCommitBody
      | EpfPassbookCommitBody
      | NpsSotCommitBody
      | { type: 'mf-sip' };

    if (!body || !('type' in body)) {
      return NextResponse.json({ error: 'type is required' }, { status: 400 });
    }

    switch (body.type) {
      case 'lic': {
        const result = await commitLic(body, session.user.id);
        return NextResponse.json({ type: 'lic', ...result });
      }
      case 'chit': {
        const result = await commitChit(body, session.user.id);
        return NextResponse.json({ type: 'chit', ...result });
      }
      case 'cg-statement': {
        const result = await commitCgStatement(body, session.user.id);
        return NextResponse.json({ type: 'cg-statement', ...result });
      }
      case 'epf-passbook': {
        const result = await commitEpfPassbook(body, session.user.id);
        return NextResponse.json(result);
      }
      case 'nps-sot': {
        const result = await commitNpsSot(body, session.user.id);
        return NextResponse.json(result);
      }
      case 'mf-sip':
        return NextResponse.json(
          { error: 'MF SIP import is not yet implemented' },
          { status: 501 }
        );
      default:
        return NextResponse.json({ error: `Unknown import type` }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to commit import';
    console.error('Statement import commit failed:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
