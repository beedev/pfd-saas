/**
 * Deterministic result formatting for slash commands (Phase 0.7). The LLM
 * formatter arrives in Phase 2; this keeps the slash path AI-free.
 */
import type { NetWorthResult } from '@/lib/assets/registry';

const inr = (paisa: number) => '₹' + Math.round(paisa / 100).toLocaleString('en-IN');

export function formatResult(capabilityId: string, result: unknown): string {
  switch (capabilityId) {
    case 'get_net_worth': {
      const nw = result as NetWorthResult;
      const assets = nw.breakdown
        .filter((b) => !b.isLiability && b.valuePaisa > 0)
        .sort((a, b) => b.valuePaisa - a.valuePaisa)
        .map((b) => `• ${b.label}: ${inr(b.valuePaisa)}`)
        .join('\n');
      return (
        `*Net worth: ${inr(nw.netWorthPaisa)}*\n` +
        `Assets ${inr(nw.totalAssetsPaisa)} − Liabilities ${inr(nw.liabilitiesPaisa)}\n\n` +
        assets
      );
    }
    case 'mark_card_paid': {
      const r = result as { card: string; paidPaisa: number; newBalancePaisa: number };
      return `✅ *${r.card}* — statement ${inr(r.paidPaisa)} marked paid today.\nOutstanding now ${inr(r.newBalancePaisa)}.`;
    }
    default:
      return '✅ Done.';
  }
}
