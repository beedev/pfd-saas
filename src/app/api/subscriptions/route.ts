import { NextRequest, NextResponse } from 'next/server';
import { asc, desc, eq, sql } from 'drizzle-orm';
import {
  db,
  subscriptions,
  type SubscriptionBillingFrequency,
  type SubscriptionCategory,
} from '@/db';
import { auth } from '@/auth';

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
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  try {
    const rows = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, session.user.id))
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

interface CreateBody {
  name?: string;
  provider?: string;
  category?: SubscriptionCategory;
  planName?: string;
  amountRupees?: number;
  billingFrequency?: SubscriptionBillingFrequency;
  startDate?: string;
  nextRenewalDate?: string;
  paymentMethod?: string;
  autoRenew?: boolean;
  url?: string;
  notes?: string;
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  try {
    const body = (await request.json()) as CreateBody;

    if (!body.name || !body.name.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    if (!body.provider || !body.provider.trim()) {
      return NextResponse.json({ error: 'provider is required' }, { status: 400 });
    }
    if (!body.category || !VALID_CATEGORIES.includes(body.category)) {
      return NextResponse.json(
        { error: `category must be one of ${VALID_CATEGORIES.join(', ')}` },
        { status: 400 },
      );
    }
    if (typeof body.amountRupees !== 'number' || !Number.isFinite(body.amountRupees)) {
      return NextResponse.json({ error: 'amountRupees is required' }, { status: 400 });
    }
    if (!body.billingFrequency || !VALID_FREQUENCIES.includes(body.billingFrequency)) {
      return NextResponse.json(
        { error: `billingFrequency must be one of ${VALID_FREQUENCIES.join(', ')}` },
        { status: 400 },
      );
    }
    if (!body.startDate) {
      return NextResponse.json({ error: 'startDate is required' }, { status: 400 });
    }
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
        userId: session.user.id,
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
