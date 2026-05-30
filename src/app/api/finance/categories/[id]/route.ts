import { NextRequest, NextResponse } from 'next/server';
import { db, budgetCategories, budgetEntries } from '@/db';
import { eq } from 'drizzle-orm';

// GET - Get a single category
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const categoryId = parseInt(id, 10);

    if (isNaN(categoryId)) {
      return NextResponse.json(
        { error: 'Invalid category ID' },
        { status: 400 }
      );
    }

    const category = await db
      .select()
      .from(budgetCategories)
      .where(eq(budgetCategories.id, categoryId));

    if (category.length === 0) {
      return NextResponse.json(
        { error: 'Category not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ category: category[0] });
  } catch (error) {
    console.error('Error fetching category:', error);
    return NextResponse.json(
      { error: 'Failed to fetch category' },
      { status: 500 }
    );
  }
}

// PUT - Update a category
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const categoryId = parseInt(id, 10);

    if (isNaN(categoryId)) {
      return NextResponse.json(
        { error: 'Invalid category ID' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { name, type, sortOrder, isActive } = body;

    const result = await db
      .update(budgetCategories)
      .set({
        ...(name !== undefined && { name }),
        ...(type !== undefined && { type }),
        ...(sortOrder !== undefined && { sortOrder }),
        ...(isActive !== undefined && { isActive }),
      })
      .where(eq(budgetCategories.id, categoryId))
      .returning();

    if (result.length === 0) {
      return NextResponse.json(
        { error: 'Category not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ category: result[0] });
  } catch (error) {
    console.error('Error updating category:', error);
    return NextResponse.json(
      { error: 'Failed to update category' },
      { status: 500 }
    );
  }
}

// DELETE - Delete a category (soft delete by setting isActive=false, or hard delete)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const categoryId = parseInt(id, 10);

    if (isNaN(categoryId)) {
      return NextResponse.json(
        { error: 'Invalid category ID' },
        { status: 400 }
      );
    }

    // First delete all budget entries for this category
    await db
      .delete(budgetEntries)
      .where(eq(budgetEntries.categoryId, categoryId));

    // Then delete the category itself
    const result = await db
      .delete(budgetCategories)
      .where(eq(budgetCategories.id, categoryId))
      .returning();

    if (result.length === 0) {
      return NextResponse.json(
        { error: 'Category not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, deleted: result[0] });
  } catch (error) {
    console.error('Error deleting category:', error);
    return NextResponse.json(
      { error: 'Failed to delete category' },
      { status: 500 }
    );
  }
}
