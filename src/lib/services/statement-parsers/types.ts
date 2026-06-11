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

export type DocType =
  | 'lic'
  | 'chit'
  | 'mf-sip'
  | 'epf-passbook'
  | 'nps-sot'
  | 'cg-statement'
  | 'unknown';

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

/* ─── EPF Passbook (Sprint 5.6) ──────────────────────────────────────── */
//
// Source: EPFO member passbook PDF — UAN-based statement aggregating
// employer-wise balance shares (employee / employer / pension), with
// year-wise transaction history. EPFO does not vary the layout across
// employers, but field labels DO differ slightly between Hindi/English
// dual-script and pure English passbooks. Parsers stay regex-anchored
// so they fail gracefully on field-level mismatches.

export interface EpfPassbookTransaction {
  /** YYYY-MM-DD (ISO). Source format is typically DD-MM-YYYY. */
  date: string;
  /** Raw description token — e.g. "CR", "DR", "INTEREST", "WITHDRAWAL". */
  type: string;
  /** Paisa. 0 if N/A. */
  debit: number;
  credit: number;
}

export interface EpfPassbookData {
  uan: string | null;
  memberId: string | null;
  employerName: string | null;
  /** Latest date that appears on the passbook — usually the
   *  "Last Updated" line under the header. */
  asOfDate: string | null;
  /** Paisa. Closing employee share. */
  employeeBalancePaisa: number;
  /** Paisa. Closing employer share. */
  employerBalancePaisa: number;
  /** Paisa. Pension fund share (not part of withdrawable EPF). */
  pensionBalancePaisa: number;
  /** Derived from the avg of recent monthly credits if visible.
   *  Null if we can't see a clean enough series. */
  monthlyContributionPaisa: number | null;
  recentTransactions: EpfPassbookTransaction[];
}

export interface EpfPassbookParsed {
  type: 'epf-passbook';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  data: EpfPassbookData;
  warnings: string[];
}

/* ─── NPS Statement of Transactions (Sprint 5.6) ─────────────────────── */
//
// Source: Protean (NSDL) CRA "Statement of Transactions" — the PRAN
// holder's official annual statement. PFRDA standardises the layout
// across the two CRAs (Protean / KFin) at the section level but column
// orderings differ slightly. Same parser strategy as EPF: regex-anchored.

export interface NpsRecentContribution {
  date: string; // ISO
  amountPaisa: number;
  description: string;
}

export interface NpsSotData {
  pran: string | null;
  subscriberName: string | null;
  tier: 'TIER1' | 'TIER2' | null;
  asOfDate: string | null;
  equityFundValuePaisa: number;
  debtFundValuePaisa: number;
  alternativeFundValuePaisa: number;
  totalValuePaisa: number;
  totalContributedPaisa: number;
  /** Derived from the recent contributions list if at least 3 are
   *  visible. Null otherwise. */
  monthlyContributionPaisa: number | null;
  recentContributions: NpsRecentContribution[];
}

export interface NpsSotParsed {
  type: 'nps-sot';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  data: NpsSotData;
  warnings: string[];
}

/* ─── Capital-gains contract notes / P&L statements ──────────────────── */
//
// Broker realised-P&L / capital-gains statements (Zerodha Tradewise,
// Groww, CAMS/KFintech CG statements). Each emits rows shaped to feed the
// aggregate-LTCG engine (see lib/finance/capital-gains-tax). The concrete
// per-broker text parser is added when a sample statement is available
// (same pattern as the mf-sip CAS parser) — the framework + type live here
// so onboarding one is a single file + a DETECTORS/PARSERS entry.

export type CgBroker = 'ZERODHA' | 'GROWW' | 'CAMS' | 'KFINTECH' | 'UNKNOWN';

export interface CgStatementRow {
  /** Maps to capital_gains.asset_type (EQUITY_MF / EQUITY / DEBT_MF / ...). */
  assetType: string;
  /** 'LTCG' | 'STCG' — by the holding period on the contract note. */
  holdingPeriod: 'LTCG' | 'STCG';
  /** ISO sale date — drives the pre/post-23-Jul-2024 rate split. */
  saleDate: string | null;
  /** NET realised gain in paisa (may be negative). */
  capitalGainPaisa: number;
  scrip: string | null;
}

export interface CgStatementParsed {
  type: 'cg-statement';
  broker: CgBroker;
  fy: string | null;
  rows: CgStatementRow[];
  totalLtcgPaisa: number;
  totalStcgPaisa: number;
  warnings: string[];
}

/* ─── Unknown ─────────────────────────────────────────────────────────── */

export interface UnknownParsed {
  type: 'unknown';
  warnings: string[];
}

export type ParsedStatement =
  | LicParsed
  | ChitParsed
  | MfSipParsed
  | EpfPassbookParsed
  | NpsSotParsed
  | CgStatementParsed
  | UnknownParsed;
