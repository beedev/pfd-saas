/**
 * ITR form selection logic — Sprint 4 Phase 4.
 *
 * Encodes the four-way classification rules:
 *
 *   ITR-1 (Sahaj) — salary + at most 1 house property + other-sources
 *                   (interest). Total income ≤ ₹50L. No capital gains,
 *                   no business, no foreign income.
 *   ITR-2         — salary + multiple houses + capital gains, but NO
 *                   business income.
 *   ITR-3         — anyone with business / professional income
 *                   (includes GST-registered freelancers).
 *   ITR-4 (Sugam) — presumptive income under 44AD / 44ADA / 44AE,
 *                   total ≤ ₹50L.
 *
 * Order of checks matters. We test the disqualifying conditions
 * (business / capital gains / multiple houses / ₹50L cap) before
 * falling through to ITR-1.
 *
 * The `reasoning` returned is a short human-readable line for the
 * /tax/itr-wizard result page.
 */

import type { ItrForm, ItrWizardAnswers } from '@/db';

const FIFTY_LAKH_PAISA = 50_00_000 * 100;

export interface ItrSelectionResult {
  form: ItrForm;
  reasoning: string;
}

export function selectItrForm(a: ItrWizardAnswers): ItrSelectionResult {
  // Presumptive income → ITR-4, but only if total ≤ ₹50L.
  if (a.hasPresumptive && a.totalIncomePaisa <= FIFTY_LAKH_PAISA) {
    return {
      form: 'ITR-4',
      reasoning:
        'Presumptive income under 44AD/44ADA/44AE with total income ≤ ₹50L qualifies for ITR-4 (Sugam).',
    };
  }

  // Any other business income → ITR-3.
  if (a.hasBusinessIncome) {
    return {
      form: 'ITR-3',
      reasoning:
        'Business or professional income present (e.g. GST-registered consulting). Requires ITR-3.',
    };
  }

  // Presumptive but >₹50L crosses the Sugam threshold — falls to ITR-3.
  if (a.hasPresumptive) {
    return {
      form: 'ITR-3',
      reasoning:
        'Presumptive income but total income exceeds ₹50L — ITR-4 is unavailable, file ITR-3.',
    };
  }

  // Capital gains or multiple houses or foreign income → ITR-2.
  if (a.hasCapitalGains || a.numHouseProperties > 1 || a.hasForeignIncome) {
    const reasons = [];
    if (a.hasCapitalGains) reasons.push('capital gains');
    if (a.numHouseProperties > 1) reasons.push(`${a.numHouseProperties} house properties`);
    if (a.hasForeignIncome) reasons.push('foreign income');
    return {
      form: 'ITR-2',
      reasoning: `Salary-only filer with ${reasons.join(' / ')} — file ITR-2.`,
    };
  }

  // Total income >₹50L disqualifies ITR-1 even without other complications.
  if (a.totalIncomePaisa > FIFTY_LAKH_PAISA) {
    return {
      form: 'ITR-2',
      reasoning: 'Total income exceeds ₹50L — ITR-1 (Sahaj) is unavailable, file ITR-2.',
    };
  }

  // Otherwise the simple case → ITR-1.
  return {
    form: 'ITR-1',
    reasoning:
      'Salary + interest income + at most one house property, total income ≤ ₹50L — qualifies for ITR-1 (Sahaj).',
  };
}
