import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import { db, taxDocuments } from '@/db';
import { auth } from '@/auth';

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
  return NextResponse.json({ document: row[0] });
}

export async function DELETE(
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
  try {
    const abs = path.resolve(process.cwd(), row[0].filePath);
    await fs.promises.unlink(abs).catch(() => {});
  } catch {
    // ignore file delete errors
  }
  await db.delete(taxDocuments).where(and(eq(taxDocuments.id, Number(id)), eq(taxDocuments.userId, session.user.id)));
  return NextResponse.json({ ok: true });
}
