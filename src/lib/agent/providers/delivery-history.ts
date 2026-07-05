/**
 * Relative-delivery SPIKE — the intelligent conviction signal. Instead of a flat
 * absolute delivery threshold (which biases toward sleepy low-churn names and
 * amputates actively-traded momentum leaders), we compare a stock's latest
 * delivery % to ITS OWN 20-day average. A leader printing above its norm =
 * accumulation kicking in, even if the absolute % is moderate.
 *
 * Backfills the last ~20 trading days from NSE bhavcopy archives once, then the
 * morning pipeline appends each new session. Global market data.
 */

import { db, agentDeliveryHistory } from '@/db';
import { getBhavcopyForDate } from './nse-bhavcopy';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Ensure the last `tradingDays` sessions are stored. Idempotent — only fetches
 * dates not already present. Starts at yesterday (today's EOD file may not exist).
 */
export async function backfillDeliveryHistory(tradingDays = 20): Promise<{ added: number; haveDays: number }> {
  const existing = new Set((await db.selectDistinct({ d: agentDeliveryHistory.tradeDate }).from(agentDeliveryHistory)).map((r) => r.d));
  const now = Date.now();
  let collected = 0, added = 0;
  for (let back = 1; back <= 40 && collected < tradingDays; back++) {
    const d = new Date(now - back * 86400000);
    if (d.getDay() === 0 || d.getDay() === 6) continue;      // weekend
    const key = iso(d);
    if (existing.has(key)) { collected++; continue; }         // already stored
    const rows = await getBhavcopyForDate(d);
    if (!rows || rows.size < 100) continue;                   // holiday / no file
    const vals = [...rows.values()].map((r) => ({ tradeDate: key, symbol: r.symbol, deliveryPct: r.deliveryPct }));
    for (let i = 0; i < vals.length; i += 500) await db.insert(agentDeliveryHistory).values(vals.slice(i, i + 500)).onConflictDoNothing();
    collected++; added++;
  }
  return { added, haveDays: collected };
}

export interface DeliveryNorm { avg: number; days: number }

/** Per-symbol trailing (≤20-session) average delivery %. Needs ≥5 days to be meaningful. */
export async function getDeliveryAverages(): Promise<Map<string, DeliveryNorm>> {
  const rows = await db.select({ symbol: agentDeliveryHistory.symbol, tradeDate: agentDeliveryHistory.tradeDate, pct: agentDeliveryHistory.deliveryPct }).from(agentDeliveryHistory);
  const bySym = new Map<string, { d: string; p: number }[]>();
  for (const r of rows) { const a = bySym.get(r.symbol) ?? []; a.push({ d: r.tradeDate, p: r.pct }); bySym.set(r.symbol, a); }
  const out = new Map<string, DeliveryNorm>();
  for (const [sym, arr] of bySym) {
    const window = arr.sort((a, b) => (a.d < b.d ? -1 : 1)).slice(-20);
    if (window.length < 5) continue;
    out.set(sym, { avg: window.reduce((s, x) => s + x.p, 0) / window.length, days: window.length });
  }
  return out;
}

const FLOOR = 25;          // kill pure intraday froth regardless of spike
const SPIKE_MIN = 1.15;    // ≥15% above the stock's own norm = accumulation
const ABS_HIGH = 50;       // very high absolute delivery always passes
const ABS_FALLBACK = 30;   // no history yet → absolute floor

export interface SpikeResult { pass: boolean; ratio: number | null }

/**
 * Does this session's delivery show conviction? Spike vs the stock's own norm,
 * with an absolute froth floor and a fallback when history is thin.
 */
export function deliverySpike(todayDeliv: number | null, norm: DeliveryNorm | undefined): SpikeResult {
  if (todayDeliv == null) return { pass: true, ratio: null };       // no delivery data (Yahoo-only name) → don't block here
  if (todayDeliv < FLOOR) return { pass: false, ratio: norm ? +(todayDeliv / norm.avg).toFixed(2) : null };
  if (!norm) return { pass: todayDeliv >= ABS_FALLBACK, ratio: null };
  const ratio = todayDeliv / norm.avg;
  return { pass: ratio >= SPIKE_MIN || todayDeliv >= ABS_HIGH, ratio: +ratio.toFixed(2) };
}
