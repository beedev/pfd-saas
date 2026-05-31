/**
 * Upload (or replace) the card image for a health-insurance card.
 *
 * Multipart form-data, single field `file`. We sha256 the buffer and
 * use that hash as the on-disk filename so identical uploads dedupe
 * and the path never collides. Files live under
 *   uploads/health-cards/<userId>/<sha256>.<ext>
 * Path stored in the DB is RELATIVE to the project root so the
 * download endpoint can re-anchor it via process.cwd().
 *
 * Replacing a card image just overwrites the cardImagePath column —
 * we deliberately don't delete the old file because (a) other callers
 * may still hold the path and (b) hash-based filenames mean the new
 * upload won't have collided. Disk usage is bounded by the unique
 * hashes per user, not the number of upload events.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { db, healthInsuranceCards } from '@/db';
import { auth } from '@/auth';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    // Confirm the card exists and belongs to the caller BEFORE we
    // write anything to disk — saves us cleanup pain on auth failures.
    const existing = await db
      .select()
      .from(healthInsuranceCards)
      .where(
        and(eq(healthInsuranceCards.id, numericId), eq(healthInsuranceCards.userId, session.user.id)),
      )
      .limit(1);
    if (!existing.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'file is required' }, { status: 400 });

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const ext = path.extname(file.name) || '';

    // Per-user directory so a security audit can scope blobs by owner
    // and so a future "delete account" operation can `rm -rf` cleanly.
    const dir = path.join(process.cwd(), 'uploads', 'health-cards', session.user.id);
    await fs.promises.mkdir(dir, { recursive: true });
    const absPath = path.join(dir, `${hash}${ext}`);
    await fs.promises.writeFile(absPath, buffer);
    const relPath = path.relative(process.cwd(), absPath);

    await db
      .update(healthInsuranceCards)
      .set({ cardImagePath: relPath, updatedAt: new Date() })
      .where(
        and(eq(healthInsuranceCards.id, numericId), eq(healthInsuranceCards.userId, session.user.id)),
      );

    return NextResponse.json({ cardImagePath: relPath, sizeBytes: buffer.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upload failed';
    console.error('[health-insurance/cards/:id/upload POST]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
