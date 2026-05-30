import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, like } from 'drizzle-orm';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { db, taxDocuments } from '@/db';
import { getCurrentFinancialYear } from '@/lib/finance/tax-constants';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const fy = searchParams.get('fy') || searchParams.get('financialYear');
  const category = searchParams.get('category');
  const search = searchParams.get('search');
  const deductionId = searchParams.get('deductionId');

  try {
    const conds = [] as ReturnType<typeof eq>[];
    if (fy) conds.push(eq(taxDocuments.financialYear, fy));
    if (category) conds.push(eq(taxDocuments.category, category));
    if (deductionId) conds.push(eq(taxDocuments.deductionId, Number(deductionId)));
    if (search) conds.push(like(taxDocuments.title, `%${search}%`));
    const rows = await db
      .select()
      .from(taxDocuments)
      .where(conds.length > 0 ? and(...conds) : undefined)
      .orderBy(desc(taxDocuments.uploadedAt));
    return NextResponse.json({ documents: rows });
  } catch (err) {
    console.error('[tax/documents GET]', err);
    return NextResponse.json({ error: 'Failed to fetch documents' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'file is required' }, { status: 400 });

    const category = (formData.get('category') as string) || 'OTHER';
    const financialYear = (formData.get('financialYear') as string) || getCurrentFinancialYear();
    const title = (formData.get('title') as string) || file.name;
    const deductionIdRaw = formData.get('deductionId');
    const deductionId = deductionIdRaw ? Number(deductionIdRaw) : null;
    const notes = (formData.get('notes') as string) || null;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const ext = path.extname(file.name) || '';

    const safeCategory = category.replace(/[^A-Z0-9_]/gi, '_');
    const dir = path.join(process.cwd(), 'uploads', 'finance', financialYear, safeCategory);
    await fs.promises.mkdir(dir, { recursive: true });
    const absPath = path.join(dir, `${hash}${ext}`);
    await fs.promises.writeFile(absPath, buffer);
    const relPath = path.relative(process.cwd(), absPath);

    const result = await db
      .insert(taxDocuments)
      .values({
        name: title,
        type: 'OTHER',
        fileSize: buffer.length,
        fileName: file.name,
        filePath: relPath,
        mimeType: file.type || 'application/octet-stream',
        financialYear,
        category,
        title,
        hashSha256: hash,
        deductionId,
        notes,
        uploadedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return NextResponse.json({ document: result[0] }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upload failed';
    console.error('[tax/documents POST]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
