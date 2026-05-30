import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import { db, taxDocuments } from '@/db';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const row = await db
    .select()
    .from(taxDocuments)
    .where(eq(taxDocuments.id, Number(id)))
    .limit(1);
  if (row.length === 0) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const doc = row[0];
  const abs = path.resolve(process.cwd(), doc.filePath);
  if (!fs.existsSync(abs)) {
    return NextResponse.json({ error: 'file missing on disk' }, { status: 410 });
  }
  const buffer = await fs.promises.readFile(abs);
  const bytes = new Uint8Array(buffer);
  return new NextResponse(bytes, {
    headers: {
      'Content-Type': doc.mimeType || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${doc.fileName || 'document'}"`,
      'Content-Length': String(buffer.length),
    },
  });
}
