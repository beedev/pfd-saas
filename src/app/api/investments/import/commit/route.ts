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
  type PolicyType,
} from '@/db';
import { auth } from '@/auth';
import type {
  LicPaymentMode,
  ChitParsed,
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

/* ─── dispatcher ──────────────────────────────────────────────────────── */

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const body = (await request.json()) as
      | LicCommitBody
      | ChitCommitBody
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
