/**
 * Sprint 6.4a — table manifest for data portability export/import.
 *
 * MANIFEST lists every user-scoped table in foreign-key-safe insert
 * order. Parents always appear before children. The order is also the
 * order we read for export, and the REVERSE order is the order we use
 * for delete during a Replace import (children purged before parents).
 *
 * Excluded tables (auth, govt reference, cron) live in
 * `./constants.ts → EXCLUDED_TABLES`.
 *
 * Module-load asserts at the bottom guard against drift:
 *   - exact entry count (whoever adds a new user-scoped table MUST add
 *     it here too, or production builds will fail loudly)
 *   - every named parent resolves to an earlier entry
 *   - no excluded table accidentally appears
 *
 * NOTE on the prompt's "77" target: the live DB has 72 user-scoped
 * tables. The plan document's 77 was an earlier estimate; reality
 * (queried via `information_schema.columns WHERE column_name='user_id'`
 * minus 3 auth/cron tables) is 72. We assert the real number so future
 * schema growth must update both.
 */

import type { PgTable } from 'drizzle-orm/pg-core';
import {
  // Onboarding / preferences
  userPreferences,
  // Personal transformation tracker
  transformationPlans,
  transformationSections,
  transformationItems,
  transformationDays,
  transformationChecks,
  // Health insurance
  healthInsurancePolicies,
  healthInsuranceCards,
  healthInsuranceClaims,
  healthInsurancePortability,
  // Vehicles
  vehicles,
  vehicleInsurancePolicies,
  vehiclePuc,
  vehicleServiceLog,
  // Subscriptions
  subscriptions,
  // GST / business
  businessProfile,
  customers,
  vendors,
  invoices,
  invoiceItems,
  purchaseInvoices,
  taxPayments,
  // Budget / cashflow
  budgetCategories,
  budgetEntries,
  recurringExpenses,
  budgetCarryForward,
  // Goals + projections
  financialGoals,
  projectionCategories,
  projectionEntries,
  carryforwardBalances,
  savingsAssetInclusion,
  assetClassReturns,
  cashflowEvents,
  futureSavingsPlan,
  retirementAssetSelection,
  retirementAssumptions,
  // Investments
  holdings,
  mutualFunds,
  sips,
  chitFunds,
  chitFundInstallments,
  goldHoldings,
  npsAccounts,
  fixedDeposits,
  forexDeposits,
  epfAccounts,
  smallSavingsAccounts,
  smallSavingsTransactions,
  realEstate,
  rentalHistory,
  insurancePolicies,
  liabilities,
  creditCardExpenses,
  loanAmortization,
  investmentTransactions,
  // Tax / docs
  taxDeductions,
  taxDocuments,
  yearlyInvestmentPlan,
  // Snapshots
  priceSnapshots,
  // Alerts
  alertRules,
  alertHistory,
  // Capital gains + tax paid
  capitalGains,
  incomeTaxPaid,
  salaryIncome,
  form26asUploads,
  form16Uploads,
  tdsCredits,
  advanceTaxInstallments,
  itrFormSelection,
  presumptiveIncome,
  otherSourcesIncome,
  taxSectionPreferences,
  fyCloseStatus,
} from '@/db/schema';
import { EXCLUDED_TABLES } from './constants';

export interface TableSpec {
  /** Drizzle table object name (camelCase, matches `import` from schema). */
  tableName: string;
  /** The Drizzle `pgTable` object — used at runtime for typed queries. */
  drizzleTable: PgTable;
  /** True when the table carries a `notes` text column (UI signal only). */
  hasNotes: boolean;
  /** Names of parent tables that must be inserted before this one. */
  parents: string[];
  /**
   * True when at least one of the parents is optional (FK column is
   * nullable). Import sets the FK to null when the parent is missing
   * from the payload instead of failing.
   */
  optionalParent?: boolean;
}

/**
 * FK-safe forward insert order. Children NEVER appear before any of
 * their required parents.
 */
