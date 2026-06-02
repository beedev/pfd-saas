/**
 * Section 80 entry wizard config — Sprint 5.2 commit 2.
 *
 * Centralises the sub-type lists, regime-eligibility flags, and per-
 * sub-type metadata that drive the guided wizard at /tax/new.
 *
 * The shape is intentionally flat — each sub-type carries its
 * description and any 80G category presets so the form layer doesn't
 * need to special-case sections beyond simple checks.
 */

export interface SubTypeOption {
  value: string;
  label: string;
  description: string;
  /** 80G category code — populated only for 80G sub-types. */
  eightyGCategory?: '50_NO_LIMIT' | '100_NO_LIMIT' | '50_WITH_LIMIT' | '100_WITH_LIMIT';
  /** 80G qualifying % — populated only for 80G sub-types. */
  qualifyingPercent?: 50 | 100;
  /** 80G hasUpperLimit — populated only for 80G sub-types. */
  hasUpperLimit?: boolean;
  /** TRUE when this sub-type is auto-eligible under NEW regime
   *  regardless of user input (e.g. 80CCD(2) employer NPS). */
  alwaysEligibleUnderNew?: boolean;
}

export const SUB_TYPES_BY_SECTION: Record<string, SubTypeOption[]> = {
  '80C': [
    { value: 'PPF', label: 'PPF', description: 'Public Provident Fund contribution' },
    { value: 'EPF', label: 'EPF (employee share)', description: 'Provident Fund employee contribution' },
    { value: 'VPF', label: 'VPF', description: 'Voluntary Provident Fund' },
    { value: 'ELSS', label: 'ELSS', description: 'Equity Linked Savings Scheme mutual fund' },
    { value: 'LIFE_INSURANCE', label: 'Life insurance premium', description: 'LIC / private life-insurance premium' },
    { value: 'TUITION', label: 'Tuition fees', description: 'Children tuition fees (max 2 children)' },
    { value: 'HOME_LOAN_PRINCIPAL', label: 'Home loan principal', description: 'Principal repayment of housing loan' },
    { value: 'SSY', label: 'Sukanya Samriddhi Yojana', description: 'SSY contribution for girl child' },
    { value: 'NSC', label: 'NSC', description: 'National Savings Certificate' },
    { value: 'TAX_SAVER_FD', label: 'Tax-saver FD', description: '5-year tax-saving fixed deposit' },
    { value: 'ULIP', label: 'ULIP', description: 'Unit Linked Insurance Plan' },
    { value: 'INFRA_BONDS', label: 'Infrastructure bonds', description: 'Specified infra bonds' },
    { value: 'SCSS', label: 'SCSS', description: 'Senior Citizen Savings Scheme' },
    { value: 'OTHER', label: 'Other 80C', description: 'Other eligible 80C instrument' },
  ],
  '80CCD_1': [
    { value: 'NPS_TIER_I_EMPLOYEE', label: 'NPS Tier-I employee', description: 'Employee contribution to NPS Tier-I' },
  ],
  '80CCD_1B': [
    { value: 'NPS_ADDITIONAL', label: 'NPS additional employee', description: 'Additional ₹50k NPS contribution above 80C cap' },
  ],
  '80CCD_2': [
    {
      value: 'NPS_EMPLOYER',
      label: 'NPS employer contribution',
      description: 'Employer NPS contribution — eligible under NEW regime too',
      alwaysEligibleUnderNew: true,
    },
  ],
  '80D': [
    { value: 'SELF_FAMILY_PREMIUM', label: 'Self/family premium', description: 'Health insurance premium for self + spouse + children' },
    { value: 'SELF_FAMILY_CHECKUP', label: 'Self/family preventive checkup', description: 'Preventive health checkup (cap ₹5k inside 80D)' },
    { value: 'PARENTS_PREMIUM', label: 'Parents premium', description: 'Health insurance premium for parents' },
    { value: 'PARENTS_CHECKUP', label: 'Parents preventive checkup', description: 'Preventive health checkup for parents' },
  ],
  '80DD': [
    { value: 'DEPENDENT_DISABILITY', label: 'Dependent with disability', description: 'Maintenance of dependent with disability' },
  ],
  '80DDB': [
    { value: 'SPECIFIED_DISEASES', label: 'Specified diseases', description: 'Treatment of specified diseases (Rule 11DD)' },
  ],
  '80E': [
    { value: 'EDUCATION_LOAN_INTEREST', label: 'Education loan interest', description: 'Interest on higher-education loan' },
  ],
  '80EEA': [
    { value: 'FIRST_HOME_ADDITIONAL', label: 'First home additional interest', description: 'Additional home-loan interest beyond 24(b)' },
  ],
  '80EEB': [
    { value: 'EV_LOAN_INTEREST', label: 'Electric vehicle loan interest', description: 'Interest on EV purchase loan' },
  ],
  '80G': [
    {
      value: 'PMNRF_100_NO_LIMIT',
      label: 'PM CARES / PMNRF / 100% no limit',
      description: 'PM CARES, PMNRF and similar — 100% deduction, no upper limit',
      eightyGCategory: '100_NO_LIMIT',
      qualifyingPercent: 100,
      hasUpperLimit: false,
    },
    {
      value: 'LOCAL_NGO_50_NO_LIMIT',
      label: 'Local NGO 50% no limit',
      description: 'NGOs with 80G cert under 50% category, no upper limit',
      eightyGCategory: '50_NO_LIMIT',
      qualifyingPercent: 50,
      hasUpperLimit: false,
    },
    {
      value: 'GOVT_100_WITH_LIMIT',
      label: 'Govt bodies 100% with limit',
      description: 'Govt bodies — 100% but capped at 10% of adjusted GTI',
      eightyGCategory: '100_WITH_LIMIT',
      qualifyingPercent: 100,
      hasUpperLimit: true,
    },
    {
      value: 'NGO_50_WITH_LIMIT',
      label: 'NGOs 50% with limit',
      description: 'NGOs with 80G cert — 50% capped at 10% of adjusted GTI',
      eightyGCategory: '50_WITH_LIMIT',
      qualifyingPercent: 50,
      hasUpperLimit: true,
    },
  ],
  '80GG': [
    { value: 'RENT_NO_HRA', label: 'Rent paid (no HRA)', description: 'Rent paid when no HRA component in salary' },
  ],
  '80GGC': [
    { value: 'POLITICAL_PARTY', label: 'Political party donation', description: 'Donation to registered political party' },
  ],
  '80TTA': [
    { value: 'SAVINGS_INTEREST', label: 'Savings bank interest', description: 'Interest on savings bank account (non-sr)' },
  ],
  '80TTB': [
    { value: 'SR_DEPOSIT_INTEREST', label: 'Senior bank/FD interest', description: 'Interest on bank deposits for sr citizens' },
  ],
  '80U': [
    { value: 'SELF_DISABILITY', label: 'Self disability', description: 'Self with disability (Section 80U)' },
  ],
};

