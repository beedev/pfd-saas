import { NextRequest, NextResponse } from 'next/server';
import { db, projectionCategories, projectionEntries, carryforwardBalances, financialGoals } from '@/db';
import { eq, and, gte, lte, asc, desc, sum } from 'drizzle-orm';

// GET - Get all projection categories with their current amounts and carryforward
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const asOfPeriod = searchParams.get('asOf'); // MMYYYY format

    // Default to current period if not specified
    const now = new Date();
    const currentPeriod = asOfPeriod || `${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getFullYear()}`;

    // Get all active projection categories with goal info
    const categories = await db
      .select({
        id: projectionCategories.id,
        name: projectionCategories.name,
        isInflow: projectionCategories.isInflow,
        goalId: projectionCategories.goalId,
        sortOrder: projectionCategories.sortOrder,
      })
      .from(projectionCategories)
      .where(eq(projectionCategories.isActive, true))
      .orderBy(asc(projectionCategories.sortOrder));

    // Get carryforward balances
    const carryforwards = await db
      .select()
      .from(carryforwardBalances);

    // Get all entries for each category (for scheduled funding display)
    const allEntries = await db
      .select({
        categoryId: projectionEntries.categoryId,
        amount: projectionEntries.amount,
        period: projectionEntries.period,
      })
      .from(projectionEntries)
      .orderBy(asc(projectionEntries.period));

    // Helper to compare MMYYYY periods properly (returns true if a <= b)
    const isPeriodLte = (a: string, b: string): boolean => {
      const yearA = a.substring(2, 6);
      const monthA = a.substring(0, 2);
      const yearB = b.substring(2, 6);
      const monthB = b.substring(0, 2);
      if (yearA !== yearB) return yearA <= yearB;
      return monthA <= monthB;
    };

    // Calculate cumulative amounts up to the as-of period for each category
    // (Using in-memory calculation to avoid MMYYYY string comparison issues)
    const cumulativeAmounts = new Map<number, number>();
    allEntries.forEach(entry => {
      if (isPeriodLte(entry.period, currentPeriod)) {
        const current = cumulativeAmounts.get(entry.categoryId) || 0;
        cumulativeAmounts.set(entry.categoryId, current + entry.amount);
      }
    });

    // Get goals for linking
    const goals = await db
      .select()
      .from(financialGoals)
      .where(eq(financialGoals.isActive, true));

    // Build response with category details
    const categoryDetails = categories.map(cat => {
      const carryforward = carryforwards.find(c => c.categoryId === cat.id);
      const categoryEntries = allEntries.filter(e => e.categoryId === cat.id);
      const cumulativeAmount = cumulativeAmounts.get(cat.id) || 0;
      const goal = goals.find(g => g.id === cat.goalId);

      const carryforwardAmount = carryforward?.amount ?? 0;

      // For savings (inflows): balance = carryforward + cumulative contributions
      // For goals (outflows): balance = carryforward (what's allocated) - cumulative spent
      const asOfBalance = cat.isInflow
        ? carryforwardAmount + cumulativeAmount
        : carryforwardAmount; // Goals show their allocated amount

      // For savings: get current monthly amount (most recent entry)
      // For goals: get scheduled funding events (all future entries from asOf date)
      let monthlyAmount = 0;
      let scheduledFunding: { period: string; amount: number }[] = [];

      if (cat.isInflow) {
        // Savings: find the most recent entry as "monthly"
        const recentEntry = categoryEntries.length > 0
          ? categoryEntries[categoryEntries.length - 1]
          : null;
        monthlyAmount = recentEntry?.amount ?? 0;
      } else {
        // Goals: get all scheduled funding events (future entries), sorted by period
        // Helper to compare MMYYYY periods properly
        const comparePeriods = (a: string, b: string): number => {
          const yearA = a.substring(2, 6);
          const monthA = a.substring(0, 2);
          const yearB = b.substring(2, 6);
          const monthB = b.substring(0, 2);
          if (yearA !== yearB) return yearA.localeCompare(yearB);
          return monthA.localeCompare(monthB);
        };

        // Filter for future entries (period >= currentPeriod using proper date comparison)
        scheduledFunding = categoryEntries
          .filter(e => comparePeriods(e.period, currentPeriod) >= 0 && e.amount > 0)
          .map(e => ({ period: e.period, amount: e.amount }))
          .sort((a, b) => comparePeriods(a.period, b.period));

        // Also include total scheduled amount
        monthlyAmount = scheduledFunding.reduce((sum, e) => sum + e.amount, 0);
      }

      return {
        ...cat,
        monthlyAmount,
        carryforwardAmount,
        cumulativeAmount,
        asOfBalance,
        carryforwardDate: carryforward?.asOfDate ?? null,
        goalName: goal?.name ?? null,
        goalTargetAmount: goal?.targetAmount ?? null,
        scheduledFunding, // Array of {period, amount} for goals
      };
    });

    // Calculate summary totals
    const savings = categoryDetails.filter(c => c.isInflow);
    const goalCategories = categoryDetails.filter(c => !c.isInflow);

    const totalSavingsCarryforward = savings.reduce((sum, c) => sum + c.carryforwardAmount, 0);
    const totalSavingsCumulative = savings.reduce((sum, c) => sum + c.cumulativeAmount, 0);
    const totalSavingsBalance = totalSavingsCarryforward + totalSavingsCumulative;

    const totalGoalsAllocated = goalCategories.reduce((sum, c) => sum + c.carryforwardAmount, 0);
    const totalGoalsSpent = goalCategories.reduce((sum, c) => sum + c.cumulativeAmount, 0);

    // Net available = Total Savings - Goals Spent
    const netAvailable = totalSavingsBalance - totalGoalsSpent;

    // Calculate total goal targets from active financial goals
    const totalGoalTargets = goals.reduce((sum, g) => sum + g.targetAmount, 0);

    // Calculate coverage percentage
    const coveragePercent = totalGoalTargets > 0
      ? Math.round((totalSavingsBalance / totalGoalTargets) * 100)
      : 0;

    return NextResponse.json({
      categories: categoryDetails,
      goals,
      asOfPeriod: currentPeriod,
      summary: {
        totalSavingsCarryforward,
        totalSavingsCumulative,
        totalSavingsBalance,
        totalGoalsAllocated,
        totalGoalsSpent,
        netAvailable,
        monthlySavings: savings.reduce((sum, c) => sum + c.monthlyAmount, 0),
        totalScheduledFunding: goalCategories.reduce((sum, c) => sum + c.monthlyAmount, 0),
        totalGoalTargets,
        coveragePercent,
      },
    });
  } catch (error) {
    console.error('Error fetching projections:', error);
    return NextResponse.json(
      { error: 'Failed to fetch projections' },
      { status: 500 }
    );
  }
}

