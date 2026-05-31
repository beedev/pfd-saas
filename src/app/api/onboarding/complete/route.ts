/**
 * POST /api/onboarding/complete
 *
 * Submission target for the onboarding wizard (Sprint 2 Phase 2).
 *
 * Behaviour:
 *   - Auth required.
 *   - Idempotency: rejects if a user_preferences row already exists for
 *     this user (would mean the wizard ran twice).
 *   - Always inserts a user_preferences row with onboardedAt = now.
 *   - If filesGst === true: also inserts a business_profile row in the
 *     same transaction. Both rows or neither.
 *
 * Body shape:
 *   {
 *     displayName: string,
 *     financialYearStartMonth: number,    // 1..12
 *     filesGst: boolean,
 *     gstin?: string | null,
 *     businessName?: string | null,
 *     pan?: string | null,
 *     stateCode?: string | null,
 *     financialYear?: string | null,
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import {
  db,
  businessProfile,
  scheduledJobs,
  userPreferences,
  type JobType,
} from '@/db';

// Default cron jobs every new user gets seeded with. Schedule is baked
// in code (Sprint 7+ adds per-user override). next_run_at = NOW() means
// the first tick after sign-up will run them.
const DEFAULT_JOBS: JobType[] = ['daily_digest', 'alerts_check', 'sip_auto_execute'];

/**
 * Walk the `cause` chain of a thrown value looking for a Postgres-shaped
 * error (has `.code` as a string). Drizzle wraps the underlying
 * PostgresError as `cause` when a transaction fails, so the outer
 * Error doesn't carry `.code` directly. Five-level depth limit is
 * defensive against accidental cycles.
 */
function findPgError(err: unknown): { code?: string; detail?: string } {
  let cur: unknown = err;
  for (let depth = 0; cur && depth < 5; depth++) {
    if (typeof cur === 'object' && cur !== null) {
      const c = cur as { code?: unknown; detail?: unknown; cause?: unknown };
      if (typeof c.code === 'string') {
        return {
          code: c.code,
          detail: typeof c.detail === 'string' ? c.detail : '',
        };
      }
      cur = c.cause;
    } else {
      break;
    }
  }
  return {};
}

interface OnboardingBody {
  displayName?: string;
  financialYearStartMonth?: number;
  filesGst?: boolean;
  gstin?: string | null;
  businessName?: string | null;
  pan?: string | null;
  stateCode?: string | null;
  financialYear?: string | null;
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  let body: OnboardingBody;
  try {
    body = (await request.json()) as OnboardingBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const displayName = body.displayName?.trim();
  if (!displayName) {
    return NextResponse.json({ error: 'displayName is required' }, { status: 400 });
  }
  const fyStart = body.financialYearStartMonth;
  if (typeof fyStart !== 'number' || fyStart < 1 || fyStart > 12) {
    return NextResponse.json(
      { error: 'financialYearStartMonth must be 1..12' },
      { status: 400 },
    );
  }

  const userId = session.user.id;

  // Reject re-submission if already onboarded — the wizard should be
  // gated by the layout, but a direct API hit could bypass that.
  const existing = await db
    .select({ userId: userPreferences.userId })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  if (existing.length > 0) {
    return NextResponse.json(
      { error: 'Already onboarded' },
      { status: 409 },
    );
  }

  const filesGst = Boolean(body.filesGst);
  if (filesGst) {
    if (!body.gstin || body.gstin.length !== 15) {
      return NextResponse.json({ error: 'gstin must be 15 chars' }, { status: 400 });
    }
    if (!body.businessName?.trim()) {
      return NextResponse.json({ error: 'businessName required' }, { status: 400 });
    }
    if (!body.pan || body.pan.length !== 10) {
      return NextResponse.json({ error: 'pan must be 10 chars' }, { status: 400 });
    }
    if (!body.stateCode || !/^\d{2}$/.test(body.stateCode)) {
      return NextResponse.json({ error: 'stateCode must be 2 digits' }, { status: 400 });
    }
    if (!body.financialYear?.trim()) {
      return NextResponse.json({ error: 'financialYear required' }, { status: 400 });
    }
  }

  // Single transaction: prefs always; business_profile conditionally.
  try {
    await db.transaction(async (tx) => {
      await tx.insert(userPreferences).values({
        userId,
        displayName,
        baseCurrency: 'INR',
        financialYearStartMonth: fyStart,
        onboardedAt: new Date(),
      });

      if (filesGst) {
        await tx.insert(businessProfile).values({
          userId,
          businessName: body.businessName!.trim(),
          gstin: body.gstin!.toUpperCase(),
          pan: body.pan!.toUpperCase(),
          stateCode: body.stateCode!,
          financialYear: body.financialYear!.trim(),
        });
      }

      // Seed the user's cron job rows so the dispatcher picks them up
      // from the next tick. Same set as migration 0007's backfill.
      await tx.insert(scheduledJobs).values(
        DEFAULT_JOBS.map((jobType) => ({
          userId,
          jobType,
          enabled: true,
          nextRunAt: new Date(),
        })),
      );
    });
  } catch (err) {
    console.error('Onboarding insert failed:', err);
    // Postgres unique-violation = SQLSTATE 23505. Drizzle wraps the
    // underlying PostgresError as `cause`, so we have to walk the
    // chain — `.code` is undefined on the outer error.
    const { code, detail } = findPgError(err);
    if (code === '23505') {
      if ((detail ?? '').toLowerCase().includes('gstin')) {
        return NextResponse.json(
          {
            error:
              'That GSTIN is already registered to another account. ' +
              'A GSTIN is one-per-business globally — if this is yours, contact support.',
          },
          { status: 409 },
        );
      }
      return NextResponse.json(
        { error: 'A unique field collided. Please review your inputs.' },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: 'Could not complete onboarding. Please try again.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
