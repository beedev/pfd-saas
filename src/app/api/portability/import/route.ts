/**
 * Sprint 6.4c — POST /api/portability/import (preview step).
 *
 * Accepts a multipart upload with a single `file` field (the JSON
 * produced by the matching GET /api/portability/export). Validates the
 * envelope (version, schemaHash, structure) plus every row's column
 * types, persists it to `uploads/<userId>/portability/<importId>.json`
 * (userId-first per the repo upload convention), then returns a diff
 * summary the UI uses to surface what would be wiped and reinserted.
 *
 * NO database writes happen here — those are deferred to the confirm
 * endpoint after the user types "REPLACE".
 *
 * Storage convention mirrors `src/app/api/imports/yeswanth-taxcalc/`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { sql, eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db } from '@/db';
import { validateExport } from '@/lib/portability/import-validate';
import { MANIFEST } from '@/lib/portability/table-manifest';

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const UPLOAD_ROOT = path.join(process.cwd(), 'uploads');

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  const userId = session.user.id;

  let form: FormData;
  try {
    form = await request.formData();
  } catch (err) {
    console.error('[portability/import] bad form:', err);
    return NextResponse.json({ error: 'Expected multipart/form-data with a "file" field.' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file field required' }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'Empty file.' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File exceeds ${MAX_BYTES / 1024 / 1024} MB limit.` },
      { status: 413 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let json: unknown;
  try {
    json = JSON.parse(buffer.toString('utf8'));
  } catch (err) {
    return NextResponse.json(
      { error: 'File is not valid JSON.', detail: err instanceof Error ? err.message : 'parse error' },
      { status: 400 },
    );
  }

  const validation = validateExport(json);
  if (!validation.ok || !validation.data) {
    return NextResponse.json({ error: 'Validation failed', errors: validation.errors }, { status: 400 });
  }
  const payload = validation.data;

  // Compute willInsert counts from the payload.
  const willInsert: Record<string, number> = {};
  for (const spec of MANIFEST) {
    const entry = payload.data.find((t) => t.table === spec.tableName);
    willInsert[spec.tableName] = entry ? entry.rows.length : 0;
  }

  // Compute willDelete counts from the live DB for this user.
  const willDelete: Record<string, number> = {};
  for (const spec of MANIFEST) {
    const tbl = spec.drizzleTable as unknown as { userId: unknown };
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(spec.drizzleTable)
      .where(eq(tbl.userId as never, userId));
    willDelete[spec.tableName] = rows[0]?.n ?? 0;
  }

  // Persist the upload for confirm step (userId-first layout:
  // uploads/<userId>/portability/<importId>.json).
  const userDir = path.join(UPLOAD_ROOT, userId, 'portability');
  await fs.mkdir(userDir, { recursive: true });
  const importId = crypto.randomBytes(16).toString('hex');
  const filePath = path.join(userDir, `${importId}.json`);
  await fs.writeFile(filePath, buffer);

  const totalWillDelete = Object.values(willDelete).reduce((s, n) => s + n, 0);
  const totalWillInsert = Object.values(willInsert).reduce((s, n) => s + n, 0);

  return NextResponse.json({
    importId,
    willDelete,
    willInsert,
    totalWillDelete,
    totalWillInsert,
    // Unknown keys are stripped (not errors) — surfaced so the user
    // knows some fields in the file were ignored.
    strippedUnknownKeys: validation.strippedUnknownKeys ?? {},
    totalStrippedKeys: validation.totalStrippedKeys ?? 0,
    exportedAt: payload.exportedAt,
    version: payload.version,
  });
}
