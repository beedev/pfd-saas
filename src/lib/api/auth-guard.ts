/**
 * Route-handler auth guard — THE convention for new API routes.
 *
 * Problem this solves: ~179 routes inline
 *   `const session = await auth(); if (!session?.user) return 401`
 * but then read `session.user.id` without checking it. A session that
 * carries a user object with no id would sail through and run queries
 * with `userId = undefined`, silently matching nothing (or, worse,
 * inserting rows with a null owner).
 *
 * Convention (matches the codebase's existing early-return style):
 *
 *   const userId = await getSessionUserId();
 *   if (!userId) return unauthenticated();
 *
 * `getSessionUserId()` returns the user id only when the session is
 * fully usable (`session?.user?.id` present); otherwise null. No thrown
 * responses, no wrappers — Next.js route handlers can't cleanly catch a
 * thrown NextResponse, so we stick to the return-early pattern every
 * handler already uses.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';

/**
 * Read the current session and return the authenticated user's id,
 * or null when there is no session OR the session lacks a user id.
 */
export async function getSessionUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

/** Standard 401 body — identical shape to the inline checks it replaces. */
export function unauthenticated(): NextResponse {
  return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
}
