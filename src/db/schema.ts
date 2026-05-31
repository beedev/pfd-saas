import { pgTable, text, integer, real, index, uniqueIndex, timestamp, boolean, serial, primaryKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { AdapterAccountType } from 'next-auth/adapters';

/* ─── Auth.js tables ─────────────────────────────────────────────────────
 * Standard Drizzle adapter schema for next-auth v5. Tables intentionally
 * use singular lowercase names (`user`, `account`, etc.) to match the
 * adapter's expectations exactly — don't rename them.
 *
 * `user.id` is a text UUID generated client-side. Every domain table in
 * this schema carries `userId: text('user_id').references(() => users.id)`
 * so all queries can be scoped to a single tenant.
 * ──────────────────────────────────────────────────────────────────────── */

export const users = pgTable('user', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name'),
  email: text('email').unique(),
  emailVerified: timestamp('email_verified', { mode: 'date' }),
  image: text('image'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
});

export const accounts = pgTable(
  'account',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').$type<AdapterAccountType>().notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (account) => [
    primaryKey({ columns: [account.provider, account.providerAccountId] }),
  ],
);

export const sessions = pgTable('session', {
  sessionToken: text('session_token').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date' }).notNull(),
});

export const verificationTokens = pgTable(
  'verification_token',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { mode: 'date' }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

/* ─── Domain tables ─────────────────────────────────────────────────── */

// Business Profile (single row for self)
export const businessProfile = pgTable('business_profile', {
  id: serial('id').primaryKey(),
  businessName: text('business_name').notNull(),
  tradeName: text('trade_name'),
  gstin: text('gstin').notNull().unique(),
  pan: text('pan').notNull(),
  stateCode: text('state_code').notNull(),
  address: text('address'),
  city: text('city'),
  pincode: text('pincode'),
  email: text('email'),
  phone: text('phone'),
  financialYear: text('financial_year').notNull(),
  invoicePrefix: text('invoice_prefix'),
  invoiceStartNumber: integer('invoice_start_number').default(1),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('business_profile_user_id_idx').on(table.userId),
]);

// Supply types for customers (determines GST treatment)
export type SupplyType = 'REGULAR' | 'EXPORT_WITH_IGST' | 'EXPORT_LUT' | 'SEZ';

// Customers (B2B with GSTIN, B2C without)
export const customers = pgTable('customers', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  gstin: text('gstin'),
  pan: text('pan'),
  stateCode: text('state_code').notNull(),
  address: text('address'),
  city: text('city'),
  pincode: text('pincode'),
  email: text('email'),
  phone: text('phone'),
  isB2B: boolean('is_b2b').notNull().default(false),
  supplyType: text('supply_type').$type<SupplyType>().default('REGULAR'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('customers_gstin_idx').on(table.gstin),
  index('customers_state_idx').on(table.stateCode),
  index('customers_user_id_idx').on(table.userId),
]);

// Vendors (for ITC tracking)
export const vendors = pgTable('vendors', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  gstin: text('gstin').notNull(),
  pan: text('pan'),
  stateCode: text('state_code').notNull(),
  address: text('address'),
  city: text('city'),
  pincode: text('pincode'),
  email: text('email'),
  phone: text('phone'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  uniqueIndex('vendors_gstin_idx').on(table.gstin),
  index('vendors_user_id_idx').on(table.userId),
]);

// SAC Codes Master
export const sacCodes = pgTable('sac_codes', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  description: text('description').notNull(),
  defaultTaxRate: real('default_tax_rate').default(18),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
}, (table) => [
  uniqueIndex('sac_code_idx').on(table.code),
]);

// Invoice types
export type InvoiceType = 'B2B' | 'B2C' | 'CREDIT_NOTE' | 'DEBIT_NOTE';
export type InvoiceStatus = 'DRAFT' | 'FINAL' | 'FILED';

// Sales Invoices (Outward Supplies)
export const invoices = pgTable('invoices', {
  id: serial('id').primaryKey(),
  invoiceNumber: text('invoice_number').notNull(),
  invoiceDate: text('invoice_date').notNull(),
  customerId: integer('customer_id').references(() => customers.id),
  customerName: text('customer_name').notNull(),
  customerGstin: text('customer_gstin'),

  invoiceType: text('invoice_type').$type<InvoiceType>().notNull(),
  originalInvoiceId: integer('original_invoice_id'),
  originalInvoiceNumber: text('original_invoice_number'),
  originalInvoiceDate: text('original_invoice_date'),

  placeOfSupplyCode: text('place_of_supply_code').notNull(),
  isInterState: boolean('is_inter_state').notNull(),
  isReverseCharge: boolean('is_reverse_charge').default(false),
  supplyType: text('supply_type').$type<SupplyType>().default('REGULAR'),

  // Amounts stored in paisa for precision
  taxableAmount: integer('taxable_amount').notNull(),
  cgstAmount: integer('cgst_amount').default(0),
  sgstAmount: integer('sgst_amount').default(0),
  igstAmount: integer('igst_amount').default(0),
  cessAmount: integer('cess_amount').default(0),
  totalAmount: integer('total_amount').notNull(),

  returnPeriod: text('return_period').notNull(),
  status: text('status').$type<InvoiceStatus>().default('DRAFT'),
  notes: text('notes'),

  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  uniqueIndex('invoice_number_idx').on(table.invoiceNumber),
  index('invoice_period_idx').on(table.returnPeriod),
  index('invoice_customer_idx').on(table.customerId),
  index('invoice_type_idx').on(table.invoiceType),
  index('invoices_user_id_idx').on(table.userId),
]);

