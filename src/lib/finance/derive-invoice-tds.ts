/**
 * Sprint A.2 (saas back-port) — Derive `tds_credits` rows from
 * finalised B2B invoices.
 *
 * Two entry points, both idempotent:
 *
 *   syncInvoiceTdsCredit(userId, invoiceId)
 *     Call from any invoice state transition (create, edit, status
 *     flip). Upserts/deletes the matching tds_credits row to track the
 *     invoice's current state. Always returns success — failures here
 *     MUST NOT block the invoice update — callers should log and
 *     continue.
 *
 *   removeInvoiceTdsCredit(userId, invoiceId)
 *     Call from the DELETE handler. Removes any auto-derived row for
 *     the invoice. Manual rows (autoDerived=false) are left alone.
 *
 * Multi-tenant scoping: every query takes `userId` as the first arg and
 * scopes by `eq(t.userId, userId)`. This is the saas-side deviation
 * from v1's single-user implementation — v1 took only `invoiceId`.
 *
 * Rules:
 *   - Invoice must be FINAL, B2B, and `tds_deducted` must be truthy.
 *   - Customer must have `tdsRatePct > 0`.
 *   - Otherwise: any existing auto-derived row for this invoice is
 *     removed (so flipping the toggle off cleanly retracts the
 *     credit).
 *
 * Promotion guard: once a row has been demoted to manual
 * (autoDerived=false) the sync is a no-op — user ownership wins.
 *
 * Naming the deductor: customer.name is used; TAN falls back to
 * customer.gstin when the dedicated `tan` field isn't on the schema —
 * the user can correct this from /tax/reconciliation if 26AS shows the
 * real TAN.
 *
 * The (userId, sourceKind='GST_INVOICE', sourceId=invoiceId) key keeps
 * things idempotent — we always update-or-insert against that key. The
 * partial UNIQUE index (created in 0036_invoice_tds_autoderive.sql)
 * includes user_id so different tenants can each have their own
 * auto-derived row for the same invoice id.
 */

import { and, eq } from 'drizzle-orm';
import { db, invoices, customers, tdsCredits } from '@/db';
import type { TdsCategory } from '@/db/schema';

/** Convert ISO date to "YYYY-YY" FY string (Apr 1 → Mar 31 boundary). */
export function fyFromDateIso(iso: string): string {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth(); // 0-indexed
  const startYear = m >= 3 ? y : y - 1;
  const endShort = String((startYear + 1) % 100).padStart(2, '0');
  return `${startYear}-${endShort}`;
}

/** Map a TDS section to a TdsCategory enum value. Best-effort —
 *  anything unrecognised falls to OTHER. */
function sectionToCategory(section: string): TdsCategory {
  const s = section.toUpperCase().trim();
  if (s === '194J' || s === '194JB') return 'CONSULTING';
  if (s === '194C') return 'CONSULTING';
  if (s === '194A') return 'INTEREST';
  if (s === '194-IA' || s === '194IA') return 'PROPERTY';
  if (s === '194-IB' || s === '194IB') return 'RENT';
  return 'OTHER';
}

interface SyncResult {
  action: 'created' | 'updated' | 'removed' | 'skipped' | 'preserved-manual';
  tdsCreditId?: number;
  reason?: string;
}

/**
 * Idempotent sync — call after any change to invoice or customer that
 * could affect the derived tds row. Always returns success; the caller
 * doesn't need to know what happened (just that it's now in sync).
 *
 * Failures here MUST NOT block the invoice update — caller wraps in
 * try/catch and logs.
 */
