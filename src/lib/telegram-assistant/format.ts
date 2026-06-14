/**
 * Deterministic result formatting for slash commands (Phase 0.7). The LLM
 * formatter arrives in Phase 2; this keeps the slash path AI-free.
 */
import type { NetWorthResult } from '@/lib/assets/registry';
import type { DueItem } from '@/lib/finance/due-payments';
import type { TodayStatus } from '@/lib/health/transformation-actions';

const inr = (paisa: number) => '₹' + Math.round(paisa / 100).toLocaleString('en-IN');

export interface FormatOpts {
  /** Expand the reply (the user asked for "details"/"full"/"breakdown"). */
  verbose?: boolean;
}

export function formatResult(capabilityId: string, result: unknown, opts: FormatOpts = {}): string {
  switch (capabilityId) {
    case 'get_net_worth': {
      const nw = result as NetWorthResult;
      const assets = nw.breakdown
        .filter((b) => !b.isLiability && b.valuePaisa > 0)
        .sort((a, b) => b.valuePaisa - a.valuePaisa)
        .map((b) => `• ${b.label}: ${inr(b.valuePaisa)}`)
        .join('\n');
      const liabilities = opts.verbose
        ? '\n\n_Liabilities_\n' +
          nw.breakdown
            .filter((b) => b.isLiability && b.valuePaisa > 0)
            .sort((a, b) => b.valuePaisa - a.valuePaisa)
            .map((b) => `• ${b.label}: ${inr(b.valuePaisa)}`)
            .join('\n')
        : '';
      return (
        `*Net worth: ${inr(nw.netWorthPaisa)}*\n` +
        `Assets ${inr(nw.totalAssetsPaisa)} − Liabilities ${inr(nw.liabilitiesPaisa)}\n\n` +
        assets +
        liabilities
      );
    }
    case 'mark_card_paid': {
      const r = result as { card: string; paidPaisa: number; newBalancePaisa: number };
      return `✅ *${r.card}* — statement ${inr(r.paidPaisa)} marked paid today.\nOutstanding now ${inr(r.newBalancePaisa)}.`;
    }
    case 'get_due_payments': {
      const items = result as DueItem[];
      if (items.length === 0) return '✅ Nothing due in the next few weeks.';
      const total = items.reduce((s, i) => s + i.amountPaisa, 0);
      const lines = items
        .map((i) => `${i.isOverdue ? '🔴' : '•'} ${i.label} — ${inr(i.amountPaisa)} (${i.category}, due ${i.dueDate})`)
        .join('\n');
      return `*Due payments* — ${inr(total)} across ${items.length}\n${lines}`;
    }
    case 'get_today_status': {
      const s = result as TodayStatus;
      const w = s.weightKg != null ? `${s.weightKg} kg` : 'not logged';
      return `*Day ${s.dayNumber}* (${s.date})\nHabits: ${s.habitsDone}/${s.habitsTotal} done\nWeight: ${w}`;
    }
    case 'log_weight': {
      const r = result as { date: string; weightKg: number };
      return `✅ Weight logged: *${r.weightKg} kg* for today (${r.date}).`;
    }
    case 'tick_habit': {
      const r = result as { habit: string; date: string };
      return `✅ *${r.habit}* ticked for today (${r.date}).`;
    }
    case 'get_tax_deductions': {
      const r = result as { fy: string; oldRegimeTotalPaisa: number; newRegimeTotalPaisa: number; breakdown: Array<{ label: string; amountPaisa: number }> };
      const lines = r.breakdown
        .filter((b) => b.amountPaisa > 0)
        .sort((a, b) => b.amountPaisa - a.amountPaisa)
        .map((b) => `• ${b.label}: ${inr(b.amountPaisa)}`)
        .join('\n');
      return (
        `*Tax deductions — FY ${r.fy}*\n` +
        `Old regime (Chapter VI-A): ${inr(r.oldRegimeTotalPaisa)}\n` +
        `New-regime eligible: ${inr(r.newRegimeTotalPaisa)}\n\n` +
        (lines || '_No deductions recorded yet._')
      );
    }
    default:
      return '✅ Done.';
  }
}