// Invoice Line Items
export const invoiceItems = pgTable('invoice_items', {
  id: serial('id').primaryKey(),
  invoiceId: integer('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),

  description: text('description').notNull(),
  sacCode: text('sac_code').notNull(),
  quantity: real('quantity').default(1),
  unitPrice: integer('unit_price').notNull(),
  discount: integer('discount').default(0),

  taxableAmount: integer('taxable_amount').notNull(),
  taxRate: real('tax_rate').notNull(),

  cgstRate: real('cgst_rate').default(0),
  cgstAmount: integer('cgst_amount').default(0),
  sgstRate: real('sgst_rate').default(0),
  sgstAmount: integer('sgst_amount').default(0),
  igstRate: real('igst_rate').default(0),
  igstAmount: integer('igst_amount').default(0),

  totalAmount: integer('total_amount').notNull(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('item_invoice_idx').on(table.invoiceId),
  index('item_sac_idx').on(table.sacCode),
  index('invoice_items_user_id_idx').on(table.userId),
]);

// Purchase Invoices (for ITC)
export const purchaseInvoices = pgTable('purchase_invoices', {
  id: serial('id').primaryKey(),
  vendorId: integer('vendor_id').notNull().references(() => vendors.id),
  vendorName: text('vendor_name').notNull(),
  vendorGstin: text('vendor_gstin').notNull(),
  invoiceNumber: text('invoice_number').notNull(),
  invoiceDate: text('invoice_date').notNull(),

  placeOfSupplyCode: text('place_of_supply_code').notNull(),
  isInterState: boolean('is_inter_state').notNull(),
  isReverseCharge: boolean('is_reverse_charge').default(false),

  taxableAmount: integer('taxable_amount').notNull(),
  cgstAmount: integer('cgst_amount').default(0),
  sgstAmount: integer('sgst_amount').default(0),
  igstAmount: integer('igst_amount').default(0),
  cessAmount: integer('cess_amount').default(0),
  totalAmount: integer('total_amount').notNull(),

  itcEligible: boolean('itc_eligible').default(true),
  itcClaimed: boolean('itc_claimed').default(false),

  returnPeriod: text('return_period').notNull(),
  notes: text('notes'),

  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('purchase_vendor_idx').on(table.vendorId),
  index('purchase_period_idx').on(table.returnPeriod),
  index('purchase_invoices_user_id_idx').on(table.userId),
]);

// Tax Payment Records
export type PaymentStatus = 'PENDING' | 'PAID' | 'FILED';

export const taxPayments = pgTable('tax_payments', {
  id: serial('id').primaryKey(),
  returnPeriod: text('return_period').notNull(),

  cgstLiability: integer('cgst_liability').default(0),
  sgstLiability: integer('sgst_liability').default(0),
  igstLiability: integer('igst_liability').default(0),
  cessLiability: integer('cess_liability').default(0),

  cgstItcUtilized: integer('cgst_itc_utilized').default(0),
  sgstItcUtilized: integer('sgst_itc_utilized').default(0),
  igstItcUtilized: integer('igst_itc_utilized').default(0),

  cgstCashPaid: integer('cgst_cash_paid').default(0),
  sgstCashPaid: integer('sgst_cash_paid').default(0),
  igstCashPaid: integer('igst_cash_paid').default(0),
  cessCashPaid: integer('cess_cash_paid').default(0),

  status: text('status').$type<PaymentStatus>().default('PENDING'),
  paymentDate: text('payment_date'),
  paymentReference: text('payment_reference'),

  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  uniqueIndex('payment_period_idx').on(table.returnPeriod),
  index('tax_payments_user_id_idx').on(table.userId),
]);

// ============================================================================
// PERSONAL FINANCE TRACKING TABLES
// ============================================================================

// Budget Categories (user-defined, extensible)
export type CategoryType = 'INCOME' | 'EXPENSE';

export const budgetCategories = pgTable('budget_categories', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').$type<CategoryType>().notNull(),
  sortOrder: integer('sort_order').default(0),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('budget_categories_user_id_idx').on(table.userId),
]);

// Monthly Budget Entries (planned vs actual per category per month)
export const budgetEntries = pgTable('budget_entries', {
  id: serial('id').primaryKey(),
  categoryId: integer('category_id').notNull().references(() => budgetCategories.id, { onDelete: 'cascade' }),
  period: text('period').notNull(),           // MMYYYY format
  plannedAmount: integer('planned_amount').default(0),  // in paisa
  actualAmount: integer('actual_amount').default(0),    // in paisa
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('budget_period_idx').on(table.period),
  uniqueIndex('budget_category_period_idx').on(table.categoryId, table.period),
  index('budget_entries_user_id_idx').on(table.userId),
]);

// Recurring Expense Templates — auto-populates budget_entries for future periods
export type RecurrenceType = 'ONE_TIME' | 'MONTHLY' | 'QUARTERLY' | 'ANNUALLY';

export const recurringExpenses = pgTable('recurring_expenses', {
  id: serial('id').primaryKey(),
  categoryId: integer('category_id').notNull().references(() => budgetCategories.id, { onDelete: 'cascade' }),
  amount: integer('amount').notNull(),                    // paisa
  recurrence: text('recurrence').$type<RecurrenceType>().notNull(),
  startPeriod: text('start_period').notNull(),            // MMYYYY
  endPeriod: text('end_period'),                          // MMYYYY, NULL = forever
  notes: text('notes'),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('recurring_expenses_category_idx').on(table.categoryId),
  index('recurring_expenses_active_idx').on(table.isActive),
  index('recurring_expenses_user_id_idx').on(table.userId),
]);

export type RecurringExpense = typeof recurringExpenses.$inferSelect;
export type NewRecurringExpense = typeof recurringExpenses.$inferInsert;

// Budget Carry Forward (savings carried to next month)
export const budgetCarryForward = pgTable('budget_carry_forward', {
  id: serial('id').primaryKey(),
  period: text('period').notNull().unique(),   // MMYYYY — the month this carry-forward GOES INTO
  amount: integer('amount').notNull().default(0), // paisa
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('budget_carry_forward_user_id_idx').on(table.userId),
]);

// Financial Goals (for 3-year projections tracking)
export const financialGoals = pgTable('financial_goals', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),               // e.g., "Marriage", "Pilot Training"
  targetAmount: integer('target_amount').notNull(),  // in paisa
  targetDate: text('target_date'),            // ISO date string
  currentAmount: integer('current_amount').default(0),  // in paisa
  color: text('color'),                       // for charts (e.g., "#4CAF50")
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('financial_goals_user_id_idx').on(table.userId),
]);

// Projection Categories (columns in the projection grid)
export const projectionCategories = pgTable('projection_categories', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),               // SIP, RD, Car Loan, Chit, etc.
  isInflow: boolean('is_inflow').notNull().default(true),
  goalId: integer('goal_id').references(() => financialGoals.id),  // optional link to goal
  sortOrder: integer('sort_order').default(0),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('projection_categories_user_id_idx').on(table.userId),
]);

// Projection Entries (monthly cashflow projections - cells in the grid)
export const projectionEntries = pgTable('projection_entries', {
  id: serial('id').primaryKey(),
  categoryId: integer('category_id').notNull().references(() => projectionCategories.id, { onDelete: 'cascade' }),
  period: text('period').notNull(),           // MMYYYY
  amount: integer('amount').notNull(),        // in paisa (always positive, direction from category)
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('projection_period_idx').on(table.period),
  index('projection_category_idx').on(table.categoryId),
  uniqueIndex('projection_category_period_idx').on(table.categoryId, table.period),
  index('projection_entries_user_id_idx').on(table.userId),
]);

// Carryforward Balances (opening balances for projections)
export const carryforwardBalances = pgTable('carryforward_balances', {
  id: serial('id').primaryKey(),
  categoryId: integer('category_id').notNull().references(() => projectionCategories.id, { onDelete: 'cascade' }),
  amount: integer('amount').notNull(),            // in paisa
  asOfDate: text('as_of_date').notNull(),         // ISO date
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  uniqueIndex('carryforward_category_idx').on(table.categoryId),
  index('carryforward_balances_user_id_idx').on(table.userId),
]);

/**
 * Savings Asset Inclusion — which portfolio asset classes count as "savings"
 * on the /projections coverage view. One row per (assetClass, goalId) pair.
 *
 * For Phase A every row has goalId=null (one global setting). goalId is
 * reserved for per-goal earmarking — a future enhancement where individual
 * goals can be backed by specific asset classes.
 *
 * assetClass values: STOCKS, MUTUAL_FUNDS, CHIT_FUNDS, GOLD, NPS, PF,
 *                    INSURANCE_CASH (extend as new classes appear in the app).
 */
export const savingsAssetInclusion = pgTable('savings_asset_inclusion', {
  id: serial('id').primaryKey(),
  assetClass: text('asset_class').notNull(),
  // Optional sub-identifier within an asset class. NULL = the whole class
  // (used by aggregate classes like STOCKS, MUTUAL_FUNDS). Populated for
  // itemized classes — e.g. one row per insurance policy (sourceId =
  // insurance_policies.id) or one row per chit fund (sourceId = chit_funds.id).
  sourceId: integer('source_id'),
  included: boolean('included').notNull().default(false),
  goalId: integer('goal_id').references(() => financialGoals.id, { onDelete: 'cascade' }),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('savings_asset_class_idx').on(table.assetClass),
  index('savings_asset_source_idx').on(table.assetClass, table.sourceId),
  index('savings_asset_inclusion_user_id_idx').on(table.userId),
]);

export type SavingsAssetInclusion = typeof savingsAssetInclusion.$inferSelect;

