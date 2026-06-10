// Section 80 caps in paisa + metadata for tax calculations

export type TaxSection =
  | '80C'
  | '80CCD_1B'
  | '80D'
  | '80DD'
  | '80DDB'
  | '80E'
  | '80EEA'
  | '80G'
  | '80GG'
  | '80GGA'
  | '80GGC'
  | '80TTA'
  | '80TTB'
  | '80U'
  | '24B';

export interface SectionMeta {
  section: TaxSection;
  label: string;
  description: string;
  capPaisa: number | null; // null = no cap
}

// Caps in paisa (× 100)
export const SECTION_CAPS: Record<TaxSection, SectionMeta> = {
  '80C': {
    section: '80C',
    label: 'Section 80C',
    description: 'ELSS / PPF / EPF / Life insurance / SGB / Home loan principal',
    capPaisa: 15000000, // ₹1,50,000
  },
  '80CCD_1B': {
    section: '80CCD_1B',
    label: 'Section 80CCD(1B)',
    description: 'Additional NPS Tier-I contribution',
    capPaisa: 5000000, // ₹50,000
  },
  '80D': {
    section: '80D',
    label: 'Section 80D',
    description: 'Health insurance premium',
    capPaisa: 7500000, // ₹75,000 (₹25k self + ₹50k senior parent)
  },
  '80DD': {
    section: '80DD',
    label: 'Section 80DD',
    description: 'Dependent with disability',
    capPaisa: 12500000,
  },
  '80DDB': {
    section: '80DDB',
    label: 'Section 80DDB',
    description: 'Specified disease treatment',
    capPaisa: 10000000,
  },
  '80E': {
    section: '80E',
    label: 'Section 80E',
    description: 'Education loan interest',
    capPaisa: null,
  },
  '80EEA': {
    section: '80EEA',
    label: 'Section 80EEA',
    description: 'First-time home buyer interest',
    capPaisa: 15000000,
  },
  '80G': {
    section: '80G',
    label: 'Section 80G',
    description: 'Charitable donations',
    capPaisa: null,
  },
  '80GG': {
    section: '80GG',
    label: 'Section 80GG',
    description: 'Rent paid (no HRA)',
    capPaisa: 6000000,
  },
  '80GGA': {
    section: '80GGA',
    label: 'Section 80GGA',
    description: 'Scientific research donations',
    capPaisa: null,
  },
  '80GGC': {
    section: '80GGC',
    label: 'Section 80GGC',
    description: 'Political party contributions',
    capPaisa: null,
  },
  '80TTA': {
    section: '80TTA',
    label: 'Section 80TTA',
    description: 'Savings account interest',
    capPaisa: 1000000,
  },
  '80TTB': {
    section: '80TTB',
    label: 'Section 80TTB',
    description: 'Senior citizen interest income',
    capPaisa: 5000000,
  },
  '80U': {
    section: '80U',
    label: 'Section 80U',
    description: 'Person with disability',
    capPaisa: 12500000,
  },
  '24B': {
    section: '24B',
    label: 'Section 24(b)',
    description: 'Home loan interest',
    capPaisa: 20000000, // ₹2,00,000
  },
};

export const ALL_SECTIONS: TaxSection[] = Object.keys(SECTION_CAPS) as TaxSection[];

// Current FY helper — Indian FY runs Apr 1 → Mar 31
export function getCurrentFinancialYear(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-indexed
  const startYear = m >= 3 ? y : y - 1;
  const endShort = String((startYear + 1) % 100).padStart(2, '0');
  return `${startYear}-${endShort}`;
}

export function financialYearBounds(fy: string): { start: Date; end: Date } {
  // "2026-27" → Apr 1 2026 → Mar 31 2027
  const [startYearStr] = fy.split('-');
  const startYear = Number(startYearStr);
  return {
    start: new Date(`${startYear}-04-01T00:00:00Z`),
    end: new Date(`${startYear + 1}-03-31T23:59:59Z`),
  };
}

/** ISO-string sibling of financialYearBounds — for sites that compare
 *  against text date columns. "2026-27" →
 *  { start: '2026-04-01', end: '2027-03-31' } (both ends inclusive).
 *  Like the Date variant, this does NOT validate the FY format —
 *  callers that 400 on malformed input keep their own regex guard. */
export function financialYearBoundsIso(fy: string): { start: string; end: string } {
  const startYear = parseInt(fy.split('-')[0], 10);
  return {
    start: `${startYear}-04-01`,
    end: `${startYear + 1}-03-31`,
  };
}
