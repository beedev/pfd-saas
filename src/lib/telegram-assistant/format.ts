/**
 * Deterministic formatting for WRITE results only.
 *
 * Reads no longer use this — they return raw data and the LLM compose pass (or
 * renderRaw fallback) formats them. Writes are confirm-gated and produce a small
 * exact result, so a fixed confirmation line is the right, safe rendering.
 */

const inr = (paisa: number) => '₹' + Math.round(paisa / 100).toLocaleString('en-IN');

export function formatResult(capabilityId: string, result: unknown): string {
  switch (capabilityId) {
    case 'mark_card_paid': {
      const r = result as { card: string; paidPaisa: number; newBalancePaisa: number };
      return `✅ *${r.card}* — statement ${inr(r.paidPaisa)} marked paid today.\nOutstanding now ${inr(r.newBalancePaisa)}.`;
    }
    case 'log_weight': {
      const r = result as { date: string; weightKg: number };
      return `✅ Weight logged: *${r.weightKg} kg* for today (${r.date}).`;
    }
    case 'tick_habit': {
      const r = result as { habit: string; date: string };
      return `✅ *${r.habit}* ticked for today (${r.date}).`;
    }
    default:
      return '✅ Done.';
  }
}
