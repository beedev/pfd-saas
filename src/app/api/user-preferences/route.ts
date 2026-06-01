/**
 * User preferences — fetch + toggle non-critical flags.
 *
 * The wizard endpoint (/api/onboarding/complete) writes the initial row.
 * This endpoint exposes a narrow PATCH for the settings page to flip
 * optional modules — currently just `habitsEnabled` for the
 * transformation tracker — without going back through onboarding.
 *
 * Display-name, base currency, FY start, etc. are intentionally NOT
 * editable here — those need their own thought-out edit flows.
 */

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, userPreferences } from '@/db';
import { auth } from '@/auth';

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  try {
    const rows = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, session.user.id))
      .limit(1);
    return NextResponse.json({ preferences: rows[0] ?? null });
  } catch (err) {
    console.error('[user-preferences GET]', err);
    return NextResponse.json({ error: 'Failed to fetch preferences' }, { status: 500 });
  }
}

interface PatchBody {
  habitsEnabled?: boolean;
}

export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  try {
    const body = (await request.json()) as PatchBody;
    const update: Partial<typeof userPreferences.$inferInsert> = { updatedAt: new Date() };
    if (typeof body.habitsEnabled === 'boolean') update.habitsEnabled = body.habitsEnabled;

    if (Object.keys(update).length === 1) {
      return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
    }

    const result = await db
      .update(userPreferences)
      .set(update)
      .where(eq(userPreferences.userId, session.user.id))
      .returning();

    if (!result.length) {
      return NextResponse.json({ error: 'No preferences row found' }, { status: 404 });
    }
    return NextResponse.json({ preferences: result[0] });
  } catch (err) {
    console.error('[user-preferences PATCH]', err);
    return NextResponse.json({ error: 'Failed to update preferences' }, { status: 500 });
  }
}
