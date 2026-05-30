/**
 * Generic statement importer types.
 *
 * Each parser produces a `ParsedStatement` discriminated by `type`. The
 * preview UI dispatches on `type`, and the commit endpoint dispatches on
 * `type` to write to the right table(s).
 *
 * Adding a new statement format = (1) write a parser that returns one of
 * these shapes, (2) register it in `index.ts`, (3) add a preview component
 * + a writer in the commit route.
 */

export type DocType = 'lic' | 'chit' | 'mf-sip' | 'unknown';

/* ─── LIC ────────────────────────────────────────────────────────────── */

export type LicPaymentMode = 'Yly' | 'Hly' | 'Qly' | 'Mly' | 'Sly';

export interface LicPolicySummary {
  policyNumber: string;
  policyHolder: string;
  startDate: string;
  paymentMode: LicPaymentMode;
  premiumPerInstallmentPaisa: number;
  installmentsInStatement: number;
  totalPaidPaisa: number;
  totalGstPaisa: number;
  lastDueTo: string;
  nextDueDate: string;
  annualPremiumPaisa: number;
}

export interface LicParsed {
  type: 'lic';
  statementYear: string | null;
  policyHolderName: string | null;
  totalPremiumPaisa: number;
  totalGstPaisa: number;
  installmentCount: number;
  warnings: string[];
  policies: LicPolicySummary[];
}

/* ─── Chit ───────────────────────────────────────────────────────────── */

export interface ChitParsed {
  type: 'chit';
  foremanName: string;
  branch: string | null;
  subscriberName: string | null;
  schemeName: string;          // e.g. "MG80404"
  ticketNumber: string | null; // e.g. "34"
  registrationNumber: string | null; // Bye Law No
  isRegistered: boolean;
  chitValuePaisa: number;
  monthlyInstallmentPaisa: number;
  durationMonths: number;
  groupSize: number;
  startDate: string;     // ISO
  expectedEndDate: string; // ISO
  installmentsPaid: number;
  totalPaidPaisa: number;
  totalDividendsPaisa: number;
  netContributionPaisa: number;
  status: 'ACTIVE' | 'WON';
  nextDueDate: string | null;
  reportDate: string | null;
  warnings: string[];
}

/* ─── Mutual Fund SIPs ───────────────────────────────────────────────── */

export interface MfSipRow {
  schemeName: string;
  folioNumber: string | null;
  amc: string | null;
  units: number;
  averageNavRupees: number;
  investedPaisa: number;
  currentValuePaisa: number | null;
}

export interface MfSipParsed {
  type: 'mf-sip';
  asOfDate: string | null;
  panLast4: string | null;
  totalInvestedPaisa: number;
  totalCurrentPaisa: number | null;
  schemes: MfSipRow[];
  warnings: string[];
}

/* ─── Unknown ─────────────────────────────────────────────────────────── */

export interface UnknownParsed {
  type: 'unknown';
  warnings: string[];
}

export type ParsedStatement = LicParsed | ChitParsed | MfSipParsed | UnknownParsed;
