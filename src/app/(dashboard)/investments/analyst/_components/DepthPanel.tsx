'use client';

/** Depth-of-Market (order book) — best-5 bid/ask with quantities + a buy/sell
 *  imbalance bar. Data is NSE-direct (stocks, market hours); polled, not streamed. */

export interface DepthLevel { pricePaisa: number; qty: number }
export interface Depth { bids: DepthLevel[]; asks: DepthLevel[]; totalBuyQty: number; totalSellQty: number }

const rupee = (p: number) => '₹' + (p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = (q: number) => q.toLocaleString('en-IN');

export function DepthPanel({ depth, note }: { depth: Depth | null; note?: string }) {
  if (!depth) {
    return <div className="flex h-32 items-center justify-center text-center text-sm text-[var(--dxp-text-muted)]">{note || 'No order book.'}</div>;
  }
  const { bids, asks, totalBuyQty, totalSellQty } = depth;
  const total = totalBuyQty + totalSellQty;
  const buyPct = total > 0 ? (totalBuyQty / total) * 100 : 50;
  const maxQty = Math.max(1, ...bids.map((b) => b.qty), ...asks.map((a) => a.qty));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {/* Bids */}
        <div>
          <div className="mb-1 flex justify-between text-[10px] font-bold uppercase tracking-wider text-[var(--dxp-text-muted)]"><span>Bid qty</span><span>Price</span></div>
          {bids.slice(0, 5).map((b, i) => (
            <div key={i} className="relative flex justify-between px-1 py-0.5 font-mono text-xs">
              <span className="absolute inset-y-0 right-0 bg-emerald-500/10" style={{ width: `${(b.qty / maxQty) * 100}%` }} />
              <span className="relative text-[var(--dxp-text-secondary)]">{qtyFmt(b.qty)}</span>
              <span className="relative font-semibold text-emerald-700">{rupee(b.pricePaisa)}</span>
            </div>
          ))}
        </div>
        {/* Asks */}
        <div>
          <div className="mb-1 flex justify-between text-[10px] font-bold uppercase tracking-wider text-[var(--dxp-text-muted)]"><span>Price</span><span>Ask qty</span></div>
          {asks.slice(0, 5).map((a, i) => (
            <div key={i} className="relative flex justify-between px-1 py-0.5 font-mono text-xs">
              <span className="absolute inset-y-0 left-0 bg-rose-500/10" style={{ width: `${(a.qty / maxQty) * 100}%` }} />
              <span className="relative font-semibold text-rose-600">{rupee(a.pricePaisa)}</span>
              <span className="relative text-[var(--dxp-text-secondary)]">{qtyFmt(a.qty)}</span>
            </div>
          ))}
        </div>
      </div>
      {/* Buy/sell imbalance */}
      <div>
        <div className="flex h-2 overflow-hidden rounded">
          <div className="bg-emerald-500" style={{ width: `${buyPct}%` }} />
          <div className="bg-rose-500" style={{ width: `${100 - buyPct}%` }} />
        </div>
        <div className="mt-1 flex justify-between font-mono text-[10px] text-[var(--dxp-text-muted)]">
          <span className="text-emerald-700">Total buy {qtyFmt(totalBuyQty)}</span>
          <span className="text-rose-600">{qtyFmt(totalSellQty)} total sell</span>
        </div>
      </div>
    </div>
  );
}
