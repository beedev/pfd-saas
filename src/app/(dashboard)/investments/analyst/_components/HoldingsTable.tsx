'use client';

/**
 * Holdings by bucket — each open paper position grouped under its sleeve, with
 * purchase price vs current price, market value, and P&L in ₹ and %. Data comes
 * straight from agent_positions (marked at the last agent run).
 */

import { Card, CardHeader, CardContent, Badge } from '@dxp/ui';
import { Wallet } from 'lucide-react';

export interface Position {
  id: number; sleeveId: number | null; assetClass: string; symbol: string; schemeCode: string;
  name: string; side: string; quantity: number; contractMultiplier: number;
  avgPricePaisa: number; lastPricePaisa: number | null; marketValuePaisa: number | null;
  unrealizedPnlPaisa: number | null; openedDate: string;
}
interface SleeveLite { id: number; name: string }

const inr = (p: number | null | undefined) =>
  p == null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(p / 100);
const inrPrice = (p: number | null | undefined) =>
  p == null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(p / 100);
const qty = (q: number) => (Number.isInteger(q) ? String(q) : q.toFixed(3));
const costOf = (p: Position) => p.avgPricePaisa * p.quantity * (p.contractMultiplier || 1);

export function HoldingsTable({ sleeves, positions }: { sleeves: SleeveLite[]; positions: Position[] }) {
  const bySleeve = new Map<number, Position[]>();
  for (const p of positions) {
    const k = p.sleeveId ?? -1;
    const arr = bySleeve.get(k) ?? [];
    arr.push(p);
    bySleeve.set(k, arr);
  }

  return (
    <Card>
      <CardHeader>
        <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
          <Wallet className="h-5 w-5 text-[var(--dxp-brand)]" /> Holdings by bucket
        </h3>
        <p className="text-xs text-[var(--dxp-text-muted)]">Each open paper position — purchase vs current price, market value, and P&amp;L. Marked at the last agent run.</p>
      </CardHeader>
      <CardContent>
        {positions.length === 0 ? (
          <p className="py-6 text-center text-[var(--dxp-text-muted)]">No open positions yet — each bucket buys when its strategy signals fire at the next market open.</p>
        ) : (
          <div className="space-y-5">
            {sleeves.filter((s) => (bySleeve.get(s.id)?.length ?? 0) > 0).map((s) => {
              const rows = bySleeve.get(s.id)!;
              const mv = rows.reduce((a, r) => a + (r.marketValuePaisa ?? 0), 0);
              const pnl = rows.reduce((a, r) => a + (r.unrealizedPnlPaisa ?? 0), 0);
              const cost = rows.reduce((a, r) => a + costOf(r), 0);
              const pct = cost ? (pnl / cost) * 100 : 0;
              return (
                <div key={s.id}>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-[var(--dxp-text)]">{s.name}</span>
                    <span className="font-mono text-xs text-[var(--dxp-text-secondary)]">
                      MV {inr(mv)} ·{' '}
                      <span className={pnl >= 0 ? 'text-emerald-700' : 'text-rose-600'}>
                        {pnl >= 0 ? '+' : ''}{inr(pnl)} ({pnl >= 0 ? '+' : ''}{pct.toFixed(2)}%)
                      </span>
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-[var(--dxp-border-light)] text-[10px] uppercase tracking-wider text-[var(--dxp-text-muted)]">
                          <th className="py-1 pr-3 text-left font-medium">Instrument</th>
                          <th className="py-1 px-2 text-right font-medium">Qty</th>
                          <th className="py-1 px-2 text-right font-medium">Buy</th>
                          <th className="py-1 px-2 text-right font-medium">Now</th>
                          <th className="py-1 px-2 text-right font-medium">Mkt value</th>
                          <th className="py-1 pl-2 text-right font-medium">P&amp;L</th>
                        </tr>
                      </thead>
                      <tbody className="font-mono">
                        {rows.map((p) => {
                          const c = costOf(p);
                          const ppct = c && p.unrealizedPnlPaisa != null ? (p.unrealizedPnlPaisa / c) * 100 : null;
                          const up = (p.unrealizedPnlPaisa ?? 0) >= 0;
                          return (
                            <tr key={p.id} className="border-b border-[var(--dxp-border-light)]/40">
                              <td className="py-1.5 pr-3 font-sans">
                                <span className="font-semibold text-[var(--dxp-text)]">{p.symbol || p.schemeCode}</span>
                                {p.side === 'SHORT' && <Badge variant="warning" className="ml-1 text-[9px]">SHORT</Badge>}
                                <span className="block max-w-[16rem] truncate text-[10px] text-[var(--dxp-text-muted)]">{p.name}</span>
                              </td>
                              <td className="py-1.5 px-2 text-right text-[var(--dxp-text-secondary)]">{qty(p.quantity)}</td>
                              <td className="py-1.5 px-2 text-right text-[var(--dxp-text-secondary)]">{inrPrice(p.avgPricePaisa)}</td>
                              <td className="py-1.5 px-2 text-right text-[var(--dxp-text)]">{inrPrice(p.lastPricePaisa)}</td>
                              <td className="py-1.5 px-2 text-right text-[var(--dxp-text)]">{inr(p.marketValuePaisa)}</td>
                              <td className={`py-1.5 pl-2 text-right ${up ? 'text-emerald-700' : 'text-rose-600'}`}>
                                {up ? '+' : ''}{inr(p.unrealizedPnlPaisa)}
                                {ppct != null && <span className="block text-[10px]">{up ? '+' : ''}{ppct.toFixed(2)}%</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
