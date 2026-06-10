/**
 * POST /api/imports/yeswanth-taxcalc — Sprint 5.1d.
 *
 * Upload a Yeswanth TaxCalc xlsx file, parse into a preview JSON
 * (NO database writes). The preview is returned plus an importId that
 * the confirm endpoint uses to retrieve the parsed payload again.
 *
 * Safety:
 *  • Auth-gated. Each upload stored under uploads/<userId>/
 *    yeswanth-imports/<timestamp>.xlsx (gitignored).
 *  • Strict MIME + 5 MB size cap.
 *  • Re-parsing the same file yields the same preview (deterministic).
 *  • Parsed contents are NOT logged.
 */

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { auth } from '@/auth';
import { parseYeswanthTaxCalc } from '@/lib/yeswanth-parser';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream', // some browsers
]);

/** userId-first per convention: uploads/<userId>/yeswanth-imports/.
 *  Keep in lockstep with ./confirm/route.ts, which reconstructs the
 *  same path from userId + importId. */
const uploadDirFor = (userId: string) =>
  path.join(process.cwd(), 'uploads', userId, 'yeswanth-imports');

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file field required' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'File exceeds 5 MB limit' }, { status: 400 });
    }
    if (file.type && !ALLOWED_MIME.has(file.type)) {
      return NextResponse.json({ error: `Unsupported MIME: ${file.type}` }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Parse FIRST — if the parser rejects, don't bother writing the file.
    let preview;
    try {
      preview = await parseYeswanthTaxCalc(buffer);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Parse error';
      return NextResponse.json({ error: message }, { status: 422 });
    }

    // Persist file for confirm endpoint to read back.
    const userDir = uploadDirFor(session.user.id);
    await fs.mkdir(userDir, { recursive: true });
    const importId = crypto.randomBytes(16).toString('hex');
    const filePath = path.join(userDir, `${importId}.xlsx`);
    await fs.writeFile(filePath, buffer);

    return NextResponse.json({
      importId,
      preview,
    });
  } catch (err) {
    console.error('[imports/yeswanth-taxcalc POST]', err);
    return NextResponse.json({ error: 'Failed to upload' }, { status: 500 });
  }
}
