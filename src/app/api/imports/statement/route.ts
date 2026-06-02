/**
 * POST /api/imports/statement
 *
 * Sprint 5.6d — generic EPF / NPS statement import endpoint.
 *
 * Accepts a multipart `file` field (PDF, max 5 MB). Detects the
 * document type, parses it, persists the raw PDF under
 *   uploads/statement-imports/<user_id>/<timestamp>.pdf
 * so the user can re-confirm a previous parse (idempotency without a
 * DB table). Returns:
 *   {
 *     importId:        string  // timestamp-based identifier
 *     kind:            'EPF_PASSBOOK' | 'NPS_SOT' | 'UNKNOWN'
 *     confidence:      'HIGH' | 'MEDIUM' | 'LOW'
 *     preview:         <parsed-data>
 *     currentValues:   <matched-asset-rows>
 *     diff:            [{ field, currentValue, newValue }]
 *     warnings:        string[]
 *   }
 *
 * Match logic for diff:
 *   • EPF: match by UAN if present, else by employer_name, else by
 *     the user's only EPF account if exactly one exists.
 *   • NPS: match by PRAN if present, else by tier if exactly one
 *     account in that tier exists.
 *
 * Multi-tenant: every operation scoped by session.user.id. Other
 * users' uploads can't be confirmed because the importId path
 * encodes the user.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { db, epfAccounts, npsAccounts } from '@/db';
import { auth } from '@/auth';
import { parseStatement, type DocType } from '@/lib/services/statement-parsers';
import type { EpfPassbookData, NpsSotData } from '@/lib/services/statement-parsers/types';

export const runtime = 'nodejs';

const MAX_BYTES = 5 * 1024 * 1024;
const UPLOAD_ROOT = path.join(process.cwd(), 'uploads', 'statement-imports');

type StatementKind = 'EPF_PASSBOOK' | 'NPS_SOT' | 'UNKNOWN';

function kindFromDocType(t: DocType): StatementKind {
  if (t === 'epf-passbook') return 'EPF_PASSBOOK';
  if (t === 'nps-sot') return 'NPS_SOT';
  return 'UNKNOWN';
}

interface DiffEntry {
  field: string;
  currentValue: unknown;
  newValue: unknown;
}

function diffEpf(parsed: EpfPassbookData, current: typeof epfAccounts.$inferSelect | null): DiffEntry[] {
  if (!current) return [];
  const out: DiffEntry[] = [];
  // Map paisa to paisa comparisons — UI surfaces this exactly.
  const fields: Array<[string, unknown, unknown]> = [
    ['employeeBalance', current.employeeBalance ?? 0, parsed.employeeBalancePaisa],
    ['employerBalance', current.employerBalance ?? 0, parsed.employerBalancePaisa],
    [
      'totalBalance',
      current.totalBalance,
      parsed.employeeBalancePaisa + parsed.employerBalancePaisa + parsed.pensionBalancePaisa,
    ],
    ['monthlyContributionPaisa', current.monthlyContributionPaisa ?? 0, parsed.monthlyContributionPaisa ?? 0],
  ];
  for (const [f, cur, nv] of fields) {
    if (cur !== nv) out.push({ field: f, currentValue: cur, newValue: nv });
  }
  return out;
}

function diffNps(parsed: NpsSotData, current: typeof npsAccounts.$inferSelect | null): DiffEntry[] {
  if (!current) return [];
  const out: DiffEntry[] = [];
  const fields: Array<[string, unknown, unknown]> = [
    ['equityFundValue', current.equityFundValue ?? 0, parsed.equityFundValuePaisa],
    ['debtFundValue', current.debtFundValue ?? 0, parsed.debtFundValuePaisa],
    ['alternativeFundValue', current.alternativeFundValue ?? 0, parsed.alternativeFundValuePaisa],
    ['totalValue', current.totalValue, parsed.totalValuePaisa],
    ['totalContributed', current.totalContributed, parsed.totalContributedPaisa],
    ['monthlyContributionPaisa', current.monthlyContributionPaisa ?? 0, parsed.monthlyContributionPaisa ?? 0],
  ];
  for (const [f, cur, nv] of fields) {
    if (cur !== nv) out.push({ field: f, currentValue: cur, newValue: nv });
  }
  return out;
}

/**
 * Find the EPF account that the parsed statement applies to.
 *
 * Priority:
 *   1. exact UAN match
 *   2. employer name match
 *   3. user's only EPF account (when count === 1)
 *   4. null — UI prompts user to link manually.
 */