export interface SectionMeta {
  code: string;
  label: string;
  description: string;
  capPaisa: number | null;
}

export const SECTION_LIST: SectionMeta[] = [
  { code: '80C', label: '80C', description: 'Investments & savings (ELSS/PPF/EPF/LIC/tuition/SGB)', capPaisa: 150_000_00 },
  { code: '80CCD_1', label: '80CCD(1)', description: 'NPS Tier-I employee contribution', capPaisa: 150_000_00 },
  { code: '80CCD_1B', label: '80CCD(1B)', description: 'Additional NPS Tier-I contribution', capPaisa: 50_000_00 },
  { code: '80CCD_2', label: '80CCD(2)', description: 'Employer NPS contribution (also eligible under NEW)', capPaisa: null },
  { code: '80D', label: '80D', description: 'Health insurance premium', capPaisa: 100_000_00 },
  { code: '80DD', label: '80DD', description: 'Dependent with disability', capPaisa: 125_000_00 },
  { code: '80DDB', label: '80DDB', description: 'Specified diseases treatment', capPaisa: 100_000_00 },
  { code: '80E', label: '80E', description: 'Education loan interest', capPaisa: null },
  { code: '80EEA', label: '80EEA', description: 'First home additional interest', capPaisa: 150_000_00 },
  { code: '80EEB', label: '80EEB', description: 'Electric vehicle loan interest', capPaisa: 150_000_00 },
  { code: '80G', label: '80G', description: 'Charitable donations', capPaisa: null },
  { code: '80GG', label: '80GG', description: 'Rent paid (no HRA)', capPaisa: 60_000_00 },
  { code: '80GGC', label: '80GGC', description: 'Political party donation', capPaisa: null },
  { code: '80TTA', label: '80TTA', description: 'Savings interest (non-sr)', capPaisa: 10_000_00 },
  { code: '80TTB', label: '80TTB', description: 'Senior bank/FD interest', capPaisa: 50_000_00 },
  { code: '80U', label: '80U', description: 'Self disability', capPaisa: 125_000_00 },
];

export function getSubTypes(section: string): SubTypeOption[] {
  return SUB_TYPES_BY_SECTION[section] ?? [];
}

export function getSection(code: string): SectionMeta | undefined {
  return SECTION_LIST.find((s) => s.code === code);
}
