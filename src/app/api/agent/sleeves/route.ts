/**
 * GET /api/agent/sleeves — the 4 strategy sleeves with per-sleeve summary.
 * Auto-seeds the equal 4-way split (and the portfolio) on first call so the
 * UI always has sleeves to assign instruments to.
 */

import { NextResponse } from 'next/server';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';
import { ensurePortfolio, ensureSleeves } from '@/lib/cron/agent-run-v2';
import { markUserPositions } from '@/lib/agent/engine/mark-sleeve';

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const portfolio = await ensurePortfolio(userId);
    const sleeves = await ensureSleeves(userId, portfolio);
    // Mark to live prices on read so tile equity/return reflect CURRENT worth.
    const positions = await markUserPositions(userId);

    const summary = sleeves.map((s) => {
      const pos = positions.filter((p) => p.sleeveId === s.id);
      const posValue = pos.reduce((acc, p) => acc + (p.marketValuePaisa ?? Math.round(p.avgPricePaisa * p.quantity * p.contractMultiplier)), 0);
      const equity = s.cashBalancePaisa + posValue;
      const returnPct = s.allocationPaisa > 0 ? ((equity - s.allocationPaisa) / s.allocationPaisa) * 100 : 0;
      return {
        id: s.id, key: s.key, name: s.name, strategy: s.strategy, cadence: s.cadence, enabled: s.enabled,
        allocationPaisa: s.allocationPaisa, cashPaisa: s.cashBalancePaisa, equityPaisa: equity,
        positionsValuePaisa: posValue, returnPct, openPositions: pos.length, lastRunAt: s.lastRunAt,
      };
    });
    return NextResponse.json({ portfolio, sleeves: summary });
  } catch (err) {
    console.error('GET agent/sleeves:', err);
    return NextResponse.json({ error: 'Failed to load sleeves' }, { status: 500 });
  }
}
