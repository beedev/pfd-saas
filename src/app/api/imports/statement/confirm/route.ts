/**
 * POST /api/imports/statement/confirm
 *
 * Sprint 5.6d — commit a previewed EPF / NPS statement import.
 *
 * Body:
 *   {
 *     importId:  string,               // from the prior preview POST
 *     mappings:  {
 *       balance?:      boolean,        // apply parsed balances
 *       contribution?: boolean,        // apply parsed monthly contribution
 *       transactions?: boolean         // (reserved — not yet wired)
 *     },
 *     accountId?: number,               // explicit override when auto-match
 *                                       // returned null on the preview
 *     kind:      'EPF_PASSBOOK' | 'NPS_SOT'
 *   }
 *
 * Re-reads the persisted PDF from
 *   uploads/<user_id>/statement-imports/<importId>.pdf
 * and re-runs the parser. Idempotent: re-calling with the same
 * importId + mappings replays the same writes (same DB state).
 *
 * Multi-tenant: the importId must resolve to a file under THIS user's
 * dir; otherwise 404. Update query is also scoped by userId.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { db, epfAccounts, npsAccounts } from '@/db';
import { auth } from '@/auth';
import { parseStatement } from '@/lib/services/statement-parsers';
import type { EpfPassbookData, NpsSotData } from '@/lib/services/statement-parsers/types';

export const runtime = 'nodejs';

/** userId-first per convention — MUST mirror ../route.ts, which writes
 *  the file this endpoint re-reads. */
const uploadDirFor = (userId: string) =>
  path.join(process.cwd(), 'uploads', userId, 'statement-imports');

interface Body {
  importId?: string;
  kind?: 'EPF_PASSBOOK' | 'NPS_SOT';
  accountId?: number;
  mappings?: {
    balance?: boolean;
    contribution?: boolean;
    transactions?: boolean;
  };
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  const userId = session.user.id;

  try {
    const body = (await request.json()) as Body;
    if (!body.importId || typeof body.importId !== 'string') {
      return NextResponse.json({ error: 'importId is required' }, { status: 400 });
    }
    if (body.kind !== 'EPF_PASSBOOK' && body.kind !== 'NPS_SOT') {
      return NextResponse.json({ error: 'kind must be EPF_PASSBOOK or NPS_SOT' }, { status: 400 });
    }
    const mappings = body.mappings ?? {};

    // Re-read the persisted file. Path is scoped by userId — another
    // user's importId can't be read here.
    const filePath = path.join(uploadDirFor(userId), `${body.importId}.pdf`);
    let buf: Buffer;
    try {
      buf = await readFile(filePath);
    } catch {
      return NextResponse.json({ error: 'Import not found or expired' }, { status: 404 });
    }

    const { parsed } = await parseStatement(buf);

    if (body.kind === 'EPF_PASSBOOK' && parsed.type === 'epf-passbook') {
      return await commitEpf(userId, parsed.data, mappings, body.accountId);
    }
    if (body.kind === 'NPS_SOT' && parsed.type === 'nps-sot') {
      return await commitNps(userId, parsed.data, mappings, body.accountId);
    }

    return NextResponse.json(
      { error: 'Parsed type does not match the kind sent. Re-preview the file.' },
      { status: 409 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to confirm import';
    console.error('[imports/statement/confirm POST]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function commitEpf(
  userId: string,
  data: EpfPassbookData,
  mappings: NonNullable<Body['mappings']>,
  accountId?: number,
) {
  // Find target account: explicit override > UAN > sole account.
  let target: typeof epfAccounts.$inferSelect | null = null;
  if (typeof accountId === 'number') {
    const row = await db
      .select()
      .from(epfAccounts)
      .where(and(eq(epfAccounts.id, accountId), eq(epfAccounts.userId, userId)))
      .limit(1);
    if (row[0]) target = row[0];
  } else {
    const rows = await db.select().from(epfAccounts).where(eq(epfAccounts.userId, userId));
    if (data.uan) {
      target = rows.find((r) => r.universalAccountNumber === data.uan) ?? null;
    }
    if (!target && rows.length === 1) target = rows[0];
  }
  if (!target) {
    return NextResponse.json(
      { error: 'No matching EPF account — pass accountId to link explicitly.' },
      { status: 404 },
    );
  }

  const update: Partial<typeof epfAccounts.$inferInsert> = { updatedAt: new Date() };
  if (mappings.balance) {
    update.employeeBalance = data.employeeBalancePaisa;
    update.employerBalance = data.employerBalancePaisa;
    update.totalBalance =
      data.employeeBalancePaisa + data.employerBalancePaisa + data.pensionBalancePaisa;
    if (data.asOfDate) update.lastContributionDate = data.asOfDate;
  }
  if (mappings.contribution && data.monthlyContributionPaisa !== null) {
    update.monthlyContributionPaisa = data.monthlyContributionPaisa;
  }

  await db
    .update(epfAccounts)
    .set(update)
    .where(and(eq(epfAccounts.id, target.id), eq(epfAccounts.userId, userId)));

  return NextResponse.json({
    ok: true,
    accountId: target.id,
    appliedFields: Object.keys(update).filter((k) => k !== 'updatedAt'),
  });
}

async function commitNps(
  userId: string,
  data: NpsSotData,
  mappings: NonNullable<Body['mappings']>,
  accountId?: number,
) {
  let target: typeof npsAccounts.$inferSelect | null = null;
  if (typeof accountId === 'number') {
    const row = await db
      .select()
      .from(npsAccounts)
      .where(and(eq(npsAccounts.id, accountId), eq(npsAccounts.userId, userId)))
      .limit(1);
    if (row[0]) target = row[0];
  } else {
    const rows = await db.select().from(npsAccounts).where(eq(npsAccounts.userId, userId));
    if (data.pran) {
      target =
        rows.find((r) => r.subscriberId === data.pran || r.accountNumber === data.pran) ?? null;
    }
    if (!target && data.tier) {
      const inTier = rows.filter((r) => r.tier === data.tier);
      if (inTier.length === 1) target = inTier[0];
    }
    if (!target && rows.length === 1) target = rows[0];
  }
  if (!target) {
    return NextResponse.json(
      { error: 'No matching NPS account — pass accountId to link explicitly.' },
      { status: 404 },
    );
  }

  const update: Partial<typeof npsAccounts.$inferInsert> = { updatedAt: new Date() };
  if (mappings.balance) {
    update.equityFundValue = data.equityFundValuePaisa;
    update.debtFundValue = data.debtFundValuePaisa;
    update.alternativeFundValue = data.alternativeFundValuePaisa;
    update.totalValue = data.totalValuePaisa;
    if (data.totalContributedPaisa > 0) update.totalContributed = data.totalContributedPaisa;
    if (data.asOfDate) update.lastStatementDate = data.asOfDate;
  }
  if (mappings.contribution && data.monthlyContributionPaisa !== null) {
    update.monthlyContributionPaisa = data.monthlyContributionPaisa;
  }

  await db
    .update(npsAccounts)
    .set(update)
    .where(and(eq(npsAccounts.id, target.id), eq(npsAccounts.userId, userId)));

  return NextResponse.json({
    ok: true,
    accountId: target.id,
    appliedFields: Object.keys(update).filter((k) => k !== 'updatedAt'),
  });
}
