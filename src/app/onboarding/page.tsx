/**
 * Onboarding wizard — first-run setup for a newly-authenticated user.
 *
 * Sits OUTSIDE the (dashboard) route group so the dashboard layout's
 * redirect-to-/onboarding doesn't loop. Server component: checks auth +
 * existing user_preferences, then renders the client form pre-filled
 * with whatever we know from the session.
 */

import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { db, userPreferences } from '@/db';
import { OnboardingForm } from './onboarding-form';

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  // If already onboarded (row exists), kick back to the dashboard. This
  // prevents people from re-running the wizard accidentally.
  const existing = await db
    .select({ userId: userPreferences.userId })
    .from(userPreferences)
    .where(eq(userPreferences.userId, session.user.id))
    .limit(1);
  if (existing.length > 0) redirect('/');

  const defaultName =
    session.user.name?.trim() ||
    session.user.email?.split('@')[0] ||
    '';

  return (
    <OnboardingForm
      defaultName={defaultName}
      email={session.user.email ?? ''}
    />
  );
}
