import { redirect } from 'next/navigation';

/**
 * Retired — the Daily Picks page was folded into the Watchlist (the 2-3 month book):
 * today's picks show as "Going to buy", the algo scorecard sits on top, and today's
 * intraday signals show below. Kept as a redirect so old links still resolve.
 */
export default function PicksPage() {
  redirect('/investments/analyst/watchlist');
}
