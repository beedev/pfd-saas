import { redirect } from 'next/navigation';

/**
 * Retired — the P&L-by-bucket view was merged into the Analyst dashboard (rendered
 * there via the shared <BucketPnl/> component). Kept as a redirect so old links resolve.
 */
export default function PnlPage() {
  redirect('/investments/analyst');
}