// POST - Create new projection category
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, isInflow, goalId, monthlyAmount, startPeriod, endPeriod } = body;

    if (!name) {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      );
    }

    // Create the category
    const [category] = await db.insert(projectionCategories).values({
      name,
      isInflow: isInflow ?? false,
      goalId: goalId ?? null,
      sortOrder: 0,
      isActive: true,
    }).returning();

    // If monthly amount provided, create entries for the period range
    if (monthlyAmount && startPeriod) {
      const entries = generateEntriesForPeriod(
        category.id,
        monthlyAmount,
        startPeriod,
        endPeriod || addMonths(startPeriod, 36) // Default 3 years
      );

      if (entries.length > 0) {
        await db.insert(projectionEntries).values(entries);
      }
    }

    return NextResponse.json({ category }, { status: 201 });
  } catch (error) {
    console.error('Error creating projection category:', error);
    return NextResponse.json(
      { error: 'Failed to create projection category' },
      { status: 500 }
    );
  }
}

// PUT - Update projection amount (retrospective or from date)
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { categoryId, newAmount, fromPeriod, updateType } = body;

    if (!categoryId || newAmount === undefined) {
      return NextResponse.json(
        { error: 'categoryId and newAmount are required' },
        { status: 400 }
      );
    }

    // Helper to compare periods properly
    const comparePeriods = (a: string, b: string): number => {
      const yearA = a.substring(2, 6);
      const monthA = a.substring(0, 2);
      const yearB = b.substring(2, 6);
      const monthB = b.substring(0, 2);
      if (yearA !== yearB) return yearA.localeCompare(yearB);
      return monthA.localeCompare(monthB);
    };

    if (updateType === 'all') {
      // Update all entries for this category (retrospective)
      await db
        .update(projectionEntries)
        .set({ amount: newAmount, updatedAt: new Date() })
        .where(eq(projectionEntries.categoryId, categoryId));
    } else if (updateType === 'from_date' && fromPeriod) {
      // Get existing entries for this category
      const existingEntries = await db
        .select({ period: projectionEntries.period })
        .from(projectionEntries)
        .where(eq(projectionEntries.categoryId, categoryId));

      const existingPeriods = new Set(existingEntries.map(e => e.period));

      // Determine end period (3 years from now or latest existing entry, whichever is later)
      const now = new Date();
      const threeYearsLater = new Date(now.getFullYear() + 3, now.getMonth(), 1);
      const defaultEndPeriod = `${(threeYearsLater.getMonth() + 1).toString().padStart(2, '0')}${threeYearsLater.getFullYear()}`;

      // Find the latest existing period
      let endPeriod = defaultEndPeriod;
      existingEntries.forEach(e => {
        if (comparePeriods(e.period, endPeriod) > 0) {
          endPeriod = e.period;
        }
      });

      // Generate all periods from fromPeriod to endPeriod
      const allPeriods = generatePeriodsInRange(fromPeriod, endPeriod);

      // Create entries for missing periods
      const newEntries = allPeriods
        .filter(period => !existingPeriods.has(period))
        .map(period => ({
          categoryId,
          period,
          amount: newAmount,
        }));

      if (newEntries.length > 0) {
        await db.insert(projectionEntries).values(newEntries);
      }

      // Update existing entries from the specified period onwards
      const periodsToUpdate = existingEntries
        .filter(e => comparePeriods(e.period, fromPeriod) >= 0)
        .map(e => e.period);

      if (periodsToUpdate.length > 0) {
        // Update each matching entry
        for (const period of periodsToUpdate) {
          await db
            .update(projectionEntries)
            .set({ amount: newAmount, updatedAt: new Date() })
            .where(
              and(
                eq(projectionEntries.categoryId, categoryId),
                eq(projectionEntries.period, period)
              )
            );
        }
      }
    } else {
      return NextResponse.json(
        { error: 'Invalid updateType. Use "all" or "from_date" with fromPeriod' },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating projection:', error);
    return NextResponse.json(
      { error: 'Failed to update projection' },
      { status: 500 }
    );
  }
}

