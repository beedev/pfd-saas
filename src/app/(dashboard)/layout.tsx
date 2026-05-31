/**
 * Dashboard layout — wraps every authenticated page.
 *
 * Server component. Two responsibilities at the layout level:
 *
 *   1. Onboarding gate. If the user has no `user_preferences` row, send
 *      them to /onboarding. The wizard creates the row (Sprint 2 Phase 2).
 *      Existing users were backfilled by migration 0005 so they skip.
 *
 *   2. GST sidebar gate. Sprint 2 Phase 1: users who don't file GST don't
 *      see the GST nav section. Signal is `business_profile` row presence.
 *
 * Middleware (edge) just checks the session cookie. The DB work happens
 * here where we have full Node access.
 */

import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/layout/sidebar';
import { Toaster } from '@/components/ui/sonner';
import { auth } from '@/auth';
import { db, businessProfile, userPreferences } from '@/db';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    // Middleware should have caught this, but defence in depth.
    redirect('/login');
  }

  // Onboarding gate — has the user finished the wizard (or been
  // backfilled)?
  const prefs = await db
    .select({ userId: userPreferences.userId })
    .from(userPreferences)
    .where(eq(userPreferences.userId, session.user.id))
    .limit(1);

  if (prefs.length === 0) {
    redirect('/onboarding');
  }

  // GST sidebar gate.
  const bp = await db
    .select({ id: businessProfile.id })
    .from(businessProfile)
    .where(eq(businessProfile.userId, session.user.id))
    .limit(1);
  const hasBusinessProfile = bp.length > 0;

  return (
    <div className="flex h-screen overflow-hidden bg-gray-100">
      <Sidebar hasBusinessProfile={hasBusinessProfile} />
      <main className="flex-1 overflow-y-auto">
        <div className="container mx-auto p-6">
          {children}
        </div>
      </main>
      <Toaster />
    </div>
  );
}
