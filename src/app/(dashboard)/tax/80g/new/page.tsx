/**
 * Legacy /tax/80g/new — replaced by /tax/new?section=80G in Sprint 5.2
 * commit 2. Thin redirect so old links and the 80G page CTA keep
 * working.
 */

import { redirect } from 'next/navigation';

export default function Legacy80GNewRedirect() {
  redirect('/tax/new?section=80G');
}
