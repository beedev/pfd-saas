/**
 * /tax/return — the single, form-neutral entry to your income-tax return.
 *
 * The ITR form depends on your situation and is chosen by the ITR Wizard per
 * financial year. Rather than hardcode a link to one form's hub (which baked in
 * "ITR-3"), this resolver looks up the form selected for the active filing year
 * and sends you to that form's hub — or to the Wizard if you haven't chosen yet.
 */

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { and, eq } from 'drizzle-orm';
import { db, itrFormSelection } from '@/db';
import { getSessionUserId } from '@/lib/api/auth-guard';
import { getTaxFilingYear } from '@/lib/finance/tax-filing-year';

export default async function ReturnResolver({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string }>;
}) {
  const userId = await getSessionUserId();
  if (!userId) redirect('/login');

  const sp = await searchParams;
  const cookieFy = (await cookies()).get('pfd-fy')?.value;
  const fy =
    sp.fy && /^\d{4}-\d{2}$/.test(sp.fy)
      ? sp.fy
      : cookieFy && /^\d{4}-\d{2}$/.test(cookieFy)
        ? cookieFy
        : await getTaxFilingYear(userId);

  const [sel] = await db
    .select({ form: itrFormSelection.selectedForm })
    .from(itrFormSelection)
    .where(and(eq(itrFormSelection.userId, userId), eq(itrFormSelection.fy, fy)))
    .limit(1);

  // A form is chosen for this FY → straight to its hub; otherwise run the Wizard.
  if (sel?.form) {
    redirect(`/tax/${sel.form.toLowerCase().replace('-', '')}?fy=${encodeURIComponent(fy)}`);
  }
  redirect(`/tax/itr-wizard?fy=${encodeURIComponent(fy)}`);
}
