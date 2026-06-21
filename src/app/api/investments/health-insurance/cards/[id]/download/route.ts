/**
 * Stream the card image for a single health-insurance card.
 *
 * Auth-gated: the caller MUST own the card (card.userId === userId).
 * Returns 404 if the card row doesn't exist or 410 (gone) if the row
 * exists but the underlying file disappeared from disk — that pair
 * tells the UI exactly what went wrong.
 *
 * Card metadata doesn't store a mime type (the column doesn't exist),
 * so we infer it from the file extension. Anything we don't know
 * falls back to application/octet-stream — the browser will offer
 * a download rather than try to render it.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import { db, healthInsuranceCards } from '@/db';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    const rows = await db
      .select()
      .from(healthInsuranceCards)
      .where(
        and(eq(healthInsuranceCards.id, numericId), eq(healthInsuranceCards.userId, userId)),
      )
      .limit(1);
    if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const card = rows[0];
    if (!card.cardImagePath) {
      return NextResponse.json({ error: 'No image uploaded for this card' }, { status: 404 });
    }
    const abs = path.resolve(process.cwd(), card.cardImagePath);
    if (!fs.existsSync(abs)) {
      return NextResponse.json({ error: 'file missing on disk' }, { status: 410 });
    }

    const buffer = await fs.promises.readFile(abs);
    const ext = path.extname(abs).toLowerCase();
    const mimeType = MIME_BY_EXT[ext] || 'application/octet-stream';
    const fileName = `card-${card.id}${ext}`;
    const bytes = new Uint8Array(buffer);

    return new NextResponse(bytes, {
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `inline; filename="${fileName}"`,
        'Content-Length': String(buffer.length),
      },
    });
  } catch (err) {
    console.error('[health-insurance/cards/:id/download GET]', err);
    return NextResponse.json({ error: 'Failed to download card image' }, { status: 500 });
  }
}
