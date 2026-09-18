/**
 * Redirect — presumptive income moved out from under the ITR-4 walkthrough on
 * 2026-09-18. It is an income declaration, not a form artifact. Kept so old
 * bookmarks and links do not 404.
 */
import { redirect } from 'next/navigation';

export default async function MovedNew({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string }>;
}) {
  const { fy } = await searchParams;
  redirect(`/tax/presumptive/new${fy ? `?fy=${encodeURIComponent(fy)}` : ''}`);
}
