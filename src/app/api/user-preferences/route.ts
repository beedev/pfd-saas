/**
 * User preferences — fetch + toggle non-critical flags.
 *
 * The wizard endpoint (/api/onboarding/complete) writes the initial row.
 * This endpoint exposes a narrow PATCH for the settings page to flip
 * optional modules and Sprint 5.1a tax setup parameters.
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
    // Explicit projection — DO NOT leak telegram_connect_token to the
    // client. Anyone with that token could pair their own Telegram
    // account to this user.
    const rows = await db
      .select({
        userId: userPreferences.userId,
        displayName: userPreferences.displayName,
        baseCurrency: userPreferences.baseCurrency,
        financialYearStartMonth: userPreferences.financialYearStartMonth,
        onboardedAt: userPreferences.onboardedAt,
        habitsEnabled: userPreferences.habitsEnabled,
        telegramChatId: userPreferences.telegramChatId,
        telegramUsername: userPreferences.telegramUsername,
        taxRegimeDefault: userPreferences.taxRegimeDefault,
        // Sprint 5.1a tax setup params
        metroCity: userPreferences.metroCity,
        isSrCitizen: userPreferences.isSrCitizen,
        spouseIsSrCitizen: userPreferences.spouseIsSrCitizen,
        parentsAreSrCitizens: userPreferences.parentsAreSrCitizens,
        hasPermanentDisability: userPreferences.hasPermanentDisability,
        disabilitySeverity: userPreferences.disabilitySeverity,
        isFamilyPensioner: userPreferences.isFamilyPensioner,
        isGovtEmployeeForNps: userPreferences.isGovtEmployeeForNps,
        // Sprint 5.8 — retirement tax brackets
        retirementTaxBrackets: userPreferences.retirementTaxBrackets,
        createdAt: userPreferences.createdAt,
        updatedAt: userPreferences.updatedAt,
      })
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
  taxRegimeDefault?: 'NEW' | 'OLD' | 'EVALUATE';
  metroCity?: boolean;
  isSrCitizen?: boolean;
  spouseIsSrCitizen?: boolean;
  parentsAreSrCitizens?: boolean;
  hasPermanentDisability?: boolean;
  disabilitySeverity?: 'REGULAR' | 'SEVERE' | null;
  isFamilyPensioner?: boolean;
  isGovtEmployeeForNps?: boolean;
  // Sprint 5.8d — retirement bracket editor
  retirementTaxBrackets?: Array<{ threshold: number; ratePct: number }>;
}

export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  try {
    const body = (await request.json()) as PatchBody;
    const update: Partial<typeof userPreferences.$inferInsert> = { updatedAt: new Date() };
    if (typeof body.habitsEnabled === 'boolean') update.habitsEnabled = body.habitsEnabled;
    if (
      body.taxRegimeDefault === 'NEW' ||
      body.taxRegimeDefault === 'OLD' ||
      body.taxRegimeDefault === 'EVALUATE'
    ) {
      update.taxRegimeDefault = body.taxRegimeDefault;
    }
    // Sprint 5.1a — tax setup booleans + disability severity
    if (typeof body.metroCity === 'boolean') update.metroCity = body.metroCity;
    if (typeof body.isSrCitizen === 'boolean') update.isSrCitizen = body.isSrCitizen;
    if (typeof body.spouseIsSrCitizen === 'boolean') update.spouseIsSrCitizen = body.spouseIsSrCitizen;
    if (typeof body.parentsAreSrCitizens === 'boolean') update.parentsAreSrCitizens = body.parentsAreSrCitizens;
    if (typeof body.hasPermanentDisability === 'boolean') update.hasPermanentDisability = body.hasPermanentDisability;
    if (body.disabilitySeverity === 'REGULAR' || body.disabilitySeverity === 'SEVERE') {
      update.disabilitySeverity = body.disabilitySeverity;
    } else if (body.disabilitySeverity === null) {
      update.disabilitySeverity = null;
    }
    if (typeof body.isFamilyPensioner === 'boolean') update.isFamilyPensioner = body.isFamilyPensioner;
    if (typeof body.isGovtEmployeeForNps === 'boolean') update.isGovtEmployeeForNps = body.isGovtEmployeeForNps;
    // Sprint 5.8d — retirement tax brackets. Validate shape:
    //   • array of {threshold:number,ratePct:number}
    //   • length 1..8
    //   • thresholds strictly ascending starting at 0
    //   • rates 0..100
    if (Array.isArray(body.retirementTaxBrackets)) {
      const bs = body.retirementTaxBrackets;
      if (bs.length < 1 || bs.length > 8) {
        return NextResponse.json(
          { error: 'retirementTaxBrackets must contain 1..8 entries' },
          { status: 400 },
        );
      }
      const sorted = [...bs].sort((a, b) => a.threshold - b.threshold);
      if (sorted[0]?.threshold !== 0) {
        return NextResponse.json(
          { error: 'retirementTaxBrackets must start with threshold:0' },
          { status: 400 },
        );
      }
      for (let i = 0; i < sorted.length; i++) {
        const b = sorted[i];
        if (
          typeof b.threshold !== 'number' ||
          typeof b.ratePct !== 'number' ||
          !Number.isFinite(b.threshold) ||
          !Number.isFinite(b.ratePct) ||
          b.threshold < 0 ||
          b.ratePct < 0 ||
          b.ratePct > 100
        ) {
          return NextResponse.json(
            { error: `retirementTaxBrackets[${i}] is malformed` },
            { status: 400 },
          );
        }
        if (i > 0 && sorted[i].threshold <= sorted[i - 1].threshold) {
          return NextResponse.json(
            { error: 'retirementTaxBrackets thresholds must be strictly ascending' },
            { status: 400 },
          );
        }
      }
      update.retirementTaxBrackets = sorted;
    }

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
