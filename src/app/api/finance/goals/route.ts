import { NextRequest, NextResponse } from 'next/server';
import { db, financialGoals, projectionCategories, carryforwardBalances, projectionEntries } from '@/db';
import { eq, and, gte, lte, asc, sum } from 'drizzle-orm';

// GET - Get all financial goals with progress calculation
export async function GET() {
  try {
    // Get all active goals
    const goals = await db
      .select()
      .from(financialGoals)
      .where(eq(financialGoals.isActive, true))
      .orderBy(asc(financialGoals.id));

    // Get projection categories linked to goals
    const linkedCategories = await db
      .select({
        goalId: projectionCategories.goalId,
        categoryId: projectionCategories.id,
        categoryName: projectionCategories.name,
        isInflow: projectionCategories.isInflow,
      })
      .from(projectionCategories)
      .where(eq(projectionCategories.isActive, true));

    // Get carryforward balances for linked categories
    const carryforwards = await db
      .select()
      .from(carryforwardBalances);

    // Get current period (MMYYYY format)
    const now = new Date();
    const currentPeriod = `${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getFullYear()}`;

    // Get total contributions from projection entries up to current period
    const contributions = await db
      .select({
        categoryId: projectionEntries.categoryId,
        totalAmount: sum(projectionEntries.amount),
      })
      .from(projectionEntries)
      .where(lte(projectionEntries.period, currentPeriod))
      .groupBy(projectionEntries.categoryId);

    // Build goal details with progress
    const goalDetails = goals.map(goal => {
      // Find categories linked to this goal
      const goalCategories = linkedCategories.filter(c => c.goalId === goal.id);

      // Calculate amounts:
      // - amountSaved: carryforward (money earmarked for this goal)
      // - amountFunded: actual spending from projection entries (past periods)
      let amountSaved = 0;
      let amountFunded = 0;

      goalCategories.forEach(cat => {
        const carryforward = carryforwards.find(c => c.categoryId === cat.categoryId);
        const contribution = contributions.find(c => c.categoryId === cat.categoryId);

        // Carryforward is money saved/allocated for this goal
        if (carryforward) {
          amountSaved += carryforward.amount;
        }

        // Contributions are actual funding events that have occurred
        if (contribution && contribution.totalAmount) {
          amountFunded += Number(contribution.totalAmount);
        }
      });

      // For goals, progress = amount actually funded / target
      // (NOT the saved amount - that's just money set aside)
      const currentAmount = amountFunded;

      // Calculate progress percentage
      const progress = goal.targetAmount > 0
        ? Math.min(100, Math.round((currentAmount / goal.targetAmount) * 100))
        : 0;

      // Calculate months remaining
      let monthsRemaining: number | null = null;
      if (goal.targetDate) {
        const targetDate = new Date(goal.targetDate);
        const monthsDiff = (targetDate.getFullYear() - now.getFullYear()) * 12
          + (targetDate.getMonth() - now.getMonth());
        monthsRemaining = Math.max(0, monthsDiff);
      }

      // Calculate required monthly to reach target
      const amountRemaining = Math.max(0, goal.targetAmount - currentAmount);
      const monthlyRequired = monthsRemaining && monthsRemaining > 0
        ? Math.round(amountRemaining / monthsRemaining)
        : null;

      return {
        ...goal,
        currentAmount,
        progress,
        monthsRemaining,
        monthlyRequired,
        linkedCategories: goalCategories.map(c => c.categoryName),
      };
    });

    return NextResponse.json({ goals: goalDetails });
  } catch (error) {
    console.error('Error fetching goals:', error);
    return NextResponse.json(
      { error: 'Failed to fetch goals' },
      { status: 500 }
    );
  }
}

// POST - Create a new financial goal
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, targetAmount, targetDate, color } = body;

    if (!name || !targetAmount) {
      return NextResponse.json(
        { error: 'Name and target amount are required' },
        { status: 400 }
      );
    }

    const [goal] = await db.insert(financialGoals).values({
      name,
      targetAmount,
      targetDate: targetDate || null,
      color: color || '#4CAF50',
      currentAmount: 0,
      isActive: true,
    }).returning();

    return NextResponse.json({ goal }, { status: 201 });
  } catch (error) {
    console.error('Error creating goal:', error);
    return NextResponse.json(
      { error: 'Failed to create goal' },
      { status: 500 }
    );
  }
}

// PUT - Update a financial goal
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, name, targetAmount, targetDate, color, currentAmount } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'Goal ID is required' },
        { status: 400 }
      );
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (targetAmount !== undefined) updateData.targetAmount = targetAmount;
    if (targetDate !== undefined) updateData.targetDate = targetDate;
    if (color !== undefined) updateData.color = color;
    if (currentAmount !== undefined) updateData.currentAmount = currentAmount;

    await db
      .update(financialGoals)
      .set(updateData)
      .where(eq(financialGoals.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating goal:', error);
    return NextResponse.json(
      { error: 'Failed to update goal' },
      { status: 500 }
    );
  }
}

// DELETE - Deactivate a financial goal
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'Goal ID is required' },
        { status: 400 }
      );
    }

    await db
      .update(financialGoals)
      .set({ isActive: false })
      .where(eq(financialGoals.id, parseInt(id)));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting goal:', error);
    return NextResponse.json(
      { error: 'Failed to delete goal' },
      { status: 500 }
    );
  }
}
