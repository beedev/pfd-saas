import { NextRequest, NextResponse } from 'next/server';
import { db, budgetCategories, budgetEntries, creditCardExpenses, liabilities, investmentTransactions, chitFundInstallments } from '@/db';
import { eq, and, gte, lte, lt, asc, sql } from 'drizzle-orm';

type CardStatus = 'paid' | 'unpaid' | 'partial';

function periodToDateRange(period: string): [string, string] {
  const month = parseInt(period.substring(0, 2), 10);
  const year = parseInt(period.substring(2, 6), 10);
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const to = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
  return [from, to];
}

function deriveStatus(actual: number, planned: number): CardStatus | null {
  if (planned <= 0 && actual <= 0) return null;
  if (planned > 0 && actual === 0) return 'unpaid';
  if (actual >= planned) return 'paid';
  return 'partial';
}

// GET - Get budget entries for a period range
// Query params: from (MMYYYY), to (MMYYYY)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    // Get all active categories first
    const categories = await db
      .select()
      .from(budgetCategories)
      .where(eq(budgetCategories.isActive, true))
      .orderBy(asc(budgetCategories.type), asc(budgetCategories.sortOrder));

    // Get budget entries with optional period filter
    let entriesQuery = db
      .select({
        id: budgetEntries.id,
        categoryId: budgetEntries.categoryId,
        period: budgetEntries.period,
        plannedAmount: budgetEntries.plannedAmount,
        actualAmount: budgetEntries.actualAmount,
        notes: budgetEntries.notes,
      })
      .from(budgetEntries);

    if (from && to) {
      entriesQuery = entriesQuery.where(
        and(
          gte(budgetEntries.period, from),
          lte(budgetEntries.period, to)
        )
      ) as typeof entriesQuery;
    }

    const entries = await entriesQuery;

    // Create a map of entries by categoryId-period
    const entriesMap: Record<string, typeof entries[0]> = {};
    entries.forEach(entry => {
      entriesMap[`${entry.categoryId}-${entry.period}`] = entry;
    });

    // Credit-card payment status per (period, card-name)
    // Used by the budget UI to color rows: amber=unpaid, emerald=paid, partial=partial
    const ccConditions = from && to
      ? and(
          eq(liabilities.type, 'CREDIT_CARD'),
          gte(creditCardExpenses.period, from),
          lte(creditCardExpenses.period, to),
        )
      : eq(liabilities.type, 'CREDIT_CARD');

    const ccRows = await db
      .select({
        name: liabilities.name,
        period: creditCardExpenses.period,
        amount: creditCardExpenses.amount,
        paidAmount: creditCardExpenses.paidAmount,
      })
      .from(creditCardExpenses)
      .innerJoin(liabilities, eq(liabilities.id, creditCardExpenses.liabilityId))
      .where(ccConditions);
    const cardStatuses: Record<string, Record<string, CardStatus>> = {};
    for (const row of ccRows) {
      let status: CardStatus;
      if (row.paidAmount == null) status = 'unpaid';
      else if (row.paidAmount >= row.amount) status = 'paid';
      else status = 'partial';
      if (!cardStatuses[row.period]) cardStatuses[row.period] = {};
      cardStatuses[row.period][row.name] = status;
    }

    // SIP / Chit / manual statuses, computed per period in the requested range.
    // SIP actuals = SUM(SIP_EXECUTION) for the month
    // Chit actuals = SUM(installment_paid) for the month
    // Manual actuals = budget_entries.actual_amount (Option C — user marks paid by entering an actual)
    const expenseStatuses: Record<string, Record<string, CardStatus>> = {};
    const periodsInRange: string[] = [];
    if (from && to) {
      // Build list of periods from..to inclusive. MMYYYY isn't lex-orderable
      // across year boundaries, so step month-by-month and compare numeric
      // (year*100 + month) instead.
      const periodKey = (p: string) =>
        parseInt(p.substring(2, 6), 10) * 100 + parseInt(p.substring(0, 2), 10);
      const toKey = periodKey(to);
      let cur = from;
      let safety = 0;
      while (periodKey(cur) <= toKey && safety < 36) {
        periodsInRange.push(cur);
        const m = parseInt(cur.substring(0, 2), 10);
        const y = parseInt(cur.substring(2, 6), 10);
        const nm = m === 12 ? 1 : m + 1;
        const ny = m === 12 ? y + 1 : y;
        cur = `${String(nm).padStart(2, '0')}${ny}`;
        safety += 1;
      }
    }

    for (const p of periodsInRange) {
      const [fromDate, toDate] = periodToDateRange(p);

      const sipRow = await db
        .select({ total: sql<number>`COALESCE(SUM(${investmentTransactions.amount}), 0)` })
        .from(investmentTransactions)
        .where(
          and(
            eq(investmentTransactions.type, 'SIP_EXECUTION'),
            gte(investmentTransactions.transactionDate, fromDate),
            lt(investmentTransactions.transactionDate, toDate),
          ),
        );
      const sipActual = Number(sipRow[0]?.total ?? 0);

      const chitRow = await db
        .select({ total: sql<number>`COALESCE(SUM(${chitFundInstallments.installmentPaid}), 0)` })
        .from(chitFundInstallments)
        .where(
          and(
            gte(chitFundInstallments.paidOn, fromDate),
            lt(chitFundInstallments.paidOn, toDate),
          ),
        );
      const chitActual = Number(chitRow[0]?.total ?? 0);

      // Find the SIP & Chit category planned amounts for this period
      const sipCat = categories.find((c) => c.name === 'SIP');
      const chitCat = categories.find((c) => c.name === 'Chit');
      const sipPlanned = entries.find((e) => e.categoryId === sipCat?.id && e.period === p)?.plannedAmount ?? 0;
      const chitPlanned = entries.find((e) => e.categoryId === chitCat?.id && e.period === p)?.plannedAmount ?? 0;

      if (!expenseStatuses[p]) expenseStatuses[p] = {};
      const sipStatus = deriveStatus(sipActual, sipPlanned);
      if (sipStatus) expenseStatuses[p]['SIP'] = sipStatus;
      const chitStatus = deriveStatus(chitActual, chitPlanned);
      if (chitStatus) expenseStatuses[p]['Chit'] = chitStatus;

      // Manual categories — derive from actualAmount on each entry for this period
      const ccCategoryNames = new Set(
        ccRows.filter((r) => r.period === p).map((r) => r.name),
      );
      for (const cat of categories) {
        if (cat.type !== 'EXPENSE') continue;
        if (cat.name === 'SIP' || cat.name === 'Chit') continue;
        if (ccCategoryNames.has(cat.name)) continue;
        const e = entries.find((x) => x.categoryId === cat.id && x.period === p);
        const planned = e?.plannedAmount ?? 0;
        const actual = e?.actualAmount ?? 0;
        // Manual category quirk: today's sync sets actual = planned. So plain
        // Option C ('actual > 0 → paid') would mark everything paid. To avoid
        // confusing visuals before users start using the Monthly page, we only
        // show 'paid' when actual is explicitly different from 0.
        const status = deriveStatus(actual, planned);
        if (status) expenseStatuses[p][cat.name] = status;
      }
    }

    // Merge cardStatuses into expenseStatuses (CC takes precedence)
    for (const p of Object.keys(cardStatuses)) {
      if (!expenseStatuses[p]) expenseStatuses[p] = {};
      for (const name of Object.keys(cardStatuses[p])) {
        expenseStatuses[p][name] = cardStatuses[p][name];
      }
    }

    return NextResponse.json({
      categories,
      entries,
      entriesMap,
      cardStatuses: expenseStatuses,  // unified — CC + SIP + Chit + manual
    });
  } catch (error) {
    console.error('Error fetching budget:', error);
    return NextResponse.json(
      { error: 'Failed to fetch budget data' },
      { status: 500 }
    );
  }
}

