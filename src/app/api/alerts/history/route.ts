import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db, alertHistory, alertRules } from '@/db';

export async function GET() {
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
      .orderBy(desc(alertHistory.sentAt))
      .limit(100);

    return NextResponse.json({ history: rows });
  } catch (err) {
    console.error('Failed to fetch alert history:', err);
    return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 });
  }
}
