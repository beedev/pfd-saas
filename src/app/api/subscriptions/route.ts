import { NextRequest, NextResponse } from 'next/server';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  db,
  subscriptions,
  type SubscriptionBillingFrequency,
  type SubscriptionCategory,
} from '@/db';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';
import { parseBody } from '@/lib/api/parse-body';

const VALID_CATEGORIES: SubscriptionCategory[] = [
  'STREAMING',
  'SOFTWARE',
  'CLOUD',
  'FITNESS',
  'NEWS',
  'GAMING',
  'AI',
  'EDUCATION',
  'PRODUCTIVITY',
  'OTHER',
];

const VALID_FREQUENCIES: SubscriptionBillingFrequency[] = [
  'MONTHLY',
  'QUARTERLY',
  'SEMI_ANNUAL',
  'ANNUAL',
  'LIFETIME',
];

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const rows = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .orderBy(
        // ACTIVE first, then PAUSED, then CANCELLED
        sql`CASE ${subscriptions.status}
              WHEN 'ACTIVE' THEN 0
              WHEN 'PAUSED' THEN 1
              WHEN 'CANCELLED' THEN 2
              ELSE 3 END`,
        // null next_renewal_date last
        sql`${subscriptions.nextRenewalDate} IS NULL`,
        asc(subscriptions.nextRenewalDate),
        desc(subscriptions.createdAt),
      );
    return NextResponse.json({ subscriptions: rows });
  } catch (err) {
    console.error('Failed to fetch subscriptions:', err);
    return NextResponse.json({ error: 'Failed to fetch subscriptions' }, { status: 500 });
  }
}

const createSchema = z.object({
  name: z.string().refine((s) => s.trim().length > 0, 'name is required'),
  provider: z.string().refine((s) => s.trim().length > 0, 'provider is required'),
  category: z.enum(VALID_CATEGORIES),
  planName: z.string().nullable().optional(),
  amountRupees: z.number().finite(),
  billingFrequency: z.enum(VALID_FREQUENCIES),
  startDate: z.string().min(1),
  nextRenewalDate: z.string().nullable().optional(),
  paymentMethod: z.string().nullable().optional(),
  autoRenew: z.boolean().nullable().optional(),
  url: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const parsed = await parseBody(request, createSchema);
    if (parsed.error) return parsed.error;
    const body = parsed.data;

    // Cross-field rule kept out of the schema to preserve the exact
    // single-message 400 the UI expects.
    if (body.billingFrequency !== 'LIFETIME' && !body.nextRenewalDate) {
      return NextResponse.json(
        { error: 'nextRenewalDate is required for non-LIFETIME subscriptions' },
        { status: 400 },
      );
    }

    const amountPaisa = Math.round(body.amountRupees * 100);

    const result = await db
      .insert(subscriptions)
      .values({
        userId,
        name: body.name.trim(),
        provider: body.provider.trim(),
        category: body.category,
        planName: body.planName?.trim() || null,
        amountPaisa,
        billingFrequency: body.billingFrequency,
        startDate: body.startDate,
        nextRenewalDate:
          body.billingFrequency === 'LIFETIME' ? null : body.nextRenewalDate || null,
        paymentMethod: body.paymentMethod?.trim() || null,
        autoRenew: typeof body.autoRenew === 'boolean' ? body.autoRenew : true,
        url: body.url?.trim() || null,
        status: 'ACTIVE',
        cancellationDate: null,
        notes: body.notes?.trim() || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return NextResponse.json({ subscription: result[0] }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create subscription';
    console.error('Failed to create subscription:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
