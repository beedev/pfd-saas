/**
 * Deterministic plain-language rationale built from a decision's REAL-DATA
 * evidence record. This is the auditable "why" — derived only from the actual
 * numbers/rule that fired, never invented. (An LLM may narrate on top of the
 * digest, but the per-decision rationale is this deterministic text.)
 */

import type { AgentDecisionEvidence, AgentAction } from '@/db';

const inr = (paisa: number) => '₹' + Math.round(paisa / 100).toLocaleString('en-IN');

function fmt(v: number | string): string {
  if (typeof v === 'string') return v;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

export function buildRationale(
  action: AgentAction,
  name: string,
  ev: AgentDecisionEvidence,
): string {
  const inputs = Object.entries(ev.inputs)
    .map(([k, v]) => `${k} ${typeof v === 'number' && /paisa$/i.test(k) ? inr(v) : fmt(v)}`)
    .join(', ');
  const src = ev.source ? ` [${ev.source}${ev.dataAsOf ? ` ${ev.dataAsOf}` : ''}]` : '';
  const sizing = ev.sizing
    ? ` — ${Object.entries(ev.sizing).map(([k, v]) => `${k} ${typeof v === 'number' && /paisa$/i.test(k) ? inr(v) : fmt(v)}`).join(', ')}`
    : '';
  return `${action} ${name}: ${ev.rule} (${inputs})${sizing}${src}`;
}