export const MANIFEST: TableSpec[] = [
  // Tier 0 — root tables (no FK to other user data)
  { tableName: 'userPreferences', drizzleTable: userPreferences, hasNotes: false, parents: [] },
  { tableName: 'transformationPlans', drizzleTable: transformationPlans, hasNotes: true, parents: [] },
  { tableName: 'healthInsurancePolicies', drizzleTable: healthInsurancePolicies, hasNotes: true, parents: [] },
  { tableName: 'vehicles', drizzleTable: vehicles, hasNotes: true, parents: [] },
  { tableName: 'subscriptions', drizzleTable: subscriptions, hasNotes: true, parents: [] },
  { tableName: 'businessProfile', drizzleTable: businessProfile, hasNotes: false, parents: [] },
  { tableName: 'customers', drizzleTable: customers, hasNotes: false, parents: [] },
  { tableName: 'vendors', drizzleTable: vendors, hasNotes: false, parents: [] },
  { tableName: 'taxPayments', drizzleTable: taxPayments, hasNotes: false, parents: [] },
  { tableName: 'budgetCategories', drizzleTable: budgetCategories, hasNotes: false, parents: [] },
  { tableName: 'budgetCarryForward', drizzleTable: budgetCarryForward, hasNotes: false, parents: [] },
  { tableName: 'financialGoals', drizzleTable: financialGoals, hasNotes: false, parents: [] },
  { tableName: 'assetClassReturns', drizzleTable: assetClassReturns, hasNotes: false, parents: [] },
  { tableName: 'futureSavingsPlan', drizzleTable: futureSavingsPlan, hasNotes: false, parents: [] },
  { tableName: 'retirementAssetSelection', drizzleTable: retirementAssetSelection, hasNotes: false, parents: [] },
  { tableName: 'retirementAssumptions', drizzleTable: retirementAssumptions, hasNotes: false, parents: [] },
  { tableName: 'holdings', drizzleTable: holdings, hasNotes: true, parents: [] },
  { tableName: 'mutualFunds', drizzleTable: mutualFunds, hasNotes: true, parents: [] },
  { tableName: 'chitFunds', drizzleTable: chitFunds, hasNotes: true, parents: [] },
  { tableName: 'goldHoldings', drizzleTable: goldHoldings, hasNotes: true, parents: [] },
  { tableName: 'npsAccounts', drizzleTable: npsAccounts, hasNotes: true, parents: [] },
  { tableName: 'fixedDeposits', drizzleTable: fixedDeposits, hasNotes: true, parents: [] },
  { tableName: 'forexDeposits', drizzleTable: forexDeposits, hasNotes: true, parents: [] },
  { tableName: 'epfAccounts', drizzleTable: epfAccounts, hasNotes: true, parents: [] },
  { tableName: 'smallSavingsAccounts', drizzleTable: smallSavingsAccounts, hasNotes: true, parents: [] },
  { tableName: 'realEstate', drizzleTable: realEstate, hasNotes: true, parents: [] },
  { tableName: 'insurancePolicies', drizzleTable: insurancePolicies, hasNotes: true, parents: [] },
  { tableName: 'liabilities', drizzleTable: liabilities, hasNotes: true, parents: [] },
  { tableName: 'investmentTransactions', drizzleTable: investmentTransactions, hasNotes: true, parents: [] },
  { tableName: 'taxDeductions', drizzleTable: taxDeductions, hasNotes: true, parents: [] },
  { tableName: 'taxDocuments', drizzleTable: taxDocuments, hasNotes: true, parents: [] },
  { tableName: 'yearlyInvestmentPlan', drizzleTable: yearlyInvestmentPlan, hasNotes: true, parents: [] },
  { tableName: 'priceSnapshots', drizzleTable: priceSnapshots, hasNotes: false, parents: [] },
  { tableName: 'alertRules', drizzleTable: alertRules, hasNotes: false, parents: [] },
  { tableName: 'capitalGains', drizzleTable: capitalGains, hasNotes: true, parents: [] },
  { tableName: 'incomeTaxPaid', drizzleTable: incomeTaxPaid, hasNotes: true, parents: [] },
  { tableName: 'salaryIncome', drizzleTable: salaryIncome, hasNotes: true, parents: [] },
  { tableName: 'form26asUploads', drizzleTable: form26asUploads, hasNotes: true, parents: [] },
  // Sprint B — Form 16 uploads. Root table, no FKs to other user data.
  { tableName: 'form16Uploads', drizzleTable: form16Uploads, hasNotes: true, parents: [] },
  { tableName: 'advanceTaxInstallments', drizzleTable: advanceTaxInstallments, hasNotes: true, parents: [] },
  { tableName: 'itrFormSelection', drizzleTable: itrFormSelection, hasNotes: false, parents: [] },
  { tableName: 'presumptiveIncome', drizzleTable: presumptiveIncome, hasNotes: true, parents: [] },
  { tableName: 'otherSourcesIncome', drizzleTable: otherSourcesIncome, hasNotes: true, parents: [] },
  { tableName: 'taxSectionPreferences', drizzleTable: taxSectionPreferences, hasNotes: false, parents: [] },
  { tableName: 'fyCloseStatus', drizzleTable: fyCloseStatus, hasNotes: true, parents: [] },

  // Tier 1 — single parent dependency
  { tableName: 'transformationSections', drizzleTable: transformationSections, hasNotes: false, parents: ['transformationPlans'] },
  { tableName: 'transformationDays', drizzleTable: transformationDays, hasNotes: false, parents: ['transformationPlans'] },
  { tableName: 'healthInsuranceCards', drizzleTable: healthInsuranceCards, hasNotes: true, parents: ['healthInsurancePolicies'] },
  { tableName: 'healthInsurancePortability', drizzleTable: healthInsurancePortability, hasNotes: true, parents: ['healthInsurancePolicies'] },
  { tableName: 'vehicleInsurancePolicies', drizzleTable: vehicleInsurancePolicies, hasNotes: true, parents: ['vehicles'] },
  { tableName: 'vehiclePuc', drizzleTable: vehiclePuc, hasNotes: true, parents: ['vehicles'] },
  { tableName: 'vehicleServiceLog', drizzleTable: vehicleServiceLog, hasNotes: true, parents: ['vehicles'] },
  { tableName: 'invoices', drizzleTable: invoices, hasNotes: true, parents: ['customers'] },
  { tableName: 'purchaseInvoices', drizzleTable: purchaseInvoices, hasNotes: true, parents: ['vendors'] },
  { tableName: 'budgetEntries', drizzleTable: budgetEntries, hasNotes: true, parents: ['budgetCategories'] },
  { tableName: 'recurringExpenses', drizzleTable: recurringExpenses, hasNotes: true, parents: ['budgetCategories'] },
  // financialGoals → projectionCategories is OPTIONAL FK (goalId nullable);
  // projectionCategories therefore needs financialGoals listed but flagged optional.
  { tableName: 'projectionCategories', drizzleTable: projectionCategories, hasNotes: false, parents: ['financialGoals'], optionalParent: true },
  // savingsAssetInclusion also has an OPTIONAL goalId.
  { tableName: 'savingsAssetInclusion', drizzleTable: savingsAssetInclusion, hasNotes: false, parents: ['financialGoals'], optionalParent: true },
  // cashflowEvents OPTIONAL goalId (onDelete: set null).
  { tableName: 'cashflowEvents', drizzleTable: cashflowEvents, hasNotes: true, parents: ['financialGoals'], optionalParent: true },
  { tableName: 'sips', drizzleTable: sips, hasNotes: true, parents: ['mutualFunds'] },
  { tableName: 'chitFundInstallments', drizzleTable: chitFundInstallments, hasNotes: true, parents: ['chitFunds'] },
  { tableName: 'smallSavingsTransactions', drizzleTable: smallSavingsTransactions, hasNotes: true, parents: ['smallSavingsAccounts'] },
  { tableName: 'rentalHistory', drizzleTable: rentalHistory, hasNotes: true, parents: ['realEstate'] },
  { tableName: 'creditCardExpenses', drizzleTable: creditCardExpenses, hasNotes: true, parents: ['liabilities'] },
  { tableName: 'loanAmortization', drizzleTable: loanAmortization, hasNotes: true, parents: ['liabilities'] },
  { tableName: 'alertHistory', drizzleTable: alertHistory, hasNotes: false, parents: ['alertRules'] },
  // tdsCredits has an OPTIONAL reconciledViaUploadId → form_26as_uploads.
  { tableName: 'tdsCredits', drizzleTable: tdsCredits, hasNotes: true, parents: ['form26asUploads'], optionalParent: true },

  // Tier 2 — multi-parent or grandchild
  { tableName: 'healthInsuranceClaims', drizzleTable: healthInsuranceClaims, hasNotes: true, parents: ['healthInsurancePolicies', 'healthInsuranceCards'] },
  { tableName: 'transformationItems', drizzleTable: transformationItems, hasNotes: false, parents: ['transformationSections'] },
  { tableName: 'invoiceItems', drizzleTable: invoiceItems, hasNotes: false, parents: ['invoices'] },
  { tableName: 'projectionEntries', drizzleTable: projectionEntries, hasNotes: true, parents: ['projectionCategories'] },
  { tableName: 'carryforwardBalances', drizzleTable: carryforwardBalances, hasNotes: false, parents: ['projectionCategories'] },

  // Tier 3 — depends on tier-2 entries
  { tableName: 'transformationChecks', drizzleTable: transformationChecks, hasNotes: false, parents: ['transformationDays', 'transformationItems'] },
];

