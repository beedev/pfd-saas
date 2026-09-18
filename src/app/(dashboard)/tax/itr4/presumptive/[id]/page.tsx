/**
 * Redirect — see ../new/page.tsx. Moved 2026-09-18.
 */
import { redirect } from 'next/navigation';

export default async function MovedEdit({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ fy?: string }>;
}) {
  const { id } = await params;
  const { fy } = await searchParams;
  redirect(`/tax/presumptive/${id}${fy ? `?fy=${encodeURIComponent(fy)}` : ''}`);
}
