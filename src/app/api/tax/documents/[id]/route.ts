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
  return NextResponse.json({ document: row[0] });
}

export async function DELETE(
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
  try {
    const abs = path.resolve(process.cwd(), row[0].filePath);
    await fs.promises.unlink(abs).catch(() => {});
  } catch {
    // ignore file delete errors
  }
  await db.delete(taxDocuments).where(eq(taxDocuments.id, Number(id)));
  return NextResponse.json({ ok: true });
}