/* ─── Module-load asserts ─────────────────────────────────────────────────
 * Run once on first import. Any violation throws at startup so it can't
 * silently ship broken builds.
 * ──────────────────────────────────────────────────────────────────────── */

const EXPECTED_TABLE_COUNT = 73;

if (MANIFEST.length !== EXPECTED_TABLE_COUNT) {
  throw new Error(
    `[portability/table-manifest] MANIFEST has ${MANIFEST.length} entries, expected ${EXPECTED_TABLE_COUNT}. ` +
      `If you added a user-scoped table to schema.ts, also add it here in FK-safe order; ` +
      `if you removed one, drop the entry here.`,
  );
}

{
  const seen = new Set<string>();
  for (const spec of MANIFEST) {
    for (const parent of spec.parents) {
      if (!seen.has(parent)) {
        throw new Error(
          `[portability/table-manifest] '${spec.tableName}' lists parent '${parent}' which has not appeared yet ` +
            `in MANIFEST. Reorder so parents come first.`,
        );
      }
    }
    if (seen.has(spec.tableName)) {
      throw new Error(`[portability/table-manifest] duplicate entry '${spec.tableName}'.`);
    }
    seen.add(spec.tableName);
  }
  for (const excluded of EXCLUDED_TABLES) {
    if (seen.has(excluded)) {
      throw new Error(
        `[portability/table-manifest] '${excluded}' appears in MANIFEST but is in EXCLUDED_TABLES. ` +
          `Remove from one or the other.`,
      );
    }
  }
}
