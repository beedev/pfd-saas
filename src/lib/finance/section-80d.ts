/**
 * Section 80D health-insurance deduction — Sprint 5.1c.
 *
 * Pure compute. Section 80D allows deduction of health-insurance
 * premium across two independent buckets:
 *
 *   • Self + family (spouse + dependent children): ₹25k cap.
 *     Bumped to ₹50k when the taxpayer is a senior citizen.
 *
 *   • Parents (separately): ₹25k cap. Bumped to ₹50k when the
 *     parents are senior citizens.
 *
 * Caps are applied PER BUCKET, then summed. Preventive health
 * checkup of ₹5k is included in the ceiling (not added on top) —
 * we do NOT model the checkup line separately; users either log it
 * as part of the premium or fold it into the same row.
 *
 * Reference: Yeswanth TaxCalc "IT 2026-27" sheet row 80D. Caps
 * unchanged since FY 2018-19.
 *
 * Caveats:
 *  • OLD regime only. NEW regime disallows 80D.
 *  • The senior-citizen flags come from the user's preferences
 *    (isSrCitizen / parentsAreSrCitizens). The caller looks them up.
 *  • Negative input is treated as 0.
 */

/** ₹25,000 = base cap in paisa. */
const BASE_CAP_PAISA = 25_000 * 100;
/** ₹50,000 = sr-citizen-bumped cap in paisa. */
const SR_CITIZEN_CAP_PAISA = 50_000 * 100;

export type EightyDBucket = 'SELF_FAMILY' | 'PARENTS';

export interface Section80dRow {
  bucket: EightyDBucket;
  amountPaisa: number;
}

export interface Section80dInput {
  rows: Section80dRow[];
  isSrCitizen: boolean;
  parentsAreSrCitizens: boolean;
}

export interface Section80dResult {
  selfFamilyDeductionPaisa: number;
  parentsDeductionPaisa: number;
  totalDeductionPaisa: number;
}

export function computeSection80d(input: Section80dInput): Section80dResult {
  const { rows, isSrCitizen, parentsAreSrCitizens } = input;

  let selfFamilyPaid = 0;
  let parentsPaid = 0;
  for (const r of rows) {
    const a = Math.max(0, r.amountPaisa);
    if (r.bucket === 'SELF_FAMILY') selfFamilyPaid += a;
    else if (r.bucket === 'PARENTS') parentsPaid += a;
  }

  const selfFamilyCap = isSrCitizen ? SR_CITIZEN_CAP_PAISA : BASE_CAP_PAISA;
  const parentsCap = parentsAreSrCitizens ? SR_CITIZEN_CAP_PAISA : BASE_CAP_PAISA;

  const selfFamilyDeduction = Math.min(selfFamilyPaid, selfFamilyCap);
  const parentsDeduction = Math.min(parentsPaid, parentsCap);

  return {
    selfFamilyDeductionPaisa: selfFamilyDeduction,
    parentsDeductionPaisa: parentsDeduction,
    totalDeductionPaisa: selfFamilyDeduction + parentsDeduction,
  };
}
