import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import { db, taxDocuments } from '@/db';
import { auth } from '@/auth';

// Only ever serve MIME types we know are safe to hand to a browser —
// anything else (including legacy stored values) downgrades to a binary
// download so a stored text/html can't become stored XSS.
const SAFE_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

/** Strip CR/LF, double-quotes, and path separators from the download name. */
function sanitizeFilename(name: string | null | undefined): string {
  return (name ?? '').replace(/[\r\n"\\/]/g, '').trim() || 'document';
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  const { id } = await params;
  const row = await db
    .select()
    .from(taxDocuments)
    .where(and(eq(taxDocuments.id, Number(id)), eq(taxDocuments.userId, session.user.id)))
    .limit(1);
  if (row.length === 0) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const doc = row[0];
  const abs = path.resolve(process.cwd(), doc.filePath);
  if (!fs.existsSync(abs)) {
    return NextResponse.json({ error: 'file missing on disk' }, { status: 410 });
  }
  const buffer = await fs.promises.readFile(abs);
  const bytes = new Uint8Array(buffer);
  const contentType =
    doc.mimeType && SAFE_MIME_TYPES.has(doc.mimeType) ? doc.mimeType : 'application/octet-stream';
  return new NextResponse(bytes, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${sanitizeFilename(doc.fileName)}"`,
      'Content-Length': String(buffer.length),
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
