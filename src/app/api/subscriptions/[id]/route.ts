import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  db,
  subscriptions,
  type SubscriptionBillingFrequency,
  type SubscriptionCategory,
  type SubscriptionStatus,
} from '@/db';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';
import { parseBody } from '@/lib/api/parse-body';

interface Params {
  params: Promise<{ id: string }>;
}

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

const VALID_STATUSES: SubscriptionStatus[] = ['ACTIVE', 'PAUSED', 'CANCELLED'];

function todayISO(): string {
  return new Date().toISOString().substring(0, 10);
}

export async function GET(_request: NextRequest, { params }: Params) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    const rows = await db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.id, numericId), eq(subscriptions.userId, userId)))
      .limit(1);
    if (!rows.length) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ subscription: rows[0] });
  } catch (err) {
    console.error('Failed to fetch subscription:', err);
    return NextResponse.json({ error: 'Failed to fetch subscription' }, { status: 500 });
  }
}

// Field-diff PATCH — every key optional. Enums are nullable because the
// old truthiness guards let null through (it then fell back to the
// current DB value via `??` / typeof checks); that tolerance is kept.
const patchSchema = z.object({
  name: z.string().nullable().optional(),
  provider: z.string().nullable().optional(),
  category: z.enum(VALID_CATEGORIES).nullable().optional(),
  planName: z.string().nullable().optional(),
  amountRupees: z.number().finite().nullable().optional(),
  billingFrequency: z.enum(VALID_FREQUENCIES).nullable().optional(),
  startDate: z.string().nullable().optional(),
  nextRenewalDate: z.string().nullable().optional(),
  paymentMethod: z.string().nullable().optional(),
  autoRenew: z.boolean().nullable().optional(),
  url: z.string().nullable().optional(),
  status: z.enum(VALID_STATUSES).nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function PATCH(request: NextRequest, { params }: Params) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    const existing = await db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.id, numericId), eq(subscriptions.userId, userId)))
      .limit(1);
    if (!existing.length) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const current = existing[0];
    const parsed = await parseBody(request, patchSchema);
    if (parsed.error) return parsed.error;
    const body = parsed.data;

    // Status transition side-effects on cancellation_date
    let cancellationDate: string | null = current.cancellationDate;
    if (body.status && body.status !== current.status) {
      if (
        body.status === 'CANCELLED' &&
        (current.status === 'ACTIVE' || current.status === 'PAUSED')
      ) {
        cancellationDate = todayISO();
      } else if (body.status === 'ACTIVE' && current.status === 'CANCELLED') {
        cancellationDate = null;
      }
    }

    const newBillingFrequency = body.billingFrequency ?? current.billingFrequency;
    const nextRenewalProvided = Object.prototype.hasOwnProperty.call(body, 'nextRenewalDate');
    let nextRenewalDate: string | null;
    if (newBillingFrequency === 'LIFETIME') {
      nextRenewalDate = null;
    } else if (nextRenewalProvided) {
      nextRenewalDate = body.nextRenewalDate || null;
    } else {
      nextRenewalDate = current.nextRenewalDate;
    }

    const result = await db
      .update(subscriptions)
      .set({
        name: typeof body.name === 'string' ? body.name.trim() : current.name,
        provider: typeof body.provider === 'string' ? body.provider.trim() : current.provider,
        category: body.category ?? current.category,
        planName:
          Object.prototype.hasOwnProperty.call(body, 'planName')
            ? body.planName?.toString().trim() || null
            : current.planName,
        amountPaisa:
          typeof body.amountRupees === 'number'
            ? Math.round(body.amountRupees * 100)
            : current.amountPaisa,
        billingFrequency: newBillingFrequency,
        startDate: typeof body.startDate === 'string' ? body.startDate : current.startDate,
        nextRenewalDate,
        paymentMethod:
          Object.prototype.hasOwnProperty.call(body, 'paymentMethod')
            ? body.paymentMethod?.toString().trim() || null
            : current.paymentMethod,
        autoRenew: typeof body.autoRenew === 'boolean' ? body.autoRenew : current.autoRenew,
        url:
          Object.prototype.hasOwnProperty.call(body, 'url')
            ? body.url?.toString().trim() || null
            : current.url,
        status: body.status ?? current.status,
        cancellationDate,
        notes:
          Object.prototype.hasOwnProperty.call(body, 'notes')
            ? body.notes?.toString() || null
            : current.notes,
        updatedAt: new Date(),
      })
      .where(and(eq(subscriptions.id, numericId), eq(subscriptions.userId, userId)))
      .returning();

    return NextResponse.json({ subscription: result[0] });
  } catch (err) {
    console.error('Failed to update subscription:', err);
    return NextResponse.json({ error: 'Failed to update subscription' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();
  try {
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    await db
      .delete(subscriptions)
      .where(and(eq(subscriptions.id, numericId), eq(subscriptions.userId, userId)));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Failed to delete subscription:', err);
    return NextResponse.json({ error: 'Failed to delete subscription' }, { status: 500 });
  }
}
