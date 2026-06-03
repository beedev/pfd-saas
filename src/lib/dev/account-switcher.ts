/**
 * Built-in Demo/Personal account switcher for the Docker self-host.
 *
 * Sprint 6.1.9 — Replaces the magic-link flow (for self-host only) with
 * a two-account model. Container provisions two well-known accounts on
 * demand; the user clicks once on /login to sign in as either; switches
 * anytime from the sidebar.
 *
 * The two UUIDs below are HARD-CODED CONSTANTS, not env-derived. They
 * are the contract that lets sessions, browser tabs, and external
 * integrations (e.g. Telegram chat-id mappings) keep working across
 * container restarts and image rebuilds. Do not change them.
 *
 * Production SaaS (DEMO_PERSONAL_SWITCH != 'true') is unaffected. This
 * module is dormant unless the env flag is on; the auth/switcher route
 * gates on it before calling any function here.
 */

import { count, eq } from 'drizzle-orm';
import { db, holdings, mutualFunds, salaryIncome, userPreferences, users } from '@/db';
import { seedDemoDataForUser } from './seed-demo-data';

/** Demo user — pre-loaded BXDEva-style portfolio. */
export const DEMO_USER_ID = '00000000-0000-0000-0000-00000000d3a0';
/** Personal user — empty dashboard for the deployer's own data. */
export const PERSONAL_USER_ID = '00000000-0000-0000-0000-0000000eea5e';

export const DEMO_EMAIL = 'demo@pfd-saas.local';
export const PERSONAL_EMAIL = 'personal@pfd-saas.local';

export const DEMO_NAME = 'Demo User';
export const PERSONAL_NAME = 'Personal';

export type SwitcherTarget = 'demo' | 'personal';

interface AccountSpec {
  userId: string;
  email: string;
  name: string;
}

const SPECS: Record<SwitcherTarget, AccountSpec> = {
  demo: { userId: DEMO_USER_ID, email: DEMO_EMAIL, name: DEMO_NAME },
  personal: { userId: PERSONAL_USER_ID, email: PERSONAL_EMAIL, name: PERSONAL_NAME },
};

export interface EnsureAccountResult {
  userId: string;
  email: string;
  isNew: boolean;
}

/**
 * Idempotently ensure the well-known user + preferences row exist for
 * the requested target. For 'demo', additionally seed the BXDEva
 * portfolio when the holdings table is empty for that user.
 *
 * Both accounts are pre-onboarded (onboardedAt = creation time) so the
 * dashboard's onboarding gate passes without the user filling out the
 * wizard.
 *
 * Cheap on the hot path: existing accounts cost one SELECT.
 */
export async function ensureAccountExists(
  target: SwitcherTarget,
): Promise<EnsureAccountResult> {
  const spec = SPECS[target];

  // 1. Does the user exist?
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, spec.userId))
    .limit(1);

  let isNew = false;
  if (existing.length === 0) {
    // Insert user. emailVerified set so Auth.js considers it a real
    // account; createdAt defaults via the schema.
    await db.insert(users).values({
      id: spec.userId,
      name: spec.name,
      email: spec.email,
      emailVerified: new Date(),
    });
    isNew = true;
  } else {
    // Backfill name/email if they drifted (cheap update; no-op when
    // already correct). We only check email because that's the field
    // the sidebar reads to label the account.
    await db
      .update(users)
      .set({ name: spec.name, email: spec.email })
      .where(eq(users.id, spec.userId));
  }

  // 2. Does the user_preferences row exist? (Onboarding gate.)
  const prefs = await db
    .select({ userId: userPreferences.userId })
    .from(userPreferences)
    .where(eq(userPreferences.userId, spec.userId))
    .limit(1);

  if (prefs.length === 0) {
    await db.insert(userPreferences).values({
      userId: spec.userId,
      displayName: spec.name,
      // Use schema defaults for baseCurrency, financialYearStartMonth,
      // taxRegimeDefault, retirementTaxBrackets, etc. Onboardedat is
      // stamped now so the dashboard layout's gate passes immediately.
      onboardedAt: new Date(),
    });
  }

  // 3. For demo: seed if the portfolio is empty. We probe a single
  //    high-signal table (holdings) — if the user has no stock rows AND
  //    no mutual funds AND no salary, treat the account as freshly
  //    minted and seed. This avoids the cost of running the seed on
  //    every login click while still recovering if the user happened to
  //    wipe demo data and clicked "Open Demo" again.
  if (target === 'demo') {
    const [holdingsCount] = await db
      .select({ n: count() })
      .from(holdings)
      .where(eq(holdings.userId, spec.userId));
    const [mfCount] = await db
      .select({ n: count() })
      .from(mutualFunds)
      .where(eq(mutualFunds.userId, spec.userId));
    const [salaryCount] = await db
      .select({ n: count() })
      .from(salaryIncome)
      .where(eq(salaryIncome.userId, spec.userId));

    const isEmpty =
      Number(holdingsCount?.n ?? 0) === 0 &&
      Number(mfCount?.n ?? 0) === 0 &&
      Number(salaryCount?.n ?? 0) === 0;

    if (isEmpty) {
      await seedDemoDataForUser(spec.userId, spec.name);
    }
  }

  return { userId: spec.userId, email: spec.email, isNew };
}
