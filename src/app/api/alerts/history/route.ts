import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db, alertHistory, alertRules } from '@/db';
import { auth } from '@/auth';

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const rows = await db
      .select({
        id: alertHistory.id,
        ruleId: alertHistory.ruleId,
        ruleName: alertRules.name,
        ruleCategory: alertRules.category,
        dedupKey: alertHistory.dedupKey,
        message: alertHistory.message,
        triggeredValue: alertHistory.triggeredValue,
        sentAt: alertHistory.sentAt,
      })
      .from(alertHistory)
      .leftJoin(alertRules, eq(alertHistory.ruleId, alertRules.id))
      .where(eq(alertHistory.userId, session.user.id))
      .orderBy(desc(alertHistory.sentAt))
      .limit(100);

    return NextResponse.json({ history: rows });
  } catch (err) {
    console.error('Failed to fetch alert history:', err);
    return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 });
  }
}
