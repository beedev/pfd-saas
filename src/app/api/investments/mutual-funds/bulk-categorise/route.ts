/**
 * POST /api/investments/mutual-funds/bulk-categorise
 *
 * Bulk-update the rate-bucket category (EQUITY/DEBT/HYBRID/UNKNOWN) for
 * a set of mutual funds the user owns. Used by the list-page modal
 * triggered when one or more funds carry category='UNKNOWN'.
 *
 * Multi-tenant: every UPDATE scoped by userId so a user can't touch
 * another user's funds even if they supply a foreign id.
 *
 * Body: { updates: Array<{ id: number; category: 'EQUITY'|'DEBT'|'HYBRID'|'UNKNOWN' }> }
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, mutualFunds } from '@/db';
import { auth } from '@/auth';

const ALLOWED_CATEGORIES = new Set(['EQUITY', 'DEBT', 'HYBRID', 'UNKNOWN']);

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  try {
    const body = await request.json();
    const updates = body?.updates;
    if (!Array.isArray(updates) || updates.length === 0) {
      return NextResponse.json(
        { error: 'updates must be a non-empty array' },
        { status: 400 },
      );
    }

    // Validate every entry up-front so we either apply all or fail fast.
    for (const u of updates) {
      if (
        !u ||
        typeof u.id !== 'number' ||
        typeof u.category !== 'string' ||
        !ALLOWED_CATEGORIES.has(u.category)
      ) {
        return NextResponse.json(
          {
            error:
              'Each update must be { id: number, category: EQUITY|DEBT|HYBRID|UNKNOWN }',
          },
          { status: 400 },
        );
      }
    }

    // Sequential is fine — list page modal touches single-digit row counts.
    let updated = 0;
    for (const u of updates) {
      const result = await db
        .update(mutualFunds)
        .set({ category: u.category, updatedAt: new Date() })
        .where(and(eq(mutualFunds.id, u.id), eq(mutualFunds.userId, session.user.id)))
        .returning({ id: mutualFunds.id });
      if (result.length > 0) updated++;
    }

    return NextResponse.json({ ok: true, updated, requested: updates.length });
  } catch (err) {
    console.error('POST mutual-funds/bulk-categorise:', err);
    return NextResponse.json({ error: 'Bulk categorise failed' }, { status: 500 });
  }
}
