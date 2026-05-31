import { NextRequest, NextResponse } from 'next/server';
import { db, budgetCategories } from '@/db';
import { and, asc, eq } from 'drizzle-orm';
import { auth } from '@/auth';

// GET - List all budget categories
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const categories = await db
      .select()
      .from(budgetCategories)
      .where(and(eq(budgetCategories.isActive, true), eq(budgetCategories.userId, session.user.id)))
      .orderBy(asc(budgetCategories.type), asc(budgetCategories.sortOrder));

    return NextResponse.json({ categories });
  } catch (error) {
    console.error('Error fetching categories:', error);
    return NextResponse.json(
      { error: 'Failed to fetch categories' },
      { status: 500 }
    );
  }
}

// POST - Create new category
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const body = await request.json();
    const { name, type, sortOrder } = body;

    if (!name || !type) {
      return NextResponse.json(
        { error: 'Name and type are required' },
        { status: 400 }
      );
    }

    if (!['INCOME', 'EXPENSE'].includes(type)) {
      return NextResponse.json(
        { error: 'Type must be INCOME or EXPENSE' },
        { status: 400 }
      );
    }

    const result = await db.insert(budgetCategories).values({
      userId: session.user.id,
      name,
      type,
      sortOrder: sortOrder ?? 0,
      isActive: true,
    }).returning();

    return NextResponse.json({ category: result[0] }, { status: 201 });
  } catch (error) {
    console.error('Error creating category:', error);
    return NextResponse.json(
      { error: 'Failed to create category' },
      { status: 500 }
    );
  }
}
