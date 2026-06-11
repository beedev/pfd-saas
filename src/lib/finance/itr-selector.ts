/**
 * ITR form selection — grounded in the official incometax.gov.in rules
 * (AY 2026-27). See `return-applicable-1` and `individual-business-profession`.
 *
 *   ITR-1 (Sahaj) — resident, ≤ ₹50L: salary/pension, ONE house property,
 *                   other sources, agri ≤ ₹5k, AND LTCG u/s 112A ≤ ₹1.25L.
 *   ITR-4 (Sugam) — same as ITR-1 PLUS presumptive business 44AD/44ADA/44AE.
 *   ITR-2         — any head EXCEPT business/profession, not eligible for ITR-1.
 *   ITR-3         — business/professional income (or not eligible for 1/2/4).
 *
 * KEY (recent) RULE: capital gains is NOT a blanket disqualifier for
 * Sahaj/Sugam anymore — a small equity LTCG u/s 112A up to ₹1.25L is
 * allowed. Only short-term CG, LTCG over ₹1.25L, or non-112A CG disqualify.
 *
 * Shared ITR-1 & ITR-4 disqualifiers (any one → a higher form): company
 * director, STCG, LTCG-112A over the exemption, non-112A CG, unlisted
 * shares, foreign income/assets, carry-forward losses, more than one house
 * property, total income over ₹50L.
 *
 * The ₹1.25L / ₹50L thresholds are injectable (sourced from tax_rules by
 * the caller) so they track budget changes; they default to current law.
 */

import type { ItrForm, ItrWizardAnswers } from '@/db';

const DEFAULT_LTCG_112A_EXEMPTION_PAISA = 1_25_000 * 100;
const DEFAULT_TOTAL_INCOME_CAP_PAISA = 50_00_000 * 100;

export interface ItrSelectionResult {
  form: ItrForm;
  reasoning: string;
}

export interface ItrSelectionOpts {
  /** LTCG u/s 112A exemption ceiling (≤ this is allowed in ITR-1/4). */
  ltcg112aExemptionPaisa?: number;
  /** Total-income ceiling for Sahaj/Sugam (excludes the ≤exemption LTCG). */
  totalIncomeCapPaisa?: number;
}

/**
 * The disqualifiers that bar BOTH ITR-1 (Sahaj) and ITR-4 (Sugam). Returns
 * human-readable reasons (empty = eligible for the simple forms).
 */
function sahajSugamDisqualifiers(a: ItrWizardAnswers, opts: ItrSelectionOpts): string[] {
  const ltcgCap = opts.ltcg112aExemptionPaisa ?? DEFAULT_LTCG_112A_EXEMPTION_PAISA;
  const incomeCap = opts.totalIncomeCapPaisa ?? DEFAULT_TOTAL_INCOME_CAP_PAISA;
  const d: string[] = [];

  if (a.isDirector) d.push('company director');
  if (a.hasStcg) d.push('short-term capital gains');
  if ((a.ltcg112aPaisa ?? 0) > ltcgCap) d.push('LTCG (112A) over ₹1.25L');
  if (a.hasOtherCapitalGains) d.push('non-112A capital gains');
  if (a.hasUnlistedShares) d.push('held unlisted shares');
  if (a.hasForeignIncome) d.push('foreign income/assets');
  if (a.hasCarryForwardLosses) d.push('carry-forward losses');
  if (a.numHouseProperties > 1) d.push(`${a.numHouseProperties} house properties`);
  // The ₹50L test excludes the up-to-₹1.25L LTCG that Sahaj/Sugam permits.
  const allowedLtcg = Math.min(a.ltcg112aPaisa ?? 0, ltcgCap);
  if (a.totalIncomePaisa - allowedLtcg > incomeCap) d.push('total income over ₹50L');

  // Back-compat: rows captured before the finer CG fields existed only have
  // the blanket `hasCapitalGains`. If NONE of the finer fields are present
  // but the blanket flag is set, treat it as a disqualifier (the old,
  // conservative behaviour) rather than silently allowing ITR-1.
  const hasFinerCg =
    a.hasStcg !== undefined ||
    a.ltcg112aPaisa !== undefined ||
    a.hasOtherCapitalGains !== undefined;
  if (a.hasCapitalGains && !hasFinerCg) d.push('capital gains');

  return d;
}

export function selectItrForm(
  a: ItrWizardAnswers,
  opts: ItrSelectionOpts = {},
): ItrSelectionResult {
  const disq = sahajSugamDisqualifiers(a, opts);

  // Presumptive business → ITR-4 (Sugam) when clean, else ITR-3.
  if (a.hasPresumptive) {
    if (disq.length === 0) {
      return {
        form: 'ITR-4',
        reasoning:
          'Presumptive income (44AD/44ADA/44AE) with no Sugam disqualifier — ' +
          'salary/house/other plus LTCG 112A ≤ ₹1.25L are allowed. File ITR-4 (Sugam).',
      };
    }
    return {
      form: 'ITR-3',
      reasoning: `Presumptive income, but ${disq.join(' / ')} disqualifies ITR-4 (Sugam) — declare presumptive income within ITR-3.`,
    };
  }

  // Any other (non-presumptive) business / professional income → ITR-3.
  if (a.hasBusinessIncome) {
    return {
      form: 'ITR-3',
      reasoning:
        'Business or professional income present (e.g. GST-registered consulting) without presumptive election — requires ITR-3.',
    };
  }

  // No business. A disqualifier means Sahaj is unavailable → ITR-2.
  if (disq.length > 0) {
    return {
      form: 'ITR-2',
      reasoning: `Salary/non-business filer with ${disq.join(' / ')} — ITR-1 (Sahaj) unavailable, file ITR-2.`,
    };
  }

  // Otherwise the simple case → ITR-1 (Sahaj). Small LTCG 112A ≤ ₹1.25L is
  // allowed here and does NOT force ITR-2.
  return {
    form: 'ITR-1',
    reasoning:
      'Resident with salary + at most one house property + other sources' +
      ((a.ltcg112aPaisa ?? 0) > 0 ? ' + LTCG 112A within ₹1.25L' : '') +
      ', total ≤ ₹50L — qualifies for ITR-1 (Sahaj).',
  };
}