/**
 * Future Savings Plan — singleton row holding forward-looking inputs that
 * project current asset-backed savings onto goal target dates. Replaces the
 * old manual carryforward-style categories (which were source-less and prone
 * to drift / double-counting with real portfolio values).
 *
 *   lumpSumPaisa  — one-time future addition (bonus, FD maturity, gift, sale)
 *   monthlyPaisa  — recurring monthly addition from take-home cashflow
 *
 * Projected balance at any future date T:
 *   assetBacked + lumpSumPaisa + monthlyPaisa × monthsUntil(T)
 */
export const futureSavingsPlan = pgTable('future_savings_plan', {
  id: serial('id').primaryKey(),
  lumpSumPaisa: integer('lump_sum_paisa').notNull().default(0),
  monthlyPaisa: integer('monthly_paisa').notNull().default(0),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('future_savings_plan_user_id_idx').on(table.userId),
]);

export type FutureSavingsPlan = typeof futureSavingsPlan.$inferSelect;

/**
 * Retirement Asset Selection — which assets feed the retirement projection
 * and how each contributes (lumpsum / income / rental / sell).
 *
 * One row per item; assetClass values: NPS, PF, ANNUITY_POLICIES,
 * INSURANCE_POLICIES, REAL_ESTATE. mode is REAL_ESTATE-only ('SELL'|'RENTAL').
 * salePriceOverride lets the user enter a sale price that overrides the
 * compounded current_valuation projection. NPS-only fields control the
 * 60/40 split and the assumed annuity-yield.
 */
export const retirementAssetSelection = pgTable('retirement_asset_selection', {
  id: serial('id').primaryKey(),
  assetClass: text('asset_class').notNull(),
  sourceId: integer('source_id').notNull(),
  included: boolean('included').notNull().default(true),
  mode: text('mode'),                              // 'SELL' | 'RENTAL' for REAL_ESTATE
  salePriceOverridePaisa: integer('sale_price_override_paisa'),
  // For REAL_ESTATE in RENTAL mode: expected monthly rent at retirement
  // (already inflation-adjusted to future value). Used directly as ×12
  // annual income — no further inflation applied — so the user can model
  // "I'll rent it out after I retire" without needing current monthly_rent.
  expectedFutureRentPaisa: integer('expected_future_rent_paisa'),
  npsLumpsumPct: real('nps_lumpsum_pct'),          // default 60
  npsAnnuityRatePct: real('nps_annuity_rate_pct'), // default 6
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('retirement_asset_class_idx').on(table.assetClass),
  uniqueIndex('retirement_asset_unique_idx').on(table.assetClass, table.sourceId),
  index('retirement_asset_selection_user_id_idx').on(table.userId),
]);

export type RetirementAssetSelection = typeof retirementAssetSelection.$inferSelect;

/**
 * Retirement Assumptions — singleton row (id=1) holding the planning inputs.
 * Persisted so the values stick across page loads / devices — the old page
 * reset to defaults every visit, which made the projection look wildly off
 * (e.g. NPS appeared as ₹93L because the 30→60 default horizon compounded
 * the corpus for 30 years instead of the user's real 7).
 */
export const retirementAssumptions = pgTable('retirement_assumptions', {
  id: serial('id').primaryKey(),
  currentAge: integer('current_age').notNull().default(30),
  targetAge: integer('target_age').notNull().default(60),
  monthlyExpenseRupees: integer('monthly_expense_rupees').notNull().default(50000),
  inflationPct: real('inflation_pct').notNull().default(6),
  expectedReturnPct: real('expected_return_pct').notNull().default(10),
  // Lower assumed return during retirement — corpus is typically rebalanced
  // toward fixed-income post-retirement. Default 8 keeps the runway honest.
  postRetirementReturnPct: real('post_retirement_return_pct').notNull().default(8),
  // Per-class "income grows with inflation?" flags. The math routes each
  // class's income to either the fixed-PV bucket or the growing-PV bucket
  // based on these. Defaults match the typical real-world behaviour:
  //   rental + LIC annuity → grow (rentals track inflation; LIC bonus +5%/y)
  //   NPS annuity + LIC ladder smoothed → flat
  npsIncomeGrows: boolean('nps_income_grows').notNull().default(false),
  annuityIncomeGrows: boolean('annuity_income_grows').notNull().default(true),
  insuranceLadderIncomeGrows: boolean('insurance_ladder_income_grows').notNull().default(false),
  rentalIncomeGrows: boolean('rental_income_grows').notNull().default(true),
  // Age at which the LIC ladder starts paying out. Most LIC endowments
  // mature at a fixed age (commonly 60+) regardless of when the user retires;
  // override per user. If <= targetAge, ladder begins immediately at
  // retirement.
  ladderStartAge: integer('ladder_start_age').notNull().default(60),
  // Three-bucket SWP allocation. Together must add up to 100. Each bucket has
  // its own return rate. Refill thresholds (in years of expense) drive the
  // event-driven cascade: when Liquid falls below liquidYrsHeld years of
  // current expense, refill from Stable; when Stable falls below stableYrsHeld,
  // refill from Growth.
  bucketEnabled: boolean('bucket_enabled').notNull().default(false),
  liquidPct: real('liquid_pct').notNull().default(10),
  stablePct: real('stable_pct').notNull().default(30),
  growthPct: real('growth_pct').notNull().default(60),
  liquidReturnPct: real('liquid_return_pct').notNull().default(6),
  stableReturnPct: real('stable_return_pct').notNull().default(8),
  growthReturnPct: real('growth_return_pct').notNull().default(11),
  liquidYrsHeld: real('liquid_yrs_held').notNull().default(1),
  stableYrsHeld: real('stable_yrs_held').notNull().default(3),
  retirementDurationYears: integer('retirement_duration_years').notNull().default(25),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('retirement_assumptions_user_id_idx').on(table.userId),
]);

export type RetirementAssumptions = typeof retirementAssumptions.$inferSelect;

// ============================================================================
// INVESTMENT PORTFOLIO TABLES
// ============================================================================

// 1. Holdings (Stocks / ETFs)
export const holdings = pgTable('holdings', {
  id: serial('id').primaryKey(),
  symbol: text('symbol').notNull(),
  quantity: real('quantity').notNull(),
  averagePrice: integer('average_price').notNull(),
  currentPrice: integer('current_price').notNull(),
  purchaseDate: text('purchase_date').notNull(),
  totalInvestment: integer('total_investment').notNull(),
  currentValue: integer('current_value').notNull(),
  gainLoss: integer('gain_loss').notNull(),
  gainLossPercent: real('gain_loss_percent').notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('holdings_symbol_idx').on(table.symbol),
  uniqueIndex('holdings_symbol_unique').on(table.symbol),
  index('holdings_user_id_idx').on(table.userId),
]);

export type Holding = typeof holdings.$inferSelect;
export type NewHolding = typeof holdings.$inferInsert;

// 2. Mutual Funds
export type MutualFundType = 'EQUITY' | 'DEBT' | 'HYBRID' | 'LIQUID' | 'GOLD';

export const mutualFunds = pgTable('mutual_funds', {
  id: serial('id').primaryKey(),
  isin: text('isin').notNull(),
  schemeName: text('scheme_name').notNull(),
  fundType: text('fund_type').$type<MutualFundType>().notNull(),
  folioNumber: text('folio_number'),
  units: real('units').notNull(),
  nav: integer('nav').notNull(),
  totalInvestment: integer('total_investment').notNull(),
  currentValue: integer('current_value').notNull(),
  gainLoss: integer('gain_loss').notNull(),
  gainLossPercent: real('gain_loss_percent').notNull(),
  lastNavDate: text('last_nav_date'),
  investmentStartDate: text('investment_start_date'), // ISO date — for CAGR computation
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('mf_isin_idx').on(table.isin),
  index('mf_folio_idx').on(table.folioNumber),
  index('mutual_funds_user_id_idx').on(table.userId),
]);