// POST - Create or update budget entry
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { categoryId, period, plannedAmount, actualAmount, notes } = body;

    if (!categoryId || !period) {
      return NextResponse.json(
        { error: 'categoryId and period are required' },
        { status: 400 }
      );
    }

    // Check if entry exists
    const existing = await db
      .select()
      .from(budgetEntries)
      .where(
        and(
          eq(budgetEntries.categoryId, categoryId),
          eq(budgetEntries.period, period)
        )
      );

    let result;
    if (existing.length > 0) {
      // Update existing
      result = await db
        .update(budgetEntries)
        .set({
          plannedAmount: plannedAmount ?? existing[0].plannedAmount,
          actualAmount: actualAmount ?? existing[0].actualAmount,
          notes: notes !== undefined ? notes : existing[0].notes,
          updatedAt: new Date(),
        })
        .where(eq(budgetEntries.id, existing[0].id))
        .returning();
    } else {
      // Create new
      result = await db.insert(budgetEntries).values({
        categoryId,
        period,
        plannedAmount: plannedAmount ?? 0,
        actualAmount: actualAmount ?? 0,
        notes: notes ?? null,
      }).returning();
    }

    return NextResponse.json({ entry: result[0] }, { status: existing.length > 0 ? 200 : 201 });
  } catch (error) {
    console.error('Error saving budget entry:', error);
    return NextResponse.json(
      { error: 'Failed to save budget entry' },
      { status: 500 }
    );
  }
}

// PUT - Bulk update budget entries
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { entries } = body;

    if (!Array.isArray(entries)) {
      return NextResponse.json(
        { error: 'entries array is required' },
        { status: 400 }
      );
    }

    const results = [];

    for (const entry of entries) {
      const { categoryId, period, plannedAmount, actualAmount, notes } = entry;

      if (!categoryId || !period) continue;

      // Check if entry exists
      const existing = await db
        .select()
        .from(budgetEntries)
        .where(
          and(
            eq(budgetEntries.categoryId, categoryId),
            eq(budgetEntries.period, period)
          )
        );

      let result;
      if (existing.length > 0) {
        result = await db
          .update(budgetEntries)
          .set({
            plannedAmount: plannedAmount ?? existing[0].plannedAmount,
            actualAmount: actualAmount ?? existing[0].actualAmount,
            notes: notes !== undefined ? notes : existing[0].notes,
            updatedAt: new Date(),
          })
          .where(eq(budgetEntries.id, existing[0].id))
          .returning();
      } else {
        result = await db.insert(budgetEntries).values({
          categoryId,
          period,
          plannedAmount: plannedAmount ?? 0,
          actualAmount: actualAmount ?? 0,
          notes: notes ?? null,
        }).returning();
      }

      results.push(result[0]);
    }

    return NextResponse.json({ entries: results });
  } catch (error) {
    console.error('Error bulk updating budget:', error);
    return NextResponse.json(
      { error: 'Failed to update budget entries' },
      { status: 500 }
    );
  }
}
