/**
 * Dashboard layout — wraps every authenticated page.
 *
 * Server component. Reads the current user's `business_profile` to decide
 * whether to show the GST section in the sidebar. Sprint 2 Phase 1 gate:
 * users who don't file GST shouldn't see GST nav items.
 *
 * Signal is "does a business_profile row exist for this user?" — the row
 * gets created during onboarding (Sprint 2 Phase 2) only when the user
 * says "yes, I file GST". Simpler than a boolean column; matches the
 * one-row-or-none semantics naturally.
 */

import { eq } from 'drizzle-orm';
import { Sidebar } from '@/components/layout/sidebar';
import { Toaster } from '@/components/ui/sonner';
import { auth } from '@/auth';
import { db, businessProfile } from '@/db';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Middleware guarantees a session before we render — but double-check
  // anyway, since this is a server component and the type guard helps
  // the downstream DB call.
  const session = await auth();
  let hasBusinessProfile = false;
  if (session?.user) {
    const rows = await db
      .select({ id: businessProfile.id })
      .from(businessProfile)
      .where(eq(businessProfile.userId, session.user.id))
      .limit(1);
    hasBusinessProfile = rows.length > 0;
  }

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