async function matchEpfAccount(
  userId: string,
  data: EpfPassbookData,
): Promise<typeof epfAccounts.$inferSelect | null> {
  const userAccounts = await db
    .select()
    .from(epfAccounts)
    .where(eq(epfAccounts.userId, userId));

  if (data.uan) {
    const byUan = userAccounts.find((a) => a.universalAccountNumber === data.uan);
    if (byUan) return byUan;
  }
  if (data.employerName) {
    // We don't store employerName on epfAccounts directly; if the notes
    // or accountHolder includes it, match heuristically.
    const norm = data.employerName.toLowerCase();
    const byEmployer = userAccounts.find(
      (a) =>
        a.accountHolder.toLowerCase().includes(norm) ||
        (a.notes ?? '').toLowerCase().includes(norm),
    );
    if (byEmployer) return byEmployer;
  }
  if (userAccounts.length === 1) return userAccounts[0];
  return null;
}

async function matchNpsAccount(
  userId: string,
  data: NpsSotData,
): Promise<typeof npsAccounts.$inferSelect | null> {
  const userAccounts = await db
    .select()
    .from(npsAccounts)
    .where(eq(npsAccounts.userId, userId));

  if (data.pran) {
    // PRAN is stored on subscriberId in some seeds, on accountNumber in
    // others — check both.
    const byPran = userAccounts.find(
      (a) => a.subscriberId === data.pran || a.accountNumber === data.pran,
    );
    if (byPran) return byPran;
  }
  if (data.tier) {
    const inTier = userAccounts.filter((a) => a.tier === data.tier);
    if (inTier.length === 1) return inTier[0];
  }
  if (userAccounts.length === 1) return userAccounts[0];
  return null;
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  const userId = session.user.id;

  try {
    const form = await request.formData();
    const file = form.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No PDF file uploaded under "file"' }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'Uploaded file is empty' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `File too large (max ${MAX_BYTES / 1024 / 1024} MB)` },
        { status: 413 },
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const { resolvedType, parsed } = await parseStatement(buf);
    const kind = kindFromDocType(resolvedType);

    // Persist the raw PDF under per-user dir, named by timestamp.
    // The timestamp is the importId — re-confirms hit the same file.
    const importId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const userDir = path.join(UPLOAD_ROOT, userId);
    await mkdir(userDir, { recursive: true });
    await writeFile(path.join(userDir, `${importId}.pdf`), buf);

    if (parsed.type === 'epf-passbook') {
      const match = await matchEpfAccount(userId, parsed.data);
      return NextResponse.json({
        importId,
        kind,
        confidence: parsed.confidence,
        preview: parsed.data,
        currentValues: match,
        diff: diffEpf(parsed.data, match),
        warnings: parsed.warnings,
      });
    }
    if (parsed.type === 'nps-sot') {
      const match = await matchNpsAccount(userId, parsed.data);
      return NextResponse.json({
        importId,
        kind,
        confidence: parsed.confidence,
        preview: parsed.data,
        currentValues: match,
        diff: diffNps(parsed.data, match),
        warnings: parsed.warnings,
      });
    }

    // UNKNOWN — still return cleanly with the importId so the UI can
    // surface the warnings to the user. Sprint 5.6f verification leans
    // on this code path.
    return NextResponse.json({
      importId,
      kind: 'UNKNOWN' satisfies StatementKind,
      confidence: 'LOW',
      preview: null,
      currentValues: null,
      diff: [],
      warnings: parsed.type === 'unknown' ? parsed.warnings : [],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to parse statement';
    console.error('[imports/statement POST]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
