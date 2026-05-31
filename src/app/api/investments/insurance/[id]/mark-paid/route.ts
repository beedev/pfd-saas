import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, insurancePolicies } from '@/db';
import { auth } from '@/auth';

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * Advance the premium due date based on frequency.
 */
function advanceDueDate(currentDue: string, frequency: string | null): string {
  const d = new Date(currentDue);
  switch (frequency?.toUpperCase()) {
    case 'MONTHLY':
      d.setMonth(d.getMonth() + 1);
      break;
    case 'QUARTERLY':
      d.setMonth(d.getMonth() + 3);
      break;
    case 'HALF_YEARLY':
    case 'SEMI_ANNUAL':
      d.setMonth(d.getMonth() + 6);
      break;
    case 'YEARLY':
    case 'ANNUAL':
    default:
      d.setFullYear(d.getFullYear() + 1);
      break;
  }
  return d.toISOString().slice(0, 10);
}

export async function POST(_request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    const rows = await db
      .select()
      .from(insurancePolicies)
      .where(and(eq(insurancePolicies.id, numericId), eq(insurancePolicies.userId, session.user.id)))
      .limit(1);

    if (!rows.length) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const policy = rows[0];
    const today = new Date().toISOString().slice(0, 10);
    const currentDue = policy.nextPremiumDueDate ?? today;
    const nextDue = advanceDueDate(currentDue, policy.premiumFrequency);

    const result = await db
      .update(insurancePolicies)
      .set({
        lastPremiumPaidDate: today,
        nextPremiumDueDate: nextDue,
        updatedAt: new Date(),
      })
      .where(and(eq(insurancePolicies.id, numericId), eq(insurancePolicies.userId, session.user.id)))
      .returning();

    return NextResponse.json({
      policy: result[0],
      message: `Premium marked paid. Next due: ${nextDue}`,
    });
  } catch (err) {
    console.error('Failed to mark premium paid:', err);
    return NextResponse.json({ error: 'Failed to mark paid' }, { status: 500 });
  }
}
