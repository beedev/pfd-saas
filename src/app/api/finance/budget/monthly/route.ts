import { NextRequest, NextResponse } from 'next/server';
import { eq, and, gte, lt, sql, asc } from 'drizzle-orm';
import {
  db,
  budgetCategories,
  budgetEntries,
  recurringExpenses,
  creditCardExpenses,
  liabilities,
  investmentTransactions,
  chitFundInstallments,
} from '@/db';
import { auth } from '@/auth';

type RowStatus = 'paid' | 'unpaid' | 'partial';
type RowSource = 'cc' | 'sip' | 'chit' | 'manual';

interface MonthlyRow {
  categoryId: number;
  categoryName: string;
  categoryType: 'INCOME' | 'EXPENSE';
  plannedAmount: number;
  actualAmount: number;
  status: RowStatus | null;
  source: RowSource;
  recurringId: number | null;
  recurrence: string | null;
}

function periodToDateRange(period: string): [string, string] {
  const month = parseInt(period.substring(0, 2), 10);
  const year = parseInt(period.substring(2, 6), 10);
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const to = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
  return [from, to];
}

function deriveStatus(actual: number, planned: number): RowStatus | null {
  if (planned <= 0 && actual <= 0) return null;
  if (planned > 0 && actual === 0) return 'unpaid';
  if (actual >= planned) return 'paid';
  return 'partial';
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period');
    if (!period || !/^\d{6}$/.test(period)) {
      return NextResponse.json({ error: 'period (MMYYYY) required' }, { status: 400 });
    }

    const [from, to] = periodToDateRange(period);

    const categories = await db
      .select()
      .from(budgetCategories)
      .where(and(eq(budgetCategories.isActive, true), eq(budgetCategories.userId, session.user.id)))
      .orderBy(asc(budgetCategories.type), asc(budgetCategories.sortOrder));

    // Materialize recurring templates into budget_entries for this period
    // before reading. Idempotent:
    //   - no row     → INSERT with planned = recurring.amount
    //   - row with 0 → UPDATE planned = recurring.amount (heal stale empty rows)
    //   - row with >0 → leave alone (preserve manual edits)
    const activeRecurring = await db
      .select({
        categoryId: recurringExpenses.categoryId,
        amount: recurringExpenses.amount,
        startPeriod: recurringExpenses.startPeriod,
        endPeriod: recurringExpenses.endPeriod,
      })
      .from(recurringExpenses)
      .where(and(eq(recurringExpenses.isActive, true), eq(recurringExpenses.userId, session.user.id)));

    for (const rec of activeRecurring) {
      // Only materialize when the period falls within the template's window.
      // Periods are MMYYYY strings — string compare works because we'll
      // compare same-length lexicographically (MM ordering matches 01..12).
      // Wait — MMYYYY string-compare is broken across years: '122026' < '012027'.
      // Use numeric YYYYMM for the check.
      const toYM = (p: string) => parseInt(p.substring(2) + p.substring(0, 2), 10);
      const periodYM = toYM(period);
      const startYM = toYM(rec.startPeriod);
      const endYM = rec.endPeriod ? toYM(rec.endPeriod) : Number.MAX_SAFE_INTEGER;
      if (periodYM < startYM || periodYM > endYM) continue;

      const existing = await db
        .select()
        .from(budgetEntries)
        .where(
          and(
            eq(budgetEntries.categoryId, rec.categoryId),
            eq(budgetEntries.period, period),
            eq(budgetEntries.userId, session.user.id),
          ),
        )
        .limit(1);
      if (existing.length === 0) {
        await db.insert(budgetEntries).values({
          userId: session.user.id,
          categoryId: rec.categoryId,
          period,
          plannedAmount: rec.amount,
          actualAmount: 0,
        });
      } else if ((existing[0].plannedAmount ?? 0) === 0) {
        await db
          .update(budgetEntries)
          .set({ plannedAmount: rec.amount, updatedAt: new Date() })
          .where(and(eq(budgetEntries.id, existing[0].id), eq(budgetEntries.userId, session.user.id)));
      }
    }

    const entries = await db
      .select()
      .from(budgetEntries)
      .where(and(eq(budgetEntries.period, period), eq(budgetEntries.userId, session.user.id)));

    const recurring = await db
      .select({
        id: recurringExpenses.id,
        categoryId: recurringExpenses.categoryId,
        recurrence: recurringExpenses.recurrence,
      })
      .from(recurringExpenses)
      .where(and(eq(recurringExpenses.isActive, true), eq(recurringExpenses.userId, session.user.id)));

    // Pre-compute per-category source overrides
    const ccByName: Record<string, { stmt: number; paid: number }> = {};
    const ccRows = await db
      .select({
        name: liabilities.name,
        amount: creditCardExpenses.amount,
        paidAmount: creditCardExpenses.paidAmount,
      })
      .from(creditCardExpenses)
      .innerJoin(liabilities, eq(liabilities.id, creditCardExpenses.liabilityId))
      .where(
        and(
          eq(liabilities.type, 'CREDIT_CARD'),
          eq(creditCardExpenses.period, period),
          eq(creditCardExpenses.userId, session.user.id),
          eq(liabilities.userId, session.user.id),
        ),
      );
    for (const row of ccRows) {
      const acc = ccByName[row.name] ?? { stmt: 0, paid: 0 };
      acc.stmt += row.amount;
      acc.paid += row.paidAmount ?? 0;
      ccByName[row.name] = acc;
    }

    const sipActualRow = await db
      .select({ total: sql<number>`COALESCE(SUM(${investmentTransactions.amount}), 0)` })
      .from(investmentTransactions)
      .where(
        and(
          eq(investmentTransactions.type, 'SIP_EXECUTION'),
          gte(investmentTransactions.transactionDate, from),
          lt(investmentTransactions.transactionDate, to),
          eq(investmentTransactions.userId, session.user.id),
        ),
      );
    const sipActual = sipActualRow[0]?.total ?? 0;

    const chitActualRow = await db
      .select({ total: sql<number>`COALESCE(SUM(${chitFundInstallments.installmentPaid}), 0)` })
      .from(chitFundInstallments)
      .where(
        and(
          gte(chitFundInstallments.paidOn, from),
          lt(chitFundInstallments.paidOn, to),
          eq(chitFundInstallments.userId, session.user.id),
        ),
      );
    const chitActual = chitActualRow[0]?.total ?? 0;

    const rows: MonthlyRow[] = categories.map((cat) => {
      const entry = entries.find((e) => e.categoryId === cat.id);
      const planned = entry?.plannedAmount ?? 0;
      let actual = entry?.actualAmount ?? 0;
      let status: RowStatus | null = null;
      let source: RowSource = 'manual';

      const ccData = ccByName[cat.name];
      if (ccData) {
        actual = ccData.paid;
        source = 'cc';
        if (ccData.paid >= ccData.stmt && ccData.stmt > 0) status = 'paid';
        else if (ccData.paid > 0) status = 'partial';
        else status = 'unpaid';
      } else if (cat.name === 'SIP') {
        actual = sipActual;
        source = 'sip';
        status = deriveStatus(sipActual, planned);
      } else if (cat.name === 'Chit') {
        actual = chitActual;
        source = 'chit';
        status = deriveStatus(chitActual, planned);
      } else {
        // Manual category — Option C: actualAmount > 0 means user marked paid
        status = deriveStatus(actual, planned);
      }

      const rec = recurring.find((r) => r.categoryId === cat.id);

      return {
        categoryId: cat.id,
        categoryName: cat.name,
        categoryType: cat.type,
        plannedAmount: planned,
        actualAmount: actual,
        status,
        source,
        recurringId: rec?.id ?? null,
        recurrence: rec?.recurrence ?? null,
      };
    });

    return NextResponse.json({ period, rows });
  } catch (err) {
    console.error('Failed to fetch monthly view:', err);
    return NextResponse.json({ error: 'Failed to fetch monthly view' }, { status: 500 });
  }
}
