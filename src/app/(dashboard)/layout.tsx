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
import { cookies } from 'next/headers';
import { Sidebar } from '@/components/layout/sidebar';
import { Toaster } from '@/components/ui/sonner';
import { auth } from '@/auth';
import { db, businessProfile, userPreferences } from '@/db';
import {
  FinancialYearProvider,
  currentFinancialYear,
} from '@/components/providers/financial-year-provider';
import { FinancialYearBar } from '@/components/layout/financial-year-bar';

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
  // backfilled)? Pull habits_enabled in the same query so the sidebar
  // gate doesn't need a second round-trip.
  const prefs = await db
    .select({
      userId: userPreferences.userId,
      habitsEnabled: userPreferences.habitsEnabled,
    })
    .from(userPreferences)
    .where(eq(userPreferences.userId, session.user.id))
    .limit(1);

  if (prefs.length === 0) {
    redirect('/onboarding');
  }
  const habitsEnabled = prefs[0].habitsEnabled === true;

  // GST sidebar gate.
  const bp = await db
    .select({ id: businessProfile.id })
    .from(businessProfile)
    .where(eq(businessProfile.userId, session.user.id))
    .limit(1);
  const hasBusinessProfile = bp.length > 0;

  // Seed the global FY from the cookie (falls back to the current FY).
  const cookieStore = await cookies();
  const initialFy = cookieStore.get('pfd-fy')?.value || currentFinancialYear();

  return (
    <div className="flex h-screen overflow-hidden bg-gray-100">
      <Sidebar
        hasBusinessProfile={hasBusinessProfile}
        habitsEnabled={habitsEnabled}
        feedbackUrl={
          // Sprint 6.1.6 — runtime-resolvable feedback link. Defaults
          // to mailto so the link always works; testers/deployers
          // override via `-e FEEDBACK_URL=https://github.com/.../issues/new`.
          process.env.FEEDBACK_URL ||
          'mailto:bharath.devanathan@htcinc.com?subject=pfd-saas%20feedback'
        }
        // Sprint 6.1.9d — built-in account switcher (Docker self-host).
        // The env flag lives on the server; bridge it via prop so the
        // client sidebar can render conditionally without leaking the
        // var into the client bundle.
        accountSwitcherEnabled={process.env.DEMO_PERSONAL_SWITCH === 'true'}
        userEmail={session.user.email ?? null}
      />
      {/* On mobile the sidebar is replaced by a fixed top bar (h-14);
          pt-14 keeps the page content out from under it. md+ has the
          inline sidebar so no top padding needed. */}
      <main className="flex-1 overflow-y-auto pt-14 md:pt-0">
        <FinancialYearProvider initialFy={initialFy}>
          <div className="container mx-auto p-4 md:p-6">
            <FinancialYearBar />
            {children}
          </div>
        </FinancialYearProvider>
      </main>
      <Toaster />
    </div>
  );
}
