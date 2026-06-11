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
  // ITR-4 (Sugam) disqualifiers: capital gains (any), more than one house
  // property, foreign income/assets, or total income above ₹50L. Sugam is
  // ONLY for simple presumptive filers — these must be checked BEFORE the
  // ITR-4 rule fires, not after.
  const itr4Disqualifiers: string[] = [];
  if (a.hasCapitalGains) itr4Disqualifiers.push('capital gains');
  if (a.numHouseProperties > 1) itr4Disqualifiers.push(`${a.numHouseProperties} house properties`);
  if (a.hasForeignIncome) itr4Disqualifiers.push('foreign income/assets');
  if (a.totalIncomePaisa > FIFTY_LAKH_PAISA) itr4Disqualifiers.push('total income over ₹50L');

  // Presumptive income → ITR-4, but ONLY when no Sugam disqualifier applies.
  if (a.hasPresumptive && itr4Disqualifiers.length === 0) {
    return {
      form: 'ITR-4',
      reasoning:
        'Presumptive income under 44AD/44ADA/44AE, total ≤ ₹50L, no capital gains and at most one house property — qualifies for ITR-4 (Sugam).',
    };
  }

  // Presumptive income WITH a disqualifier → ITR-3 (presumptive business
  // income is declared within ITR-3; Sugam is unavailable).
  if (a.hasPresumptive) {
    return {
      form: 'ITR-3',
      reasoning: `Presumptive income but ${itr4Disqualifiers.join(' / ')} disqualifies ITR-4 (Sugam) — declare presumptive income within ITR-3.`,
    };
  }

  // Any other business / professional income → ITR-3.
  if (a.hasBusinessIncome) {
    return {
      form: 'ITR-3',
      reasoning:
        'Business or professional income present (e.g. GST-registered consulting). Requires ITR-3.',
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