export async function syncInvoiceTdsCredit(
  userId: string,
  invoiceId: number,
): Promise<SyncResult> {
  // Load invoice (user-scoped). If absent, skip silently.
  const [inv] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.userId, userId)))
    .limit(1);
  if (!inv) return { action: 'skipped', reason: 'invoice not found' };

  // Find any existing derived row for this invoice (user-scoped).
  const [existing] = await db
    .select()
    .from(tdsCredits)
    .where(
      and(
        eq(tdsCredits.userId, userId),
        eq(tdsCredits.sourceKind, 'GST_INVOICE'),
        eq(tdsCredits.sourceId, invoiceId),
      ),
    )
    .limit(1);

  // Promotion guard — once a row has been demoted to manual it stays
  // sacred. The user has taken ownership; don't clobber it.
  if (existing && !existing.autoDerived) {
    return { action: 'preserved-manual', tdsCreditId: existing.id };
  }

  // Eligibility checks — invoice must be a finalised B2B with the
  // TDS-deducted flag on and the customer must have a non-zero rate.
  const isEligible =
    inv.status === 'FINAL' &&
    inv.invoiceType === 'B2B' &&
    inv.tdsDeducted !== false;

  if (!isEligible) {
    if (existing) {
      await db
        .delete(tdsCredits)
        .where(and(eq(tdsCredits.id, existing.id), eq(tdsCredits.userId, userId)));
      return { action: 'removed', reason: 'invoice no longer eligible' };
    }
    return { action: 'skipped', reason: 'invoice not eligible' };
  }

  if (!inv.customerId) {
    if (existing) {
      await db
        .delete(tdsCredits)
        .where(and(eq(tdsCredits.id, existing.id), eq(tdsCredits.userId, userId)));
      return { action: 'removed', reason: 'no customer linked' };
    }
    return { action: 'skipped', reason: 'no customer linked' };
  }

  const [cust] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, inv.customerId), eq(customers.userId, userId)))
    .limit(1);

  if (!cust) {
    if (existing) {
      await db
        .delete(tdsCredits)
        .where(and(eq(tdsCredits.id, existing.id), eq(tdsCredits.userId, userId)));
      return { action: 'removed', reason: 'customer missing' };
    }
    return { action: 'skipped', reason: 'customer missing' };
  }

  const ratePct = cust.tdsRatePct ?? 0;
  if (ratePct <= 0) {
    if (existing) {
      await db
        .delete(tdsCredits)
        .where(and(eq(tdsCredits.id, existing.id), eq(tdsCredits.userId, userId)));
      return { action: 'removed', reason: 'customer TDS rate is 0' };
    }
    return { action: 'skipped', reason: 'customer TDS rate is 0' };
  }

  const section = (cust.tdsSection ?? '194J').toUpperCase();
  const tdsPaisa = Math.round((inv.taxableAmount * ratePct) / 100);
  const fy = fyFromDateIso(inv.invoiceDate);
  // No dedicated TAN column on customers — GSTIN is the next-best proxy
  // for matching against 26AS. The user can correct via
  // /tax/reconciliation when 26AS comes in.
  const deductorTan = cust.gstin ?? null;

  const values = {
    userId,
    financialYear: fy,
    category: sectionToCategory(section),
    deductorName: cust.name,
    deductorTan,
    deductorPan: cust.pan ?? null,
    section,
    incomePaisa: inv.taxableAmount,
    tdsPaisa,
    autoDerived: true,
    sourceKind: 'GST_INVOICE' as const,
    sourceId: invoiceId,
    paymentDate: inv.invoiceDate.slice(0, 10),
    notes: `Auto-derived from invoice #${inv.invoiceNumber}`,
    updatedAt: new Date(),
  };

  if (existing) {
    await db
      .update(tdsCredits)
      .set(values)
      .where(and(eq(tdsCredits.id, existing.id), eq(tdsCredits.userId, userId)));
    return { action: 'updated', tdsCreditId: existing.id };
  }

  const [inserted] = await db
    .insert(tdsCredits)
    .values({ ...values, createdAt: new Date() })
    .returning();
  return { action: 'created', tdsCreditId: inserted.id };
}

/** Delete the derived row when an invoice is deleted. Cheap no-op if
 *  none exists. Never deletes a manual row the user owns. */
export async function removeInvoiceTdsCredit(
  userId: string,
  invoiceId: number,
): Promise<void> {
  await db
    .delete(tdsCredits)
    .where(
      and(
        eq(tdsCredits.userId, userId),
        eq(tdsCredits.sourceKind, 'GST_INVOICE'),
        eq(tdsCredits.sourceId, invoiceId),
        eq(tdsCredits.autoDerived, true),
      ),
    );
}