export type MutualFund = typeof mutualFunds.$inferSelect;
export type NewMutualFund = typeof mutualFunds.$inferInsert;

// 3. SIPs
export type SIPFrequency = 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUAL' | 'ANNUAL';
export type SIPStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED';

export const sips = pgTable('sips', {
  id: serial('id').primaryKey(),
  mutualFundId: integer('mutual_fund_id').notNull().references(() => mutualFunds.id, { onDelete: 'cascade' }),
  startingUnits: real('starting_units').notNull(),
  startingNav: integer('starting_nav').notNull(),
  monthlyAmount: integer('monthly_amount').notNull(),
  frequency: text('frequency').$type<SIPFrequency>().notNull().default('MONTHLY'),
  startDate: text('start_date').notNull(),
  endDate: text('end_date'),
  status: text('status').$type<SIPStatus>().default('ACTIVE'),
  totalInvestedSoFar: integer('total_invested_so_far').notNull().default(0),
  lastExecutionDate: text('last_execution_date'),
  nextExecutionDate: text('next_execution_date'),
  expectedXirr: real('expected_xirr'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('sip_mf_idx').on(table.mutualFundId),
  index('sip_status_idx').on(table.status),
  index('sips_user_id_idx').on(table.userId),
]);

export type SIP = typeof sips.$inferSelect;
export type NewSIP = typeof sips.$inferInsert;

// 3b. Chit Funds
export type ChitFundStatus = 'ACTIVE' | 'WON' | 'COMPLETED' | 'WITHDRAWN';
export type ChitPaymentMethod = 'CASH' | 'CHEQUE' | 'NEFT' | 'UPI' | 'CARD';

export const chitFunds = pgTable('chit_funds', {
  id: serial('id').primaryKey(),
  foremanName: text('foreman_name').notNull(),
  schemeName: text('scheme_name').notNull(),
  registrationNumber: text('registration_number'),
  isRegistered: boolean('is_registered').default(true),

  chitValue: integer('chit_value').notNull(),
  monthlyInstallment: integer('monthly_installment').notNull(),
  durationMonths: integer('duration_months').notNull(),
  groupSize: integer('group_size').notNull(),
  ticketNumber: text('ticket_number'),
  startDate: text('start_date').notNull(),
  expectedEndDate: text('expected_end_date').notNull(),
  foremanCommissionPct: real('foreman_commission_pct').default(5),
  documentChargesPaisa: integer('document_charges_paisa').default(0),
  promptPaymentDiscountPct: real('prompt_payment_discount_pct').default(0),

  // Running state
  installmentsPaid: integer('installments_paid').default(0),
  totalPaid: integer('total_paid').default(0),
  totalDividends: integer('total_dividends').default(0),
  netContribution: integer('net_contribution').default(0),

  // Winning state
  status: text('status').$type<ChitFundStatus>().default('ACTIVE'),
  winMonth: integer('win_month'),
  winDate: text('win_date'),
  winBidDiscountPct: real('win_bid_discount_pct'),
  winAmountReceived: integer('win_amount_received'),

  xirr: real('xirr'),
  nextDueDate: text('next_due_date'),

  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('chit_status_idx').on(table.status),
  index('chit_foreman_idx').on(table.foremanName),
  index('chit_funds_user_id_idx').on(table.userId),
]);

export const chitFundInstallments = pgTable('chit_fund_installments', {
  id: serial('id').primaryKey(),
  chitFundId: integer('chit_fund_id').notNull().references(() => chitFunds.id, { onDelete: 'cascade' }),
  monthNumber: integer('month_number').notNull(),
  dueDate: text('due_date').notNull(),
  installmentPaid: integer('installment_paid').notNull(),
  dividendReceived: integer('dividend_received').default(0),
  netOutgo: integer('net_outgo').notNull(),
  paidOn: text('paid_on').notNull(),
  paymentMethod: text('payment_method').$type<ChitPaymentMethod>().default('NEFT'),
  winnerName: text('winner_name'),
  winnerBidDiscountPct: real('winner_bid_discount_pct'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('chit_install_fund_idx').on(table.chitFundId),
  index('chit_install_month_idx').on(table.monthNumber),
  index('chit_fund_installments_user_id_idx').on(table.userId),
]);

export type ChitFund = typeof chitFunds.$inferSelect;
export type NewChitFund = typeof chitFunds.$inferInsert;
export type ChitFundInstallment = typeof chitFundInstallments.$inferSelect;
export type NewChitFundInstallment = typeof chitFundInstallments.$inferInsert;

// 4. Gold Holdings
export type GoldType = 'PHYSICAL' | 'ETF' | 'GOLD_BOND' | 'DIGITAL';
export type GoldPurity = '999' | '995' | '916';

export const goldHoldings = pgTable('gold_holdings', {
  id: serial('id').primaryKey(),
  type: text('type').$type<GoldType>().notNull(),
  // Legacy columns (kept to avoid breaking existing rows)
  quantity: real('quantity').notNull(),
  currentPrice: integer('current_price').notNull(),
  totalValue: integer('total_value').notNull(),
  purchasePrice: integer('purchase_price'),
  certificateNumber: text('certificate_number'),
  lastPriceUpdate: text('last_price_update'),

  // Phase 3 columns
  name: text('name'),
  grams: real('grams'),
  purity: text('purity').$type<GoldPurity>(),
  purchaseDate: text('purchase_date'),
  purchasePricePerGram: integer('purchase_price_per_gram'),
  currentRatePerGram: integer('current_rate_per_gram'),
  lastRateUpdate: text('last_rate_update'),
  totalInvestment: integer('total_investment'),
  currentValue: integer('current_value'),
  gainLoss: integer('gain_loss'),
  gainLossPercent: real('gain_loss_percent'),
  notes: text('notes'),

  // SGB-specific
  sgbSeries: text('sgb_series'),
  sgbIssueDate: text('sgb_issue_date'),
  sgbMaturityDate: text('sgb_maturity_date'),
  sgbInterestRate: real('sgb_interest_rate').default(2.5),

  // ETF-specific
  etfSymbol: text('etf_symbol'),
  etfUnits: real('etf_units'),

  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('gold_type_idx').on(table.type),
  index('gold_holdings_user_id_idx').on(table.userId),
]);

export type GoldHolding = typeof goldHoldings.$inferSelect;
export type NewGoldHolding = typeof goldHoldings.$inferInsert;

// 5. NPS Accounts
export type NPSAccountType = 'TIER1' | 'TIER2';
export type NPSAccountStatus = 'ACTIVE' | 'INACTIVE' | 'MATURED';

export const npsAccounts = pgTable('nps_accounts', {
  id: serial('id').primaryKey(),
  accountNumber: text('account_number').notNull().unique(),
  accountHolder: text('account_holder').notNull(),
  pan: text('pan').notNull(),
  tier: text('tier').$type<NPSAccountType>().notNull(),
  status: text('status').$type<NPSAccountStatus>().default('ACTIVE'),
  subscriberId: text('subscriber_id'),
  equityFundValue: integer('equity_fund_value').default(0),
  debtFundValue: integer('debt_fund_value').default(0),
  alternativeFundValue: integer('alternative_fund_value').default(0),
  totalValue: integer('total_value').notNull().default(0),
  totalContributed: integer('total_contributed').notNull().default(0),
  employerContribution: integer('employer_contribution').default(0),
  gainLoss: integer('gain_loss').default(0),
  openingDate: text('opening_date').notNull(),
  expectedMaturityDate: text('expected_maturity_date'),
  lastStatementDate: text('last_statement_date'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  uniqueIndex('nps_account_number_idx').on(table.accountNumber),
  index('nps_pan_idx').on(table.pan),
  index('nps_accounts_user_id_idx').on(table.userId),
]);

export type NPSAccount = typeof npsAccounts.$inferSelect;
export type NewNPSAccount = typeof npsAccounts.$inferInsert;

// ─── Fixed Deposits ─────────────────────────────────────────────────────
export type FDStatus = 'ACTIVE' | 'MATURED' | 'BROKEN';
export type FDCompoundingFreq = 'MONTHLY' | 'QUARTERLY' | 'HALF_YEARLY' | 'YEARLY';
export type FDInterestType = 'CUMULATIVE' | 'NON_CUMULATIVE';

export const fixedDeposits = pgTable('fixed_deposits', {
  id: serial('id').primaryKey(),
  bankName: text('bank_name').notNull(),
  accountNumber: text('account_number'),                      // FD receipt / account no
  principalPaisa: integer('principal_paisa').notNull(),
  interestRate: real('interest_rate').notNull(),               // annual %
  compoundingFreq: text('compounding_freq')
    .$type<FDCompoundingFreq>()
    .default('QUARTERLY'),
  interestType: text('interest_type')
    .$type<FDInterestType>()
    .default('CUMULATIVE'),
  startDate: text('start_date').notNull(),                     // ISO date
  maturityDate: text('maturity_date').notNull(),               // ISO date
  tenureMonths: integer('tenure_months'),                      // derived
  maturityAmountPaisa: integer('maturity_amount_paisa'),       // auto-computed
  status: text('status').$type<FDStatus>().default('ACTIVE'),
  isTaxSaver: boolean('is_tax_saver').default(false),
  autoRenew: boolean('auto_renew').default(false),
  prematureWithdrawalPenaltyPct: real('premature_withdrawal_penalty_pct').default(1.0),
  jointHolderName: text('joint_holder_name'),
  documentPath: text('document_path'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('fd_bank_idx').on(table.bankName),
  index('fd_status_idx').on(table.status),
  index('fd_maturity_idx').on(table.maturityDate),
  index('fixed_deposits_user_id_idx').on(table.userId),
]);

export type FixedDeposit = typeof fixedDeposits.$inferSelect;
export type NewFixedDeposit = typeof fixedDeposits.$inferInsert;

// 6. Provident Fund (EPF/PPF/VPF)
export type PFAccountType = 'EPF' | 'PPF' | 'VPF';

export const providentFund = pgTable('provident_fund', {
  id: serial('id').primaryKey(),
  accountType: text('account_type').$type<PFAccountType>().notNull(),
  accountNumber: text('account_number').unique(),
  accountHolder: text('account_holder').notNull(),
  pan: text('pan'),
  universalAccountNumber: text('uan'),
  employeeBalance: integer('employee_balance').default(0),
  employerBalance: integer('employer_balance').default(0),
  interestBalance: integer('interest_balance').default(0),
  totalBalance: integer('total_balance').notNull().default(0),
  totalContributed: integer('total_contributed').notNull().default(0),
  interestEarned: integer('interest_earned').default(0),
  ppfMaturityDate: text('ppf_maturity_date'),
  ppfExtensionDate: text('ppf_extension_date'),
  isActive: boolean('is_active').default(true),
  openingDate: text('opening_date').notNull(),
  lastContributionDate: text('last_contribution_date'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('pf_account_type_idx').on(table.accountType),
  index('pf_uan_idx').on(table.universalAccountNumber),
  index('provident_fund_user_id_idx').on(table.userId),
]);

export type ProvidentFund = typeof providentFund.$inferSelect;
export type NewProvidentFund = typeof providentFund.$inferInsert;

// 7. Real Estate
export type PropertyType = 'RESIDENTIAL' | 'COMMERCIAL' | 'LAND' | 'PLOT';
export type PropertyStatus = 'OWNED' | 'MORTGAGED' | 'UNDER_CONSTRUCTION' | 'RENTED';

export const realEstate = pgTable('real_estate', {
  id: serial('id').primaryKey(),
  propertyName: text('property_name').notNull(),
  type: text('type').$type<PropertyType>().notNull(),
  status: text('status').$type<PropertyStatus>().notNull(),
  address: text('address').notNull(),
  city: text('city').notNull(),
  state: text('state').notNull(),
  pincode: text('pincode'),
  latitude: real('latitude'),
  longitude: real('longitude'),
  area: real('area').notNull(),
  areaUnit: text('area_unit').default('sqft'),
  builtUpArea: real('built_up_area'),
  purchasePrice: integer('purchase_price').notNull(),
  purchaseDate: text('purchase_date').notNull(),
  currentValuation: integer('current_valuation').notNull(),
  valuationDate: text('valuation_date'),
  gainLoss: integer('gain_loss').notNull(),
  gainLossPercent: real('gain_loss_percent').notNull(),
  mortgageAmount: integer('mortgage_amount'),
  mortgageLender: text('mortgage_lender'),
  mortgageRate: real('mortgage_rate'),
  mortgageStartDate: text('mortgage_start_date'),
  mortgageEndDate: text('mortgage_end_date'),
  monthlyRent: integer('monthly_rent'),
  rentStartDate: text('rent_start_date'),
  rentTenantName: text('rent_tenant_name'),
  propertyTaxAnnual: integer('property_tax_annual'),
  lastPropertyTaxPaid: text('last_property_tax_paid'),
  documentPath: text('document_path'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('re_type_idx').on(table.type),
  index('re_city_idx').on(table.city),
  index('re_status_idx').on(table.status),
  index('real_estate_user_id_idx').on(table.userId),
]);

export type RealEstate = typeof realEstate.$inferSelect;
export type NewRealEstate = typeof realEstate.$inferInsert;

// 8. Insurance Policies
export type PolicyType = 'TERM_LIFE' | 'WHOLE_LIFE' | 'ENDOWMENT' | 'ULIP' | 'HEALTH' | 'CRITICAL_ILLNESS' | 'DISABILITY' | 'ACCIDENT';
export type PolicyStatus = 'ACTIVE' | 'LAPSED' | 'SURRENDERED' | 'MATURED' | 'CLAIMED';

export const insurancePolicies = pgTable('insurance_policies', {
  id: serial('id').primaryKey(),
  policyNumber: text('policy_number').notNull().unique(),
  policyType: text('policy_type').$type<PolicyType>().notNull(),
  status: text('status').$type<PolicyStatus>().default('ACTIVE'),
  policyHolder: text('policy_holder').notNull(),
  insurer: text('insurer').notNull(),
  insurerCode: text('insurer_code'),
  sumAssured: integer('sum_assured').notNull(),
  maturityBenefit: integer('maturity_benefit'),
  premiumAmount: integer('premium_amount').notNull(),
  premiumFrequency: text('premium_frequency'),
  policyTerm: integer('policy_term'),
  premiumPaymentTerm: integer('premium_payment_term'),
  policyStartDate: text('policy_start_date').notNull(),
  maturityDate: text('maturity_date'),
  lastPremiumPaidDate: text('last_premium_paid_date'),
  nextPremiumDueDate: text('next_premium_due_date'),
  investmentValue: integer('investment_value'),
  investmentGainLoss: integer('investment_gain_loss'),
  // Whole life / pension policies — annuity payout per period (paisa)
  annuityAmount: integer('annuity_amount'),
  annuityFrequency: text('annuity_frequency'), // MONTHLY | QUARTERLY | HALF_YEARLY | YEARLY
  annuityStartDate: text('annuity_start_date'),
  riders: text('riders'),
  documentPath: text('document_path'),
  nomineeName: text('nominee_name'),
  nomineeRelation: text('nominee_relation'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  uniqueIndex('policy_number_idx').on(table.policyNumber),
  index('policy_type_idx').on(table.policyType),
  index('policy_status_idx').on(table.status),
  index('insurance_policies_user_id_idx').on(table.userId),
]);

export type InsurancePolicy = typeof insurancePolicies.$inferSelect;
export type NewInsurancePolicy = typeof insurancePolicies.$inferInsert;

// 9. Liabilities
export type LiabilityType = 'HOME_LOAN' | 'AUTO_LOAN' | 'PERSONAL_LOAN' | 'CREDIT_CARD' | 'EDUCATION_LOAN' | 'OTHER';
export type LiabilityStatus = 'ACTIVE' | 'CLOSED' | 'DEFAULTED';

export const liabilities = pgTable('liabilities', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').$type<LiabilityType>().notNull(),
  status: text('status').$type<LiabilityStatus>().default('ACTIVE'),
  creditorName: text('creditor_name').notNull(),
  creditorType: text('creditor_type'),
  originalAmount: integer('original_amount').notNull(),
  currentBalance: integer('current_balance').notNull(),
  interestRate: real('interest_rate').notNull(),
  monthlyEmi: integer('monthly_emi').notNull(),
  startDate: text('start_date').notNull(),
  maturityDate: text('maturity_date'),
  remainingTenor: integer('remaining_tenor'),
  accountNumber: text('account_number'),
  loanNumber: text('loan_number'),
  totalPaidSoFar: integer('total_paid_so_far').default(0),
  lastPaymentDate: text('last_payment_date'),
  nextPaymentDate: text('next_payment_date'),
  collateralType: text('collateral_type'),
  collateralValue: integer('collateral_value'),
  purposeOfLoan: text('purpose_of_loan'),
  documentPath: text('document_path'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('liability_type_idx').on(table.type),
  index('liability_status_idx').on(table.status),
  index('liability_creditor_idx').on(table.creditorName),
  index('liabilities_user_id_idx').on(table.userId),
]);

export type Liability = typeof liabilities.$inferSelect;
export type NewLiability = typeof liabilities.$inferInsert;

// 9b. Credit Card Monthly Expenses
// One row per card per payment month. Period derived from dueDate (payment month).
export const creditCardExpenses = pgTable('credit_card_expenses', {
  id: serial('id').primaryKey(),
  liabilityId: integer('liability_id').notNull().references(() => liabilities.id, { onDelete: 'cascade' }),
  period: text('period').notNull(),           // MMYYYY — derived from dueDate (payment month)
  amount: integer('amount').notNull(),         // in paisa (statement total)
  paidOn: text('paid_on').notNull(),           // ISO date — kept for backward compat
  statementDate: text('statement_date'),       // ISO date — when bill was generated
  dueDate: text('due_date'),                   // ISO date — when payment is due
  paidAmount: integer('paid_amount'),          // paisa — NULL means statement still outstanding
  settledOn: text('settled_on'),               // ISO date — when statement was actually paid
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('cc_expense_liability_idx').on(table.liabilityId),
  index('cc_expense_period_idx').on(table.period),
  uniqueIndex('cc_expense_liability_period_idx').on(table.liabilityId, table.period),
  index('credit_card_expenses_user_id_idx').on(table.userId),
]);

export type CreditCardExpense = typeof creditCardExpenses.$inferSelect;
export type NewCreditCardExpense = typeof creditCardExpenses.$inferInsert;

// 9c. Loan Amortization Schedule (uploaded from bank PDF/CSV)
export type AmortizationStatus = 'UPCOMING' | 'PAID' | 'OVERDUE';

export const loanAmortization = pgTable('loan_amortization', {
  id: serial('id').primaryKey(),
  liabilityId: integer('liability_id').notNull().references(() => liabilities.id, { onDelete: 'cascade' }),
  monthNumber: integer('month_number').notNull(),
  dueDate: text('due_date'),                         // ISO date
  openingBalance: integer('opening_balance').notNull(), // paisa
  emi: integer('emi').notNull(),                       // paisa
  principal: integer('principal').notNull(),            // paisa
  interest: integer('interest').notNull(),              // paisa
  closingBalance: integer('closing_balance').notNull(), // paisa
  status: text('status').$type<AmortizationStatus>().default('UPCOMING'),
  paidOn: text('paid_on'),                             // ISO date
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('amort_liability_idx').on(table.liabilityId),
  index('amort_month_idx').on(table.monthNumber),
  index('loan_amortization_user_id_idx').on(table.userId),
]);

export type LoanAmortizationRow = typeof loanAmortization.$inferSelect;
export type NewLoanAmortizationRow = typeof loanAmortization.$inferInsert;

// 10. Investment Transactions
export type TransactionType = 'BUY' | 'SELL' | 'DIVIDEND' | 'SIP_EXECUTION' | 'INTEREST' | 'BONUS' | 'STOCK_SPLIT';

export const investmentTransactions = pgTable('investment_transactions', {
  id: serial('id').primaryKey(),
  type: text('type').$type<TransactionType>().notNull(),
  assetType: text('asset_type').notNull(),
  assetId: integer('asset_id'),
  assetName: text('asset_name').notNull(),
  quantity: real('quantity').notNull(),
  pricePerUnit: integer('price_per_unit').notNull(),
  amount: integer('amount').notNull(),
  brokerageCharges: integer('brokerage_charges').default(0),
  taxesAndCharges: integer('taxes_and_charges').default(0),
  totalCost: integer('total_cost').notNull(),
  transactionDate: text('transaction_date').notNull(),
  settlementDate: text('settlement_date'),
  referenceNumber: text('reference_number'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('tx_asset_type_idx').on(table.assetType),
  index('tx_date_idx').on(table.transactionDate),
  index('tx_type_idx').on(table.type),
  index('investment_transactions_user_id_idx').on(table.userId),
]);

export type InvestmentTransaction = typeof investmentTransactions.$inferSelect;
export type NewInvestmentTransaction = typeof investmentTransactions.$inferInsert;

// 11. Tax Deductions (Section 80)
export type DeductionSection = 'SECTION_80C' | 'SECTION_80CCC' | 'SECTION_80CCD' | 'SECTION_80D' | 'SECTION_80E' | 'SECTION_80EE' | 'SECTION_80TTA' | 'OTHER';

export const taxDeductions = pgTable('tax_deductions', {
  id: serial('id').primaryKey(),
  section: text('section').notNull(), // '80C'|'80CCD_1B'|'80D'|'80G'|'24B'|...
  description: text('description').notNull(),
  // Legacy columns (Phase <6)
  deductibleAmount: integer('deductible_amount').notNull().default(0),
  availableLimit: integer('available_limit').notNull().default(0),
  utilizableAmount: integer('utilizable_amount').notNull().default(0),
  documentType: text('document_type'),
  documentPath: text('document_path'),
  category: text('category'),
  incurredDate: text('incurred_date').notNull().default(''),
  financialYear: text('financial_year').notNull(),
  claimed: boolean('claimed').default(false),
  claimedAmount: integer('claimed_amount'),
  claimedInYear: text('claimed_in_year'),
  notes: text('notes'),
  // Phase 6 columns
  subType: text('sub_type'),
  amountPaisa: integer('amount_paisa').default(0),
  paymentDate: text('payment_date'),
  paymentMethod: text('payment_method'), // CASH|CHEQUE|NEFT|UPI|CARD
  recipientName: text('recipient_name'),
  recipientPan: text('recipient_pan'),
  recipient80gNumber: text('recipient_80g_number'),
  qualifyingPercent: real('qualifying_percent'),
  hasUpperLimit: boolean('has_upper_limit').default(false),
  linkedAssetType: text('linked_asset_type'),
  linkedAssetId: integer('linked_asset_id'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('deduction_section_idx').on(table.section),
  index('deduction_fy_idx').on(table.financialYear),
  index('tax_deductions_user_id_idx').on(table.userId),
]);

export type TaxDeduction = typeof taxDeductions.$inferSelect;
export type NewTaxDeduction = typeof taxDeductions.$inferInsert;

// 12. Tax Documents
export type DocumentType = 'AADHAR' | 'PAN' | 'GST_CERT' | 'INVESTMENT_CERT' | 'TAX_RETURN' | 'INSURANCE_POLICY' | 'PROPERTY_DEED' | 'LOAN_AGREEMENT' | 'OTHER';

export const taxDocuments = pgTable('tax_documents', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().default(''),
  type: text('type').notNull().default('OTHER'),
  fileSize: integer('file_size'),
  fileName: text('file_name'),
  filePath: text('file_path').notNull(),
  mimeType: text('mime_type'),
  issuerName: text('issuer_name'),
  referenceNumber: text('reference_number'),
  issueDate: text('issue_date'),
  expiryDate: text('expiry_date'),
  financialYear: text('financial_year'),
  tags: text('tags'),
  isEncrypted: boolean('is_encrypted').default(false),
  notes: text('notes'),
  // Phase 6 columns
  deductionId: integer('deduction_id'),
  category: text('category'), // DONATION_RECEIPT|80G_CERTIFICATE|...
  title: text('title'),
  hashSha256: text('hash_sha256'),
  uploadedAt: timestamp('uploaded_at', { mode: 'date' }).defaultNow(),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('doc_type_idx').on(table.type),
  index('doc_fy_idx').on(table.financialYear),
  index('doc_category_idx').on(table.category),
  index('doc_deduction_idx').on(table.deductionId),
  index('tax_documents_user_id_idx').on(table.userId),
]);

export type TaxDocument = typeof taxDocuments.$inferSelect;
export type NewTaxDocument = typeof taxDocuments.$inferInsert;

// 13. Yearly Investment Plan
export type PlanStatus = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'ABANDONED';

export const yearlyInvestmentPlan = pgTable('yearly_investment_plan', {
  id: serial('id').primaryKey(),
  financialYear: text('financial_year').notNull(),
  equityTarget: integer('equity_target').notNull(),
  equityAllocation: integer('equity_allocation').default(0),
  equityActual: integer('equity_actual').default(0),
  mfTarget: integer('mf_target').notNull(),
  mfAllocation: integer('mf_allocation').default(0),
  mfActual: integer('mf_actual').default(0),
  goldTarget: integer('gold_target').default(0),
  goldAllocation: integer('gold_allocation').default(0),
  goldActual: integer('gold_actual').default(0),
  npsTarget: integer('nps_target').default(0),
  npsAllocation: integer('nps_allocation').default(0),
  npsActual: integer('nps_actual').default(0),
  pfTarget: integer('pf_target').default(0),
  pfAllocation: integer('pf_allocation').default(0),
  pfActual: integer('pf_actual').default(0),
  reTarget: integer('re_target').default(0),
  reAllocation: integer('re_allocation').default(0),
  reActual: integer('re_actual').default(0),
  emergencyTarget: integer('emergency_target').notNull(),
  emergencyActual: integer('emergency_actual').default(0),
  deductionTarget: integer('deduction_target').notNull(),
  deductionActual: integer('deduction_actual').default(0),
  totalPlannedInvestment: integer('total_planned_investment').notNull(),
  totalActualInvestment: integer('total_actual_investment').default(0),
  status: text('status').$type<PlanStatus>().default('PLANNED'),
  progressPercent: real('progress_percent').default(0),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  uniqueIndex('plan_fy_idx').on(table.financialYear),
  index('yearly_investment_plan_user_id_idx').on(table.userId),
]);

export type YearlyInvestmentPlan = typeof yearlyInvestmentPlan.$inferSelect;
export type NewYearlyInvestmentPlan = typeof yearlyInvestmentPlan.$inferInsert;

// 14. Price Snapshots
export const priceSnapshots = pgTable('price_snapshots', {
  id: serial('id').primaryKey(),
  assetType: text('asset_type').notNull(),
  assetSymbol: text('asset_symbol').notNull(),
  assetName: text('asset_name'),
  price: integer('price').notNull(),
  priceDate: text('price_date').notNull(),
  priceTime: text('price_time'),
  dayHigh: integer('day_high'),
  dayLow: integer('day_low'),
  volume: integer('volume'),
  previousClose: integer('previous_close'),
  change: integer('change'),
  changePercent: real('change_percent'),
  source: text('source').notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('snapshot_asset_idx').on(table.assetSymbol),
  index('snapshot_date_idx').on(table.priceDate),
  index('snapshot_source_idx').on(table.source),
  uniqueIndex('snapshot_unique_idx').on(table.assetSymbol, table.priceDate),
  index('price_snapshots_user_id_idx').on(table.userId),
]);

export type PriceSnapshot = typeof priceSnapshots.$inferSelect;
export type NewPriceSnapshot = typeof priceSnapshots.$inferInsert;

// ============================================================================
// ALERT SYSTEM
// ============================================================================

export type AlertCategory = 'MARKET' | 'PAYMENT' | 'PORTFOLIO';
export type AlertOperator = 'GT' | 'LT' | 'GTE' | 'LTE' | 'CROSSES_ABOVE' | 'CROSSES_BELOW' | 'CHANGE_PCT_GT' | 'CHANGE_PCT_LT';

export const alertRules = pgTable('alert_rules', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  category: text('category').$type<AlertCategory>().notNull(),
  ruleType: text('rule_type').notNull(),
  symbol: text('symbol'),
  assetId: integer('asset_id'),
  operator: text('operator').$type<AlertOperator>(),
  threshold: real('threshold').notNull(),
  isEnabled: boolean('is_enabled').default(true),
  cooldownHours: integer('cooldown_hours').default(24),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('alert_rule_category_idx').on(table.category),
  index('alert_rule_enabled_idx').on(table.isEnabled),
  index('alert_rules_user_id_idx').on(table.userId),
]);

export const alertHistory = pgTable('alert_history', {
  id: serial('id').primaryKey(),
  ruleId: integer('rule_id').notNull().references(() => alertRules.id, { onDelete: 'cascade' }),
  dedupKey: text('dedup_key').notNull(),
  message: text('message').notNull(),
  triggeredValue: real('triggered_value'),
  sentAt: timestamp('sent_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('alert_history_rule_idx').on(table.ruleId),
  index('alert_history_sent_idx').on(table.sentAt),
  uniqueIndex('alert_history_dedup_idx').on(table.dedupKey),
  index('alert_history_user_id_idx').on(table.userId),
]);

export type AlertRule = typeof alertRules.$inferSelect;
export type NewAlertRule = typeof alertRules.$inferInsert;
export type AlertHistoryRow = typeof alertHistory.$inferSelect;

// ============================================================================
// REALIZED CAPITAL GAINS
// ============================================================================

export type HoldingPeriod = 'LTCG' | 'STCG';
export type CapGainAssetType = 'STOCKS' | 'EQUITY_MF' | 'DEBT_MF' | 'GOLD' | 'REAL_ESTATE' | 'OTHER';

export const capitalGains = pgTable('capital_gains', {
  id: serial('id').primaryKey(),
  financialYear: text('financial_year').notNull(),
  assetType: text('asset_type').$type<CapGainAssetType>().notNull(),
  assetName: text('asset_name').notNull(),
  purchaseDate: text('purchase_date'),
  saleDate: text('sale_date').notNull(),
  purchasePrice: integer('purchase_price').notNull(),   // paisa
  salePrice: integer('sale_price').notNull(),             // paisa
  capitalGain: integer('capital_gain').notNull(),         // paisa (can be negative)
  holdingPeriod: text('holding_period').$type<HoldingPeriod>().notNull(),
  exemptionApplied: integer('exemption_applied').default(0), // paisa
  taxableGain: integer('taxable_gain').notNull(),         // paisa
  taxRate: real('tax_rate').notNull(),                     // percentage
  taxAmount: integer('tax_amount').notNull(),             // paisa
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('cg_fy_idx').on(table.financialYear),
  index('capital_gains_user_id_idx').on(table.userId),
]);

export type CapitalGainRow = typeof capitalGains.$inferSelect;

// ============================================================================
// INCOME TAX PAID (Advance Tax / TDS / Self-Assessment)
// ============================================================================

export type TaxPaymentType = 'ADVANCE_TAX' | 'TDS' | 'SELF_ASSESSMENT' | 'OTHER';

export const incomeTaxPaid = pgTable('income_tax_paid', {
  id: serial('id').primaryKey(),
  financialYear: text('financial_year').notNull(),
  paymentType: text('payment_type').$type<TaxPaymentType>().notNull(),
  amount: integer('amount').notNull(),   // paisa
  paymentDate: text('payment_date').notNull(),
  referenceNumber: text('reference_number'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('itp_fy_idx').on(table.financialYear),
  index('income_tax_paid_user_id_idx').on(table.userId),
]);

export type IncomeTaxPaidRow = typeof incomeTaxPaid.$inferSelect;

// ============================================================================
// ITR-3 SUPPORT — Salary, TDS credits, Other Sources Income
// ============================================================================

// Salary income per Form 16 (Schedule S + CSV_TDS1 export)
export const salaryIncome = pgTable('salary_income', {
  id: serial('id').primaryKey(),
  financialYear: text('financial_year').notNull(),
  employerName: text('employer_name').notNull(),
  employerTan: text('employer_tan').notNull(),
  grossSalaryPaisa: integer('gross_salary_paisa').notNull(),
  exemptionsPaisa: integer('exemptions_paisa').default(0),
  section16Paisa: integer('section16_paisa').default(0),
  taxableSalaryPaisa: integer('taxable_salary_paisa').notNull(),
  tdsPaisa: integer('tds_paisa').default(0),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('salary_income_fy_idx').on(table.financialYear),
  index('salary_income_user_id_idx').on(table.userId),
]);

export type SalaryIncomeRow = typeof salaryIncome.$inferSelect;

// TDS credits — non-salary (consulting/interest/property) — feeds CSV_TDS2 / CSV_TDS3
export type TdsCategory = 'CONSULTING' | 'INTEREST' | 'RENT' | 'PROPERTY' | 'OTHER';

export const tdsCredits = pgTable('tds_credits', {
  id: serial('id').primaryKey(),
  financialYear: text('financial_year').notNull(),
  category: text('category').$type<TdsCategory>().notNull(),
  deductorName: text('deductor_name').notNull(),
  deductorTan: text('deductor_tan'),     // present → TDS2 export
  deductorPan: text('deductor_pan'),     // present → TDS3 export
  section: text('section').notNull(),     // e.g. 194J, 194A, 194-IA
  incomePaisa: integer('income_paisa').notNull(),
  tdsPaisa: integer('tds_paisa').notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('tds_credits_fy_idx').on(table.financialYear),
  index('tds_credits_category_idx').on(table.category),
  index('tds_credits_user_id_idx').on(table.userId),
]);

export type TdsCreditsRow = typeof tdsCredits.$inferSelect;

// Other sources income (Schedule OS) — interest, dividends, etc.
export type OtherIncomeSource =
  | 'BANK_INTEREST'
  | 'FD_INTEREST'
  | 'PF_INTEREST'
  | 'DIVIDEND'
  | 'OTHER';

export const otherSourcesIncome = pgTable('other_sources_income', {
  id: serial('id').primaryKey(),
  financialYear: text('financial_year').notNull(),
  source: text('source').$type<OtherIncomeSource>().notNull(),
  description: text('description').notNull(),
  amountPaisa: integer('amount_paisa').notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('other_income_fy_idx').on(table.financialYear),
  index('other_sources_income_user_id_idx').on(table.userId),
]);

export type OtherSourcesIncomeRow = typeof otherSourcesIncome.$inferSelect;

// ============================================================================
// TAX SECTION PREFERENCES (include/exclude per FY)
// ============================================================================

export const taxSectionPreferences = pgTable('tax_section_preferences', {
  id: serial('id').primaryKey(),
  financialYear: text('financial_year').notNull(),
  section: text('section').notNull(),
  isExcluded: boolean('is_excluded').default(false),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  uniqueIndex('tax_pref_fy_section_idx').on(table.financialYear, table.section),
  index('tax_section_preferences_user_id_idx').on(table.userId),
]);

// ============================================================================
// FY CLOSE STATUS
// ============================================================================

export const fyCloseStatus = pgTable('fy_close_status', {
  id: serial('id').primaryKey(),
  financialYear: text('financial_year').notNull(),
  category: text('category').notNull(),
  isLocked: boolean('is_locked').default(false),
  lockedAt: timestamp('locked_at', { mode: 'date' }),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  uniqueIndex('fy_close_fy_cat_idx').on(table.financialYear, table.category),
  index('fy_close_status_user_id_idx').on(table.userId),
]);

export type FyCloseStatusRow = typeof fyCloseStatus.$inferSelect;

// ============================================================================
// TYPE EXPORTS
// ============================================================================

// Type exports for TypeScript
export type BusinessProfile = typeof businessProfile.$inferSelect;
export type NewBusinessProfile = typeof businessProfile.$inferInsert;

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;

export type Vendor = typeof vendors.$inferSelect;
export type NewVendor = typeof vendors.$inferInsert;

export type SacCode = typeof sacCodes.$inferSelect;
export type NewSacCode = typeof sacCodes.$inferInsert;

export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;

export type InvoiceItem = typeof invoiceItems.$inferSelect;
export type NewInvoiceItem = typeof invoiceItems.$inferInsert;

export type PurchaseInvoice = typeof purchaseInvoices.$inferSelect;
export type NewPurchaseInvoice = typeof purchaseInvoices.$inferInsert;

export type TaxPayment = typeof taxPayments.$inferSelect;
export type NewTaxPayment = typeof taxPayments.$inferInsert;

// Finance types
export type BudgetCategory = typeof budgetCategories.$inferSelect;
export type NewBudgetCategory = typeof budgetCategories.$inferInsert;

export type BudgetEntry = typeof budgetEntries.$inferSelect;
export type NewBudgetEntry = typeof budgetEntries.$inferInsert;

export type FinancialGoal = typeof financialGoals.$inferSelect;
export type NewFinancialGoal = typeof financialGoals.$inferInsert;

export type ProjectionCategory = typeof projectionCategories.$inferSelect;
export type NewProjectionCategory = typeof projectionCategories.$inferInsert;

export type ProjectionEntry = typeof projectionEntries.$inferSelect;
export type NewProjectionEntry = typeof projectionEntries.$inferInsert;

export type CarryforwardBalance = typeof carryforwardBalances.$inferSelect;
export type NewCarryforwardBalance = typeof carryforwardBalances.$inferInsert;