// Helper to generate all periods in a range (using proper date comparison)
function generatePeriodsInRange(startPeriod: string, endPeriod: string): string[] {
  const periods: string[] = [];
  let current = startPeriod;

  const comparePeriods = (a: string, b: string): number => {
    const yearA = a.substring(2, 6);
    const monthA = a.substring(0, 2);
    const yearB = b.substring(2, 6);
    const monthB = b.substring(0, 2);
    if (yearA !== yearB) return yearA.localeCompare(yearB);
    return monthA.localeCompare(monthB);
  };

  while (comparePeriods(current, endPeriod) <= 0) {
    periods.push(current);
    current = addMonths(current, 1);
  }

  return periods;
}

// Helper to generate entries for a period range
function generateEntriesForPeriod(
  categoryId: number,
  amount: number,
  startPeriod: string,
  endPeriod: string
) {
  const entries: { categoryId: number; period: string; amount: number }[] = [];
  let current = startPeriod;

  while (current <= endPeriod) {
    entries.push({ categoryId, period: current, amount });
    current = addMonths(current, 1);
  }

  return entries;
}

// Helper to add months to MMYYYY period
function addMonths(period: string, months: number): string {
  const month = parseInt(period.substring(0, 2), 10);
  const year = parseInt(period.substring(2, 6), 10);

  const date = new Date(year, month - 1 + months, 1);
  const newMonth = (date.getMonth() + 1).toString().padStart(2, '0');
  const newYear = date.getFullYear().toString();

  return `${newMonth}${newYear}`;
}
