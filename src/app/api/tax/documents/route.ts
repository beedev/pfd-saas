import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, like } from 'drizzle-orm';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { db, taxDocuments } from '@/db';
import { getCurrentFinancialYear } from '@/lib/finance/tax-constants';
import { auth } from '@/auth';

const MAX_BYTES = 25 * 1024 * 1024;
// Extension → MIME pairs accepted for tax document uploads. The stored
// extension is always taken from this allowlist, never from raw input.
const ALLOWED_TYPES: Array<{ ext: string; mime: string }> = [
  { ext: '.pdf', mime: 'application/pdf' },
  { ext: '.jpg', mime: 'image/jpeg' },
  { ext: '.jpeg', mime: 'image/jpeg' },
  { ext: '.png', mime: 'image/png' },
  { ext: '.webp', mime: 'image/webp' },
];

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const fy = searchParams.get('fy') || searchParams.get('financialYear');
  const category = searchParams.get('category');
  const search = searchParams.get('search');
  const deductionId = searchParams.get('deductionId');

  try {
    const conds = [eq(taxDocuments.userId, session.user.id)] as ReturnType<typeof eq>[];
    if (fy) conds.push(eq(taxDocuments.financialYear, fy));
    if (category) conds.push(eq(taxDocuments.category, category));
    if (deductionId) conds.push(eq(taxDocuments.deductionId, Number(deductionId)));
    if (search) conds.push(like(taxDocuments.title, `%${search}%`));
    const rows = await db
      .select()
      .from(taxDocuments)
      .where(and(...conds))
      .orderBy(desc(taxDocuments.uploadedAt));
    return NextResponse.json({ documents: rows });
  } catch (err) {
    console.error('[tax/documents GET]', err);
    return NextResponse.json({ error: 'Failed to fetch documents' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'file is required' }, { status: 400 });

    const category = (formData.get('category') as string) || 'OTHER';
    const financialYear = (formData.get('financialYear') as string) || getCurrentFinancialYear();
    if (!/^\d{4}-\d{2}$/.test(financialYear)) {
      return NextResponse.json({ error: 'invalid financialYear' }, { status: 400 });
    }
    const title = (formData.get('title') as string) || file.name;
    const deductionIdRaw = formData.get('deductionId');
    const deductionId = deductionIdRaw ? Number(deductionIdRaw) : null;
    const notes = (formData.get('notes') as string) || null;

    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `File too large (max ${MAX_BYTES / 1024 / 1024} MB)` },
        { status: 413 },
      );
    }
    const rawExt = path.extname(file.name).toLowerCase();
    const allowed = ALLOWED_TYPES.find((t) => t.ext === rawExt && t.mime === file.type);
    if (!allowed) {
      return NextResponse.json(
        { error: 'Unsupported file type. Allowed: .pdf, .jpg, .jpeg, .png, .webp' },
        { status: 400 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const ext = allowed.ext;

    const safeCategory = category.replace(/[^A-Z0-9_]/gi, '_');
    // Tenant-folder-first, matching the form-16 / migration-0037 convention.
    const dir = path.join(process.cwd(), 'uploads', session.user.id, 'finance', financialYear, safeCategory);
    await fs.promises.mkdir(dir, { recursive: true });
    const absPath = path.join(dir, `${hash}${ext}`);
    await fs.promises.writeFile(absPath, buffer);
    const relPath = path.relative(process.cwd(), absPath);

    const result = await db
      .insert(taxDocuments)
      .values({
        userId: session.user.id,
        name: title,
        type: 'OTHER',
        fileSize: buffer.length,
        fileName: file.name,
        filePath: relPath,
        mimeType: allowed.mime,
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
