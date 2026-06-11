/**
 * POST /api/investments/import/parse
 *
 * Multipart upload of any supported statement PDF. Auto-detects type
 * (or honours `type` form field as a hint), parses, returns the structured
 * preview as JSON. For LIC, also annotates each policy with `existingId`
 * so the UI can show "new" vs "update". For chit, annotates with the matching
 * existing chit row id (if any).
 *
 * Does NOT write anything. The user reviews in the wizard, then POSTs to
 * /import/commit to actually persist.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { db, insurancePolicies, chitFunds } from '@/db';
import { auth } from '@/auth';
import { parseStatement, parseZerodhaTaxPnl, type DocType } from '@/lib/services/statement-parsers';

export const runtime = 'nodejs';

const MAX_BYTES = 5 * 1024 * 1024;
const VALID_HINTS: DocType[] = ['lic', 'chit', 'mf-sip'];

/** Detect a Zerodha tax-P&L spreadsheet upload by file name / mime type. */
function isXlsxUpload(file: File): boolean {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return true;
  return /spreadsheet|excel/i.test(file.type);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const form = await request.formData();
    const file = form.get('file');
    const hint = form.get('type');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No PDF file uploaded under "file"' }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'Uploaded file is empty' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `File too large (max ${MAX_BYTES / 1024 / 1024} MB)` },
        { status: 413 }
      );
    }

    const hintType: DocType | undefined =
      typeof hint === 'string' && VALID_HINTS.includes(hint as DocType)
        ? (hint as DocType)
        : undefined;

    const buf = Buffer.from(await file.arrayBuffer());

    // Zerodha tax-P&L is an .xlsx — parsed via exceljs, not the PDF-text path.
    if (isXlsxUpload(file)) {
      const parsed = await parseZerodhaTaxPnl(buf);
      return NextResponse.json({
        detectedType: 'cg-statement',
        resolvedType: 'cg-statement',
        parsed,
      });
    }

    const { detectedType, resolvedType, parsed } = await parseStatement(buf, hintType);

    // Annotate existing rows so the UI can highlight upserts
    let annotated: unknown = parsed;

    if (parsed.type === 'lic' && parsed.policies.length > 0) {
      const numbers = parsed.policies.map((p) => p.policyNumber);
      const existing = await db
        .select({
          policyNumber: insurancePolicies.policyNumber,
          id: insurancePolicies.id,
        })
        .from(insurancePolicies)
        .where(and(inArray(insurancePolicies.policyNumber, numbers), eq(insurancePolicies.userId, session.user.id)));
      const map = new Map(existing.map((r) => [r.policyNumber, r.id]));
      annotated = {
        ...parsed,
        policies: parsed.policies.map((p) => ({
          ...p,
          existingId: map.get(p.policyNumber) ?? null,
        })),
      };
    }

    if (parsed.type === 'chit') {
      // Match by (foremanName, schemeName, ticketNumber) — these together
      // uniquely identify a subscriber's chit ticket.
      const matches = await db
        .select({ id: chitFunds.id })
        .from(chitFunds)
        .where(
          and(
            eq(chitFunds.userId, session.user.id),
            eq(chitFunds.foremanName, parsed.foremanName),
            eq(chitFunds.schemeName, parsed.schemeName),
            parsed.ticketNumber
              ? eq(chitFunds.ticketNumber, parsed.ticketNumber)
              : eq(chitFunds.schemeName, parsed.schemeName)
          )
        )
        .limit(1);
      annotated = {
        ...parsed,
        existingId: matches[0]?.id ?? null,
      };
    }

    return NextResponse.json({
      detectedType,
      resolvedType,
      parsed: annotated,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to parse PDF';
    console.error('Statement import parse failed:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
