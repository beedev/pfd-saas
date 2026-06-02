import { pgTable, text, integer, bigint, real, index, uniqueIndex, timestamp, boolean, serial, primaryKey, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { AdapterAccountType } from 'next-auth/adapters';

/* ─── Auth.js tables ─────────────────────────────────────────────────────
 * Standard Drizzle adapter schema for next-auth v5. Tables intentionally
 * use singular lowercase names (`user`, `account`, etc.) to match the
 * adapter's expectations exactly — don't rename them.
 *
 * `user.id` is a text UUID generated client-side. Every domain table in
 * this schema carries `userId: text('user_id').notNull().references(() => users.id)`
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

/**
 * Per-user, GST-agnostic preferences captured during onboarding.
 *
 * 1:1 with `user` — userId IS the primary key, so each user has exactly
 * one row or none. Row existence is the canonical "has the user finished
 * onboarding?" signal; the dashboard layout redirects to /onboarding
 * when this row is missing.
 *
 * GST-specific data (gstin, businessName, stateCode, etc.) lives in
 * `business_profile` — created only when the user toggles "yes, I file
 * GST" during onboarding. The two tables together cover all per-user
 * settings.
 */
export const userPreferences = pgTable('user_preferences', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  displayName: text('display_name').notNull(),
  // INR-locked for v1; column is here so future markets can override.
  baseCurrency: text('base_currency').notNull().default('INR'),
  // Calendar month the financial year starts in. 4 = April (Indian default).
  financialYearStartMonth: integer('financial_year_start_month').notNull().default(4),
  // When the wizard was completed. NULL for backfilled rows (migration
  // created them so existing users don't get redirected; they never saw
  // the wizard themselves).
  onboardedAt: timestamp('onboarded_at', { mode: 'date' }),
  // Sprint 3.5 follow-up — optional personal-development module
  // (daily habit/health tracker ported from personal-v1). Off by
  // default since pfd-saas is finance-first; owner toggles it on
  // per-user. When false the /health/* sidebar entries are hidden
  // and the routes still respond 200 (no-op) so existing bookmarks
  // never 500.
  habitsEnabled: boolean('habits_enabled').notNull().default(false),
  // Sprint 3.5 follow-up — per-user Telegram routing. TELEGRAM_BOT_TOKEN
  // remains an env var (one bot serves all users); the chat_id where
  // messages land is per-user. NULL = user hasn't paired yet, so cron
  // jobs skip them.
  telegramChatId: text('telegram_chat_id'),
  /** Display only — `@username` if the user has one set. */
  telegramUsername: text('telegram_username'),
  /** One-shot pairing token. The UI calls /api/integrations/telegram/start
   *  which generates this, hands the user a deep link
   *  https://t.me/<bot>?start=<token>. When the user presses /start in
   *  Telegram, the bot webhook receives the token, looks up the user,
   *  writes telegram_chat_id, and clears this. Tokens expire after
   *  telegram_connect_token_expires_at. */
  telegramConnectToken: text('telegram_connect_token'),
  telegramConnectTokenExpiresAt: timestamp('telegram_connect_token_expires_at', { mode: 'date' }),
  // Sprint 4 Phase 1 — preferred tax regime. NEW is the default starting
  // FY 2024-25 (govt switched the default in ITR forms). OLD requires
  // opt-in. EVALUATE = show both regimes side-by-side and don't pick yet.
  taxRegimeDefault: text('tax_regime_default').notNull().default('NEW'),
  // ─── Sprint 5.1a — Tax setup parameters ─────────────────────────────
  // The Yeswanth TaxCalc "SETUP PARAMETERS" block. These feed into the
  // OLD regime exemption math — HRA rate (50% metro / 40% non-metro),
  // 80D sr-citizen ceilings, 80U / 80DD severity, etc. All default to
  // sensible-conservative values so old rows behave as before.
  metroCity: boolean('metro_city').notNull().default(true),
  isSrCitizen: boolean('is_sr_citizen').notNull().default(false),
  spouseIsSrCitizen: boolean('spouse_is_sr_citizen').notNull().default(false),
  parentsAreSrCitizens: boolean('parents_are_sr_citizens').notNull().default(false),
  hasPermanentDisability: boolean('has_permanent_disability').notNull().default(false),
  /** REGULAR (40–80%) or SEVERE (>80%). Only meaningful when
   *  has_permanent_disability=true; raises the 80U ceiling from
   *  ₹75k to ₹1.25L for the severe band. */
  disabilitySeverity: text('disability_severity'),
  /** Family pensioner — gets the sec 57(iia) deduction (lesser of
   *  ₹15k OLD / ₹25k NEW or 1/3 of family pension) on pension income.
   *  Drives the pension-row handling in regime-compare. */
  isFamilyPensioner: boolean('is_family_pensioner').notNull().default(false),
  /** Govt employee — raises 80CCD(1) employer-contribution cap from
   *  10% to 14% of salary (and the matching 80CCD(2) NEW-regime
   *  ceiling). This is a setup-time toggle since the user's employer
   *  category rarely changes mid-FY. */
  isGovtEmployeeForNps: boolean('is_govt_employee_for_nps').notNull().default(false),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
});

export type UserPreferences = typeof userPreferences.$inferSelect;
export type NewUserPreferences = typeof userPreferences.$inferInsert;

/**
 * Transformation tracker — daily habits / health / journal / weight.
 *
 * Ported from personal-v1 (Sprint 3.5 follow-up). The model is a tree:
 *   plan ─┬─ sections ─── items   (the checklist template)
 *         └─ days ─── checks       (daily ticks against items)
 *
 * Five tables to mirror the v1 SQLite shape exactly, adapted for
 * postgres + multi-tenancy:
 *   - All five carry user_id NOT NULL FK CASCADE (same invariant as
 *     every other domain table — Sprint 1 Phase 4).
 *   - Per-user uniqueness on (plan, date) and (day, item).
 *   - Timestamps are postgres `timestamp` (v1 stored unix-epoch
 *     integers; the import script will translate).
 *   - `kind` on items is 'check' | 'meal' | 'weight' | 'journal' |
 *     'text' (v1 expanded over time; we accept the same set).
 *
 * Gated behind user_preferences.habits_enabled — when off, the
 * /health sidebar entries are hidden and these tables are simply
 * unused.
 */
export const transformationPlans = pgTable('transformation_plans', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  startDate: text('start_date').notNull(),       // ISO YYYY-MM-DD
  dayCount: integer('day_count').notNull().default(100),
  startWeightKg: real('start_weight_kg'),
  goalWeightKg: real('goal_weight_kg'),
  dailyCalorieTarget: integer('daily_calorie_target'),
  dailyProteinTargetG: integer('daily_protein_target_g'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('transformation_plans_user_id_idx').on(table.userId),
]);

export const transformationSections = pgTable('transformation_sections', {
  id: serial('id').primaryKey(),
  planId: integer('plan_id').notNull().references(() => transformationPlans.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  /** Soft delete — items hidden from UI but checks history stays
   *  intact so old days don't lose their context. */
  deletedAt: timestamp('deleted_at', { mode: 'date' }),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('transformation_sections_user_id_idx').on(table.userId),
  index('transformation_sections_plan_idx').on(table.planId),
]);

export const transformationItems = pgTable('transformation_items', {
  id: serial('id').primaryKey(),
  sectionId: integer('section_id').notNull().references(() => transformationSections.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  /** 'check'   — boolean tick (default)
   *  'meal'    — text + auto calorie/protein estimate
   *  'weight'  — numeric kg entry
   *  'journal' — free-form text
   *  'text'    — short text answer */
  kind: text('kind').notNull().default('check'),
  /** JSON-encoded enum options for select-style items. NULL for free input. */
  options: text('options'),
  sortOrder: integer('sort_order').notNull().default(0),
  deletedAt: timestamp('deleted_at', { mode: 'date' }),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('transformation_items_user_id_idx').on(table.userId),
  index('transformation_items_section_idx').on(table.sectionId),
]);

export const transformationDays = pgTable('transformation_days', {
  id: serial('id').primaryKey(),
  planId: integer('plan_id').notNull().references(() => transformationPlans.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),         // ISO YYYY-MM-DD
  dayNumber: integer('day_number'),
  currentWeightKg: real('current_weight_kg'),
  journal: text('journal'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('transformation_days_user_id_idx').on(table.userId),
  uniqueIndex('transformation_days_plan_date_unique').on(table.userId, table.planId, table.date),
]);

export const transformationChecks = pgTable('transformation_checks', {
  id: serial('id').primaryKey(),
  dayId: integer('day_id').notNull().references(() => transformationDays.id, { onDelete: 'cascade' }),
  itemId: integer('item_id').notNull().references(() => transformationItems.id, { onDelete: 'cascade' }),
  checked: boolean('checked').notNull().default(false),
  /** Free-text value for kind='meal'/'journal'/'text' items. */
  textValue: text('text_value'),
  /** Populated by /api/health/transformation/estimate-nutrition (LLM
   *  call). Stays null when the LLM endpoint isn't configured. */
  estimatedCalories: integer('estimated_calories'),
  estimatedProteinG: real('estimated_protein_g'),
  estimationInput: text('estimation_input'),
  estimatedAt: timestamp('estimated_at', { mode: 'date' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('transformation_checks_user_id_idx').on(table.userId),
  uniqueIndex('transformation_checks_day_item_unique').on(table.userId, table.dayId, table.itemId),
]);

export type TransformationPlan = typeof transformationPlans.$inferSelect;
export type NewTransformationPlan = typeof transformationPlans.$inferInsert;
export type TransformationSection = typeof transformationSections.$inferSelect;
export type TransformationItem = typeof transformationItems.$inferSelect;
export type TransformationDay = typeof transformationDays.$inferSelect;
export type TransformationCheck = typeof transformationChecks.$inferSelect;

/**
 * Per-user cron job ledger. Drives the `/api/cron/tick` dispatcher
 * (Sprint 2 Phase 5). One row per user × job type:
 *
 *   - daily_digest        — once per day, generates portfolio digest
 *   - alerts_check        — every ~5 min during market hours
 *   - sip_auto_execute    — once per day, runs SIPs due today
 *
 * `next_run_at` is the canonical "is this job due?" signal. The tick
 * endpoint selects rows where next_run_at <= NOW() and enabled = true,
 * runs the job, then bumps next_run_at forward (per-job logic decides
 * the next slot).
 *
 * Schedule is baked in code for MVP (Sprint 7+ adds per-user override).
 */
export type JobType = 'daily_digest' | 'alerts_check' | 'sip_auto_execute';
export type JobStatus = 'pending' | 'success' | 'failed';

export const scheduledJobs = pgTable('scheduled_jobs', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  jobType: text('job_type').$type<JobType>().notNull(),
  enabled: boolean('enabled').notNull().default(true),
  nextRunAt: timestamp('next_run_at', { mode: 'date' }).notNull(),
  lastRunAt: timestamp('last_run_at', { mode: 'date' }),
  lastRunStatus: text('last_run_status').$type<JobStatus>(),
  lastRunError: text('last_run_error'),
  // How many times this row has been run. Useful for diagnosing stuck
  // jobs and for rate-limit-style throttling later.
  runCount: integer('run_count').notNull().default(0),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
}, (table) => [
  index('scheduled_jobs_user_id_idx').on(table.userId),
  index('scheduled_jobs_next_run_idx').on(table.nextRunAt),
  uniqueIndex('scheduled_jobs_user_job_unique').on(table.userId, table.jobType),
]);

export type ScheduledJob = typeof scheduledJobs.$inferSelect;
export type NewScheduledJob = typeof scheduledJobs.$inferInsert;

/* ─── Health insurance (Sprint 3 Phase 1) ────────────────────────────
 *
 * Split from `insurance_policies` (which carries life / term / ULIP /
 * endowment). Health-specific concerns — sum insured ceiling, NCB
 * carry, family floater membership, cashless network, waiting periods,
 * portability — get their own first-class shape.
 *
 * Four tables:
 *   health_insurance_policies      one row per policy contract
 *   health_insurance_cards         one row per insured member (family
 *                                  floater = multiple cards per policy)
 *   health_insurance_claims        per-claim history
 *   health_insurance_portability   port-in / port-out audit
 * ───────────────────────────────────────────────────────────────────── */

export type HealthPolicyType =
  | 'INDIVIDUAL'
  | 'FAMILY_FLOATER'
  | 'TOPUP'
  | 'SUPER_TOPUP'
  | 'CRITICAL_ILLNESS'
  | 'OPD_RIDER';

export type HealthPolicyStatus =
  | 'ACTIVE'
  | 'LAPSED'
  | 'PORTED_OUT'
  | 'CANCELLED'
  | 'CLAIM_SETTLED';

export type PremiumFrequency =
  | 'ANNUAL'
  | 'SEMI_ANNUAL'
  | 'QUARTERLY'
  | 'MONTHLY';

export const healthInsurancePolicies = pgTable('health_insurance_policies', {
  id: serial('id').primaryKey(),
  insurer: text('insurer').notNull(),
  policyNumber: text('policy_number').notNull(),
  policyType: text('policy_type').$type<HealthPolicyType>().notNull(),
  status: text('status').$type<HealthPolicyStatus>().notNull().default('ACTIVE'),
  policyHolder: text('policy_holder').notNull(),
  // Total sum insured for the policy (family floater shares this across members).
  sumInsuredPaisa: bigint('sum_insured_paisa', { mode: 'number' }).notNull(),
  // Cumulative bonus already earned (paisa). NCB percent + sum gives the
  // effective coverage; we store both for display flexibility.
  cumulativeBonusPaisa: bigint('cumulative_bonus_paisa', { mode: 'number' }).default(0),
  ncbPercent: real('ncb_percent').default(0),
  premiumPaisa: bigint('premium_paisa', { mode: 'number' }).notNull(),
  premiumFrequency: text('premium_frequency').$type<PremiumFrequency>().notNull().default('ANNUAL'),
  startDate: text('start_date').notNull(),
  renewalDate: text('renewal_date'),
  lastRenewedDate: text('last_renewed_date'),
  // Waiting period for pre-existing diseases. Most retail health policies
  // have 2-4 years; reduced if ported with served period.
  waitingPeriodMonths: integer('waiting_period_months').default(48),
  servedWaitingMonths: integer('served_waiting_months').default(0),
  // JSON list of declared PEDs (pre-existing diseases) — string array.
  preExistingDiseases: text('pre_existing_diseases'),
  cashlessAvailable: boolean('cashless_available').notNull().default(true),
  networkHospitalCount: integer('network_hospital_count'),
  // Path to the master policy PDF (uploaded by the user). Cards have
  // their own image uploads in health_insurance_cards.
  policyDocumentPath: text('policy_document_path'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('health_insurance_policies_user_id_idx').on(table.userId),
  uniqueIndex('health_policy_number_unique').on(table.userId, table.policyNumber),
]);

export type HealthInsurancePolicy = typeof healthInsurancePolicies.$inferSelect;
export type NewHealthInsurancePolicy = typeof healthInsurancePolicies.$inferInsert;

export type FamilyRelationship =
  | 'SELF'
  | 'SPOUSE'
  | 'SON'
  | 'DAUGHTER'
  | 'FATHER'
  | 'MOTHER'
  | 'FATHER_IN_LAW'
  | 'MOTHER_IN_LAW'
  | 'OTHER';

/**
 * Per-member cards. Indian health insurers issue one e-card / physical
 * card per insured member, each with a unique member ID. A family
 * floater policy can have 5+ cards.
 */
export const healthInsuranceCards = pgTable('health_insurance_cards', {
  id: serial('id').primaryKey(),
  policyId: integer('policy_id').notNull().references(() => healthInsurancePolicies.id, { onDelete: 'cascade' }),
  memberName: text('member_name').notNull(),
  // The unique member identifier printed on the card. Often what the
  // hospital types into the cashless portal.
  memberId: text('member_id'),
  relationship: text('relationship').$type<FamilyRelationship>().notNull(),
  dateOfBirth: text('date_of_birth'),
  gender: text('gender'),
  // Path to the uploaded card image / PDF, relative to the uploads/ root.
  // Served via /api/investments/health-insurance/cards/[id]/download.
  cardImagePath: text('card_image_path'),
  // Optional direct link to the insurer's portal where this member's
  // e-card lives (some insurers gate downloads behind login).
  eCardUrl: text('e_card_url'),
  validUntil: text('valid_until'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('health_insurance_cards_user_id_idx').on(table.userId),
  index('health_insurance_cards_policy_idx').on(table.policyId),
]);

export type HealthInsuranceCard = typeof healthInsuranceCards.$inferSelect;
export type NewHealthInsuranceCard = typeof healthInsuranceCards.$inferInsert;

export type ClaimStatus =
  | 'INTIMATED'
  | 'DOCUMENTS_PENDING'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'PARTIAL'
  | 'REJECTED'
  | 'SETTLED';

export const healthInsuranceClaims = pgTable('health_insurance_claims', {
  id: serial('id').primaryKey(),
  policyId: integer('policy_id').notNull().references(() => healthInsurancePolicies.id, { onDelete: 'cascade' }),
  // Which member's claim — optional FK to a card row for traceability,
  // but stored as plain text so the claim survives a card delete.
  memberName: text('member_name').notNull(),
  cardId: integer('card_id').references(() => healthInsuranceCards.id, { onDelete: 'set null' }),
  claimDate: text('claim_date').notNull(),
  hospital: text('hospital'),
  diagnosis: text('diagnosis'),
  // What the user / hospital asked for.
  claimAmountPaisa: bigint('claim_amount_paisa', { mode: 'number' }).notNull(),
  // What the insurer approved (may be 0 if rejected, partial if
  // sub-limits applied).
  approvedAmountPaisa: bigint('approved_amount_paisa', { mode: 'number' }),
  // Cashless vs reimbursement.
  cashless: boolean('cashless').default(true),
  status: text('status').$type<ClaimStatus>().notNull().default('INTIMATED'),
  settlementDate: text('settlement_date'),
  // Reason for rejection / partial approval, if any.
  rejectionReason: text('rejection_reason'),
  documentPath: text('document_path'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('health_insurance_claims_user_id_idx').on(table.userId),
  index('health_insurance_claims_policy_idx').on(table.policyId),
  index('health_insurance_claims_status_idx').on(table.status),
]);

export type HealthInsuranceClaim = typeof healthInsuranceClaims.$inferSelect;
export type NewHealthInsuranceClaim = typeof healthInsuranceClaims.$inferInsert;

/**
 * Portability — when the user ports a health policy from one insurer
 * to another, the waiting period served at the previous insurer
 * carries over. We track this so the UI can display the effective
 * remaining waiting period.
 */
export const healthInsurancePortability = pgTable('health_insurance_portability', {
  id: serial('id').primaryKey(),
  policyId: integer('policy_id').notNull().references(() => healthInsurancePolicies.id, { onDelete: 'cascade' }),
  previousInsurer: text('previous_insurer').notNull(),
  previousPolicyNumber: text('previous_policy_number'),
  portedDate: text('ported_date').notNull(),
  portedSumInsuredPaisa: bigint('ported_sum_insured_paisa', { mode: 'number' }),
  waitingPeriodUsedMonths: integer('waiting_period_used_months').notNull().default(0),
  ncbCarriedPercent: real('ncb_carried_percent').default(0),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('health_insurance_portability_user_id_idx').on(table.userId),
  index('health_insurance_portability_policy_idx').on(table.policyId),
]);

export type HealthInsurancePortability = typeof healthInsurancePortability.$inferSelect;
export type NewHealthInsurancePortability = typeof healthInsurancePortability.$inferInsert;

/* ─── Vehicles (Sprint 3 Phase 3) ────────────────────────────────────
 *
 * Vehicles are both an asset (depreciating IDV, occasional resale) and
 * a recurring expense (insurance premium, PUC fee, fuel, maintenance).
 * Four tables track the full lifecycle:
 *
 *   vehicles                      the registered vehicle
 *   vehicle_insurance_policies    one row per insurance term per vehicle
 *   vehicle_puc                   PUC certificates (Indian law mandates)
 *   vehicle_service_log           service history
 *
 * Insurance renewal + PUC expiry hook into the existing alerts cron via
 * two new alert rule types (VEHICLE_INSURANCE_DUE, PUC_EXPIRY_DUE).
 * ───────────────────────────────────────────────────────────────────── */

export type VehicleFuelType = 'PETROL' | 'DIESEL' | 'CNG' | 'LPG' | 'ELECTRIC' | 'HYBRID';
export type VehicleStatus = 'ACTIVE' | 'SOLD' | 'SCRAPPED' | 'TRANSFERRED';

export const vehicles = pgTable('vehicles', {
  id: serial('id').primaryKey(),
  registrationNumber: text('registration_number').notNull(),
  make: text('make').notNull(),
  model: text('model').notNull(),
  variant: text('variant'),
  year: integer('year').notNull(),
  fuelType: text('fuel_type').$type<VehicleFuelType>().notNull(),
  transmission: text('transmission'), // 'MANUAL' | 'AUTOMATIC' | 'AMT' | 'CVT'
  color: text('color'),
  bodyType: text('body_type'), // 'HATCHBACK' | 'SEDAN' | 'SUV' | 'BIKE' | 'SCOOTER' | etc.
  purchaseDate: text('purchase_date').notNull(),
  purchasePricePaisa: bigint('purchase_price_paisa', { mode: 'number' }).notNull(),
  currentIdvPaisa: bigint('current_idv_paisa', { mode: 'number' }), // latest known IDV from active policy
  odometerKm: integer('odometer_km').default(0),
  status: text('status').$type<VehicleStatus>().notNull().default('ACTIVE'),
  // When sold/transferred:
  soldDate: text('sold_date'),
  salePricePaisa: bigint('sale_price_paisa', { mode: 'number' }),
  rcDocumentPath: text('rc_document_path'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('vehicles_user_id_idx').on(table.userId),
  uniqueIndex('vehicles_registration_unique').on(table.userId, table.registrationNumber),
]);

export type Vehicle = typeof vehicles.$inferSelect;
export type NewVehicle = typeof vehicles.$inferInsert;

export type VehicleInsuranceType = 'COMPREHENSIVE' | 'THIRD_PARTY_ONLY' | 'OWN_DAMAGE_ONLY';
export type VehicleInsuranceStatus = 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'CLAIMED';

export const vehicleInsurancePolicies = pgTable('vehicle_insurance_policies', {
  id: serial('id').primaryKey(),
  vehicleId: integer('vehicle_id').notNull().references(() => vehicles.id, { onDelete: 'cascade' }),
  insurer: text('insurer').notNull(),
  policyNumber: text('policy_number').notNull(),
  insuranceType: text('insurance_type').$type<VehicleInsuranceType>().notNull(),
  idvPaisa: bigint('idv_paisa', { mode: 'number' }).notNull(),
  premiumPaisa: bigint('premium_paisa', { mode: 'number' }).notNull(),
  // Optional split — many policies report own-damage and third-party separately.
  ownDamagePremiumPaisa: bigint('own_damage_premium_paisa', { mode: 'number' }),
  thirdPartyPremiumPaisa: bigint('third_party_premium_paisa', { mode: 'number' }),
  ncbPercent: real('ncb_percent').default(0),
  // Add-ons as a JSON string array: ["ZERO_DEP", "ENGINE_PROTECT", "RSA",
  // "RTI", "CONSUMABLES", "TYRE_PROTECT", "KEY_REPLACEMENT", "NCB_PROTECT"].
  addons: text('addons'),
  premiumFrequency: text('premium_frequency').$type<PremiumFrequency>().notNull().default('ANNUAL'),
  startDate: text('start_date').notNull(),
  renewalDate: text('renewal_date').notNull(),
  claimsMadeCount: integer('claims_made_count').notNull().default(0),
  status: text('status').$type<VehicleInsuranceStatus>().notNull().default('ACTIVE'),
  policyDocumentPath: text('policy_document_path'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('vehicle_insurance_user_id_idx').on(table.userId),
  index('vehicle_insurance_vehicle_idx').on(table.vehicleId),
  index('vehicle_insurance_renewal_idx').on(table.renewalDate),
]);

export type VehicleInsurancePolicy = typeof vehicleInsurancePolicies.$inferSelect;
export type NewVehicleInsurancePolicy = typeof vehicleInsurancePolicies.$inferInsert;

export const vehiclePuc = pgTable('vehicle_puc', {
  id: serial('id').primaryKey(),
  vehicleId: integer('vehicle_id').notNull().references(() => vehicles.id, { onDelete: 'cascade' }),
  certificateNumber: text('certificate_number').notNull(),
  issuedDate: text('issued_date').notNull(),
  validUntil: text('valid_until').notNull(),
  issuingAuthority: text('issuing_authority'),
  costPaisa: bigint('cost_paisa', { mode: 'number' }).default(0),
  certificatePath: text('certificate_path'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('vehicle_puc_user_id_idx').on(table.userId),
  index('vehicle_puc_vehicle_idx').on(table.vehicleId),
  index('vehicle_puc_valid_until_idx').on(table.validUntil),
]);

export type VehiclePuc = typeof vehiclePuc.$inferSelect;
export type NewVehiclePuc = typeof vehiclePuc.$inferInsert;

export type ServiceType = 'REGULAR' | 'REPAIR' | 'ACCIDENT' | 'BREAKDOWN' | 'TYRE_CHANGE' | 'BATTERY' | 'OTHER';

export const vehicleServiceLog = pgTable('vehicle_service_log', {
  id: serial('id').primaryKey(),
  vehicleId: integer('vehicle_id').notNull().references(() => vehicles.id, { onDelete: 'cascade' }),
  serviceDate: text('service_date').notNull(),
  odometerKm: integer('odometer_km'),
  serviceType: text('service_type').$type<ServiceType>().notNull(),
  garageName: text('garage_name'),
  costPaisa: bigint('cost_paisa', { mode: 'number' }).notNull().default(0),
  description: text('description'),
  // Optional projection of next service.
  nextServiceDueDate: text('next_service_due_date'),
  nextServiceDueKm: integer('next_service_due_km'),
  invoicePath: text('invoice_path'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('vehicle_service_user_id_idx').on(table.userId),
  index('vehicle_service_vehicle_idx').on(table.vehicleId),
  index('vehicle_service_date_idx').on(table.serviceDate),
]);

export type VehicleServiceLog = typeof vehicleServiceLog.$inferSelect;
export type NewVehicleServiceLog = typeof vehicleServiceLog.$inferInsert;

/* ─── Subscriptions (Sprint 3 Phase 4) ───────────────────────────────
 *
 * Recurring digital/service subscriptions — Netflix, Adobe, iCloud,
 * gym, ChatGPT Plus, etc. Distinct from recurring_expenses (rent /
 * utilities / bills) because these are discretionary and easy to forget
 * about. The /subscriptions page makes monthly drag visible.
 * ───────────────────────────────────────────────────────────────────── */

export type SubscriptionCategory =
  | 'STREAMING'      // Netflix, Prime Video, Hotstar, YouTube Premium
  | 'SOFTWARE'       // Adobe CC, Microsoft 365, JetBrains
  | 'CLOUD'          // iCloud, Google One, Dropbox
  | 'FITNESS'        // Cult.fit, gym, Peloton
  | 'NEWS'           // newspapers, magazines, NYT, Bloomberg
  | 'GAMING'         // Xbox Game Pass, PSN+, Steam
  | 'AI'             // ChatGPT Plus, Claude Pro, GitHub Copilot
  | 'EDUCATION'      // Coursera, Udemy, Khan Academy
  | 'PRODUCTIVITY'   // Notion, Linear, Figma, 1Password
  | 'OTHER';

export type SubscriptionStatus = 'ACTIVE' | 'PAUSED' | 'CANCELLED';

export type SubscriptionBillingFrequency =
  | 'MONTHLY'
  | 'QUARTERLY'
  | 'SEMI_ANNUAL'
  | 'ANNUAL'
  | 'LIFETIME'; // one-time payment, no renewal

export const subscriptions = pgTable('subscriptions', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  provider: text('provider').notNull(),
  category: text('category').$type<SubscriptionCategory>().notNull(),
  planName: text('plan_name'),
  amountPaisa: bigint('amount_paisa', { mode: 'number' }).notNull(),
  billingFrequency: text('billing_frequency').$type<SubscriptionBillingFrequency>().notNull(),
  startDate: text('start_date').notNull(),
  // Nullable for LIFETIME plans (no renewal).
  nextRenewalDate: text('next_renewal_date'),
  paymentMethod: text('payment_method'),
  autoRenew: boolean('auto_renew').notNull().default(true),
  url: text('url'), // provider dashboard / portal
  status: text('status').$type<SubscriptionStatus>().notNull().default('ACTIVE'),
  // Captured when status transitions to CANCELLED. Drives the
  // "savings since cancelling" tally on the /subscriptions page.
  cancellationDate: text('cancellation_date'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('subscriptions_user_id_idx').on(table.userId),
  index('subscriptions_next_renewal_idx').on(table.nextRenewalDate),
  index('subscriptions_status_idx').on(table.status),
]);

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;

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
  invoiceStartNumber: bigint('invoice_start_number', { mode: 'number' }).default(1),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
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
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
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
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  uniqueIndex('vendors_gstin_idx').on(table.userId, table.gstin),
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
  taxableAmount: bigint('taxable_amount', { mode: 'number' }).notNull(),
  cgstAmount: bigint('cgst_amount', { mode: 'number' }).default(0),
  sgstAmount: bigint('sgst_amount', { mode: 'number' }).default(0),
  igstAmount: bigint('igst_amount', { mode: 'number' }).default(0),
  cessAmount: bigint('cess_amount', { mode: 'number' }).default(0),
  totalAmount: bigint('total_amount', { mode: 'number' }).notNull(),

  returnPeriod: text('return_period').notNull(),
  status: text('status').$type<InvoiceStatus>().default('DRAFT'),
  notes: text('notes'),

  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  uniqueIndex('invoice_number_idx').on(table.userId, table.invoiceNumber),
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
  unitPrice: bigint('unit_price', { mode: 'number' }).notNull(),
  discount: bigint('discount', { mode: 'number' }).default(0),

  taxableAmount: bigint('taxable_amount', { mode: 'number' }).notNull(),
  taxRate: real('tax_rate').notNull(),

  cgstRate: real('cgst_rate').default(0),
  cgstAmount: bigint('cgst_amount', { mode: 'number' }).default(0),
  sgstRate: real('sgst_rate').default(0),
  sgstAmount: bigint('sgst_amount', { mode: 'number' }).default(0),
  igstRate: real('igst_rate').default(0),
  igstAmount: bigint('igst_amount', { mode: 'number' }).default(0),

  totalAmount: bigint('total_amount', { mode: 'number' }).notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
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

  taxableAmount: bigint('taxable_amount', { mode: 'number' }).notNull(),
  cgstAmount: bigint('cgst_amount', { mode: 'number' }).default(0),
  sgstAmount: bigint('sgst_amount', { mode: 'number' }).default(0),
  igstAmount: bigint('igst_amount', { mode: 'number' }).default(0),
  cessAmount: bigint('cess_amount', { mode: 'number' }).default(0),
  totalAmount: bigint('total_amount', { mode: 'number' }).notNull(),

  itcEligible: boolean('itc_eligible').default(true),
  itcClaimed: boolean('itc_claimed').default(false),

  returnPeriod: text('return_period').notNull(),
  notes: text('notes'),

  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
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

  cgstLiability: bigint('cgst_liability', { mode: 'number' }).default(0),
  sgstLiability: bigint('sgst_liability', { mode: 'number' }).default(0),
  igstLiability: bigint('igst_liability', { mode: 'number' }).default(0),
  cessLiability: bigint('cess_liability', { mode: 'number' }).default(0),

  cgstItcUtilized: bigint('cgst_itc_utilized', { mode: 'number' }).default(0),
  sgstItcUtilized: bigint('sgst_itc_utilized', { mode: 'number' }).default(0),
  igstItcUtilized: bigint('igst_itc_utilized', { mode: 'number' }).default(0),

  cgstCashPaid: bigint('cgst_cash_paid', { mode: 'number' }).default(0),
  sgstCashPaid: bigint('sgst_cash_paid', { mode: 'number' }).default(0),
  igstCashPaid: bigint('igst_cash_paid', { mode: 'number' }).default(0),
  cessCashPaid: bigint('cess_cash_paid', { mode: 'number' }).default(0),

  status: text('status').$type<PaymentStatus>().default('PENDING'),
  paymentDate: text('payment_date'),
  paymentReference: text('payment_reference'),

  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  uniqueIndex('payment_period_idx').on(table.userId, table.returnPeriod),
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
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('budget_categories_user_id_idx').on(table.userId),
]);

// Monthly Budget Entries (planned vs actual per category per month)
export const budgetEntries = pgTable('budget_entries', {
  id: serial('id').primaryKey(),
  categoryId: integer('category_id').notNull().references(() => budgetCategories.id, { onDelete: 'cascade' }),
  period: text('period').notNull(),           // MMYYYY format
  plannedAmount: bigint('planned_amount', { mode: 'number' }).default(0),  // in paisa
  actualAmount: bigint('actual_amount', { mode: 'number' }).default(0),    // in paisa
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('budget_period_idx').on(table.period),
  uniqueIndex('budget_category_period_idx').on(table.userId, table.categoryId, table.period),
  index('budget_entries_user_id_idx').on(table.userId),
]);

// Recurring Expense Templates — auto-populates budget_entries for future periods
export type RecurrenceType = 'ONE_TIME' | 'MONTHLY' | 'QUARTERLY' | 'ANNUALLY';

export const recurringExpenses = pgTable('recurring_expenses', {
  id: serial('id').primaryKey(),
  categoryId: integer('category_id').notNull().references(() => budgetCategories.id, { onDelete: 'cascade' }),
  amount: bigint('amount', { mode: 'number' }).notNull(),                    // paisa
  recurrence: text('recurrence').$type<RecurrenceType>().notNull(),
  startPeriod: text('start_period').notNull(),            // MMYYYY
  endPeriod: text('end_period'),                          // MMYYYY, NULL = forever
  notes: text('notes'),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
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
  period: text('period').notNull(),   // MMYYYY — the month this carry-forward GOES INTO
  amount: bigint('amount', { mode: 'number' }).notNull().default(0), // paisa
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('budget_carry_forward_user_id_idx').on(table.userId),
  uniqueIndex('budget_carry_forward_period_unique').on(table.userId, table.period),
]);

/**
 * Financial Goals — Sprint 3.5 Phase 3 brought the disbursement model.
 *
 * A goal is a *milestone* — something you'll spend money on at a specific
 * future point. Retirement is NOT modelled here (it's a life *stage*,
 * not a milestone — see retirementAssumptions + /retirement page).
 *
 * Disbursement shape:
 *   LUMPSUM           — one shot of target_amount on target_date
 *                       (house down payment, car purchase, vacation)
 *   FIXED_PERIOD_SWP  — equal yearly disbursements of
 *                       disbursement_amount_per_yr_paisa across
 *                       disbursement_years starting on
 *                       disbursement_start_date (kid's college 4yr)
 *   INFLATION_SWP     — same as FIXED_PERIOD_SWP but each year's amount
 *                       grows by growth_pct_per_yr (typically inflation)
 *
 * Asset mapping lives in savings_asset_inclusion keyed by goal_id.
 * Earmarked cashflow inflows live in cashflow_events.goal_id.
 *
 * Projection math (lib/finance/goal-projection.ts) runs year-by-year:
 *   year_corpus = year_corpus × (1 + expected_return_pct/100)
 *                 + Σ earmarked inflows for the year
 *                 − Σ goal disbursements for the year
 */
export type GoalType =
  | 'HOUSE'
  | 'CAR'
  | 'EDUCATION'
  | 'TRAVEL'
  | 'EMERGENCY'
  | 'WEDDING'
  | 'BUSINESS'
  | 'OTHER';

export type DisbursementType =
  | 'LUMPSUM'
  | 'FIXED_PERIOD_SWP'
  | 'INFLATION_SWP';

export const financialGoals = pgTable('financial_goals', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),               // e.g., "Marriage", "Pilot Training"
  targetAmount: bigint('target_amount', { mode: 'number' }).notNull(),  // in paisa
  targetDate: text('target_date'),            // ISO date string
  currentAmount: bigint('current_amount', { mode: 'number' }).default(0),  // in paisa
  color: text('color'),                       // for charts (e.g., "#4CAF50")
  isActive: boolean('is_active').default(true),
  // Sprint 3.5 Phase 3 — disbursement model. Defaults pick LUMPSUM so
  // existing rows behave as "one shot at target_date" without surgery.
  goalType: text('goal_type').$type<GoalType>().notNull().default('OTHER'),
  disbursementType: text('disbursement_type')
    .$type<DisbursementType>()
    .notNull()
    .default('LUMPSUM'),
  /** For LUMPSUM: ignored (target_amount is the lumpsum). For SWP
   *  flavours: the per-year withdrawal at start_date. Subsequent years
   *  grow by growth_pct_per_yr for INFLATION_SWP. */
  disbursementAmountPerYrPaisa: bigint('disbursement_amount_per_yr_paisa', {
    mode: 'number',
  }),
  /** For SWP flavours: number of years to spread disbursements across.
   *  Null for LUMPSUM. */
  disbursementYears: integer('disbursement_years'),
  /** First disbursement date. For LUMPSUM this equals target_date.
   *  For SWP this is the start of the withdrawal phase. */
  disbursementStartDate: text('disbursement_start_date'),
  /** Yearly growth applied to disbursement amounts (only meaningful
   *  for INFLATION_SWP — flat for LUMPSUM/FIXED_PERIOD). Typically
   *  set to inflation_pct for INFLATION_SWP. */
  growthPctPerYr: real('growth_pct_per_yr').notNull().default(0),
  /** Assumed yearly portfolio return during the accumulation phase.
   *  Drives year_corpus = year_corpus × (1 + expected_return/100). */
  expectedReturnPct: real('expected_return_pct').notNull().default(8),
  /** Reference inflation for the goal — used to grow target_amount
   *  if user opts into inflation-adjusted target tracking, and as the
   *  default growth_pct for INFLATION_SWP. */
  inflationPct: real('inflation_pct').notNull().default(6),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('financial_goals_user_id_idx').on(table.userId),
  index('financial_goals_type_idx').on(table.goalType),
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
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('projection_categories_user_id_idx').on(table.userId),
]);

// Projection Entries (monthly cashflow projections - cells in the grid)
export const projectionEntries = pgTable('projection_entries', {
  id: serial('id').primaryKey(),
  categoryId: integer('category_id').notNull().references(() => projectionCategories.id, { onDelete: 'cascade' }),
  period: text('period').notNull(),           // MMYYYY
  amount: bigint('amount', { mode: 'number' }).notNull(),        // in paisa (always positive, direction from category)
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('projection_period_idx').on(table.period),
  index('projection_category_idx').on(table.categoryId),
  uniqueIndex('projection_category_period_idx').on(table.userId, table.categoryId, table.period),
  index('projection_entries_user_id_idx').on(table.userId),
]);

// Carryforward Balances (opening balances for projections)
export const carryforwardBalances = pgTable('carryforward_balances', {
  id: serial('id').primaryKey(),
  categoryId: integer('category_id').notNull().references(() => projectionCategories.id, { onDelete: 'cascade' }),
  amount: bigint('amount', { mode: 'number' }).notNull(),            // in paisa
  asOfDate: text('as_of_date').notNull(),         // ISO date
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  uniqueIndex('carryforward_category_idx').on(table.userId, table.categoryId),
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
  /** Sprint 3.5 follow-up — percentage of the asset's value allocated
   *  to this goal. Range 0–100. Across all goal-specific rows for the
   *  same (user, asset_class, source_id), the sum SHOULD be ≤ 100;
   *  remainder is "unallocated" and only contributes to global savings
   *  (the goal_id IS NULL toggle used by /projections). Enforced at the
   *  API layer (sum check on PATCH); the DB has a per-row CHECK only.
   *  Goal projection math weighs asset_value × allocation_pct / 100. */
  allocationPct: real('allocation_pct').notNull().default(100),
  goalId: integer('goal_id').references(() => financialGoals.id, { onDelete: 'cascade' }),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('savings_asset_class_idx').on(table.assetClass),
  index('savings_asset_source_idx').on(table.assetClass, table.sourceId),
  index('savings_asset_inclusion_user_id_idx').on(table.userId),
]);

export type SavingsAssetInclusion = typeof savingsAssetInclusion.$inferSelect;

/**
 * Asset-class default growth assumptions.
 *
 * The goal-projection engine compounds the corpus at a value-weighted
 * average of these rates across the mapped mix. Stocks 12, MFs 11,
 * Gold 9, etc. were previously hardcoded in lib/finance/goal-corpus.ts;
 * now they live in the DB so the user can tune them via /settings.
 *
 * Itemized instruments (Small Savings accounts, FDs, Chit Funds with
 * computed XIRR) still override these with their own rate — this table
 * sets the FALLBACK when an instrument doesn't carry its own.
 *
 * One row per (user, asset_class). Seeded with reasonable defaults on
 * first read.
 */
export const assetClassReturns = pgTable('asset_class_returns', {
  id: serial('id').primaryKey(),
  assetClass: text('asset_class').notNull(),
  returnPct: real('return_pct').notNull(),
  /** When true, instrument rates (FD interest_rate, Small Savings
   *  interest_rate_percent, Chit xirr) take precedence over the class
   *  rate. When false, the class rate applies to ALL instruments in the
   *  class — the conservative default. Only meaningful for FDs, Small
   *  Savings, and Chit Funds; ignored for the other classes. */
  useInstrumentRate: boolean('use_instrument_rate').notNull().default(false),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('asset_class_returns_user_id_idx').on(table.userId),
  uniqueIndex('asset_class_returns_unique').on(table.userId, table.assetClass),
]);

export type AssetClassReturn = typeof assetClassReturns.$inferSelect;

/**
 * Cashflow Events — Sprint 3.5 Phase 2.
 *
 * First-class inflow timeline. Both retirement projection and per-goal
 * funding projection consume this same table when running their
 * year-by-year engines. Without this, retirement income from NPS,
 * LIC maturities, rental, salary etc. would have to be re-derived
 * everywhere we need it.
 *
 * Two flavours of row coexist:
 *   • auto_derived = true  — generated from an asset table by the
 *     derivation lib (insurance maturity → INSURANCE_MATURITY event;
 *     NPS at age 60 → NPS_LUMPSUM + NPS_ANNUITY events; rental
 *     income → RENTAL recurring event; etc.). Re-deriving is
 *     idempotent — these rows are replaced on each run keyed by
 *     (user_id, source_kind, source_id, frequency).
 *   • auto_derived = false — user-entered manual events (govt
 *     pension, expected inheritance, side income, deferred NPS
 *     payout). Preserved across re-derivation.
 *
 * Setting auto_derived = false on a row that was originally derived
 * is the "override" pattern: the user tweaked the auto-suggested
 * amount/date, so we treat it as manual and stop overwriting it.
 *
 * source_id references the underlying asset's id (in whatever table
 * source_kind implies). Soft FK only — if the asset is deleted, the
 * derivation re-run drops the orphan row.
 */
export type CashflowSourceKind =
  | 'INSURANCE_MATURITY'
  | 'ANNUITY'
  | 'PENSION'
  | 'NPS_LUMPSUM'
  | 'NPS_ANNUITY'
  | 'PPF_MATURITY'
  | 'SSY_MATURITY'
  | 'NSC_MATURITY'
  | 'KVP_MATURITY'
  | 'RENTAL'
  | 'SALARY'
  | 'BUSINESS'
  | 'INHERITANCE'
  /** Ongoing SIP contribution — monthly investment outflow that
   *  accumulates in the mapped mutual fund. Surfaced on the
   *  /planning/cashflows timeline so the user can see "I'm putting
   *  ₹36k/mo into MFs forever" alongside their income inflows. Goal
   *  projection still counts SIPs via the asset mapping path
   *  (yearlyContributionForGoal); SIP cashflow events are
   *  goal_id=NULL to avoid double-counting. */
  | 'SIP'
  | 'OTHER';

export type CashflowFrequency = 'ONE_TIME' | 'MONTHLY' | 'YEARLY';

export type CashflowTaxTreatment = 'TAX_FREE' | 'TAXABLE' | 'TDS';

export const cashflowEvents = pgTable('cashflow_events', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  sourceKind: text('source_kind').$type<CashflowSourceKind>().notNull(),
  /** FK-by-convention into the source table implied by source_kind. */
  sourceId: integer('source_id'),
  /** ISO date when the event kicks in. */
  startDate: text('start_date').notNull(),
  /** ISO date when the event stops. NULL = lifelong (e.g., NPS annuity,
   *  govt pension). One-time events may set end_date = start_date or
   *  leave it null — frequency=ONE_TIME is the authoritative flag. */
  endDate: text('end_date'),
  amountPaisa: bigint('amount_paisa', { mode: 'number' }).notNull(),
  frequency: text('frequency').$type<CashflowFrequency>().notNull(),
  /** Yearly compounding growth rate as a percentage. 0 = flat, 6 =
   *  inflation-linked. Applied to amount_paisa for each subsequent
   *  year from start_date. */
  growthPctPerYear: real('growth_pct_per_year').notNull().default(0),
  taxTreatment: text('tax_treatment')
    .$type<CashflowTaxTreatment>()
    .notNull()
    .default('TAXABLE'),
  /** Optional earmark — if this event is destined to fund a specific
   *  goal. Goal projection will count it as a dedicated inflow toward
   *  that goal's demand. */
  goalId: integer('goal_id').references(() => financialGoals.id, { onDelete: 'set null' }),
  autoDerived: boolean('auto_derived').notNull().default(false),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('cashflow_events_user_id_idx').on(table.userId),
  index('cashflow_events_kind_idx').on(table.sourceKind),
  index('cashflow_events_date_idx').on(table.startDate),
  index('cashflow_events_goal_idx').on(table.goalId),
  // Idempotency key for re-derivation: per user, per source instrument,
  // per kind. NPS produces two events per account (lumpsum + annuity)
  // distinguished by source_kind — they don't collide.
  uniqueIndex('cashflow_events_derive_unique').on(
    table.userId,
    table.sourceKind,
    table.sourceId,
  ),
]);

export type CashflowEvent = typeof cashflowEvents.$inferSelect;
export type NewCashflowEvent = typeof cashflowEvents.$inferInsert;

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
  lumpSumPaisa: bigint('lump_sum_paisa', { mode: 'number' }).notNull().default(0),
  monthlyPaisa: bigint('monthly_paisa', { mode: 'number' }).notNull().default(0),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
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
  salePriceOverridePaisa: bigint('sale_price_override_paisa', { mode: 'number' }),
  // For REAL_ESTATE in RENTAL mode: expected monthly rent at retirement
  // (already inflation-adjusted to future value). Used directly as ×12
  // annual income — no further inflation applied — so the user can model
  // "I'll rent it out after I retire" without needing current monthly_rent.
  expectedFutureRentPaisa: bigint('expected_future_rent_paisa', { mode: 'number' }),
  npsLumpsumPct: real('nps_lumpsum_pct'),          // default 60
  npsAnnuityRatePct: real('nps_annuity_rate_pct'), // default 6
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('retirement_asset_class_idx').on(table.assetClass),
  uniqueIndex('retirement_asset_unique_idx').on(table.userId, table.assetClass, table.sourceId),
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
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
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
  averagePrice: bigint('average_price', { mode: 'number' }).notNull(),
  currentPrice: bigint('current_price', { mode: 'number' }).notNull(),
  purchaseDate: text('purchase_date').notNull(),
  totalInvestment: bigint('total_investment', { mode: 'number' }).notNull(),
  currentValue: bigint('current_value', { mode: 'number' }).notNull(),
  gainLoss: bigint('gain_loss', { mode: 'number' }).notNull(),
  gainLossPercent: real('gain_loss_percent').notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('holdings_symbol_idx').on(table.symbol),
  uniqueIndex('holdings_symbol_unique').on(table.userId, table.symbol),
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
  nav: bigint('nav', { mode: 'number' }).notNull(),
  totalInvestment: bigint('total_investment', { mode: 'number' }).notNull(),
  currentValue: bigint('current_value', { mode: 'number' }).notNull(),
  gainLoss: bigint('gain_loss', { mode: 'number' }).notNull(),
  gainLossPercent: real('gain_loss_percent').notNull(),
  lastNavDate: text('last_nav_date'),
  investmentStartDate: text('investment_start_date'), // ISO date — for CAGR computation
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
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
  startingNav: bigint('starting_nav', { mode: 'number' }).notNull(),
  monthlyAmount: bigint('monthly_amount', { mode: 'number' }).notNull(),
  frequency: text('frequency').$type<SIPFrequency>().notNull().default('MONTHLY'),
  startDate: text('start_date').notNull(),
  endDate: text('end_date'),
  status: text('status').$type<SIPStatus>().default('ACTIVE'),
  totalInvestedSoFar: bigint('total_invested_so_far', { mode: 'number' }).notNull().default(0),
  lastExecutionDate: text('last_execution_date'),
  nextExecutionDate: text('next_execution_date'),
  expectedXirr: real('expected_xirr'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
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

  chitValue: bigint('chit_value', { mode: 'number' }).notNull(),
  monthlyInstallment: bigint('monthly_installment', { mode: 'number' }).notNull(),
  durationMonths: integer('duration_months').notNull(),
  groupSize: integer('group_size').notNull(),
  ticketNumber: text('ticket_number'),
  startDate: text('start_date').notNull(),
  expectedEndDate: text('expected_end_date').notNull(),
  foremanCommissionPct: real('foreman_commission_pct').default(5),
  documentChargesPaisa: bigint('document_charges_paisa', { mode: 'number' }).default(0),
  promptPaymentDiscountPct: real('prompt_payment_discount_pct').default(0),

  // Running state
  installmentsPaid: integer('installments_paid').default(0),
  totalPaid: bigint('total_paid', { mode: 'number' }).default(0),
  totalDividends: bigint('total_dividends', { mode: 'number' }).default(0),
  netContribution: bigint('net_contribution', { mode: 'number' }).default(0),

  // Winning state
  status: text('status').$type<ChitFundStatus>().default('ACTIVE'),
  winMonth: integer('win_month'),
  winDate: text('win_date'),
  winBidDiscountPct: real('win_bid_discount_pct'),
  winAmountReceived: bigint('win_amount_received', { mode: 'number' }),

  xirr: real('xirr'),
  nextDueDate: text('next_due_date'),

  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
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
  installmentPaid: bigint('installment_paid', { mode: 'number' }).notNull(),
  dividendReceived: bigint('dividend_received', { mode: 'number' }).default(0),
  netOutgo: bigint('net_outgo', { mode: 'number' }).notNull(),
  paidOn: text('paid_on').notNull(),
  paymentMethod: text('payment_method').$type<ChitPaymentMethod>().default('NEFT'),
  winnerName: text('winner_name'),
  winnerBidDiscountPct: real('winner_bid_discount_pct'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
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
  currentPrice: bigint('current_price', { mode: 'number' }).notNull(),
  totalValue: bigint('total_value', { mode: 'number' }).notNull(),
  purchasePrice: bigint('purchase_price', { mode: 'number' }),
  certificateNumber: text('certificate_number'),
  lastPriceUpdate: text('last_price_update'),

  // Phase 3 columns
  name: text('name'),
  grams: real('grams'),
  purity: text('purity').$type<GoldPurity>(),
  purchaseDate: text('purchase_date'),
  purchasePricePerGram: bigint('purchase_price_per_gram', { mode: 'number' }),
  currentRatePerGram: bigint('current_rate_per_gram', { mode: 'number' }),
  lastRateUpdate: text('last_rate_update'),
  totalInvestment: bigint('total_investment', { mode: 'number' }),
  currentValue: bigint('current_value', { mode: 'number' }),
  gainLoss: bigint('gain_loss', { mode: 'number' }),
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
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
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
  accountNumber: text('account_number').notNull(),
  accountHolder: text('account_holder').notNull(),
  pan: text('pan').notNull(),
  tier: text('tier').$type<NPSAccountType>().notNull(),
  status: text('status').$type<NPSAccountStatus>().default('ACTIVE'),
  subscriberId: text('subscriber_id'),
  equityFundValue: bigint('equity_fund_value', { mode: 'number' }).default(0),
  debtFundValue: bigint('debt_fund_value', { mode: 'number' }).default(0),
  alternativeFundValue: bigint('alternative_fund_value', { mode: 'number' }).default(0),
  totalValue: bigint('total_value', { mode: 'number' }).notNull().default(0),
  totalContributed: bigint('total_contributed', { mode: 'number' }).notNull().default(0),
  employerContribution: bigint('employer_contribution', { mode: 'number' }).default(0),
  gainLoss: bigint('gain_loss', { mode: 'number' }).default(0),
  openingDate: text('opening_date').notNull(),
  expectedMaturityDate: text('expected_maturity_date'),
  lastStatementDate: text('last_statement_date'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  uniqueIndex('nps_account_number_idx').on(table.userId, table.accountNumber),
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
  principalPaisa: bigint('principal_paisa', { mode: 'number' }).notNull(),
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
  maturityAmountPaisa: bigint('maturity_amount_paisa', { mode: 'number' }),       // auto-computed
  status: text('status').$type<FDStatus>().default('ACTIVE'),
  isTaxSaver: boolean('is_tax_saver').default(false),
  autoRenew: boolean('auto_renew').default(false),
  prematureWithdrawalPenaltyPct: real('premature_withdrawal_penalty_pct').default(1.0),
  jointHolderName: text('joint_holder_name'),
  documentPath: text('document_path'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('fd_bank_idx').on(table.bankName),
  index('fd_status_idx').on(table.status),
  index('fd_maturity_idx').on(table.maturityDate),
  index('fixed_deposits_user_id_idx').on(table.userId),
]);

export type FixedDeposit = typeof fixedDeposits.$inferSelect;
export type NewFixedDeposit = typeof fixedDeposits.$inferInsert;

// 6. EPF accounts (mandatory provident fund, employer-tied).
// Sprint 3 Phase 5: renamed from `provident_fund` since PPF/VPF/NSC/
// KVP/SSY/SCSS now live in `small_savings_accounts`. `account_type`
// column kept for backwards compat with the migrated data but is
// effectively always 'EPF' going forward.
export type PFAccountType = 'EPF' | 'PPF' | 'VPF';

export const epfAccounts = pgTable('epf_accounts', {
  id: serial('id').primaryKey(),
  accountType: text('account_type').$type<PFAccountType>().notNull(),
  accountNumber: text('account_number'),
  accountHolder: text('account_holder').notNull(),
  pan: text('pan'),
  universalAccountNumber: text('uan'),
  employeeBalance: bigint('employee_balance', { mode: 'number' }).default(0),
  employerBalance: bigint('employer_balance', { mode: 'number' }).default(0),
  interestBalance: bigint('interest_balance', { mode: 'number' }).default(0),
  totalBalance: bigint('total_balance', { mode: 'number' }).notNull().default(0),
  totalContributed: bigint('total_contributed', { mode: 'number' }).notNull().default(0),
  interestEarned: bigint('interest_earned', { mode: 'number' }).default(0),
  ppfMaturityDate: text('ppf_maturity_date'),
  ppfExtensionDate: text('ppf_extension_date'),
  isActive: boolean('is_active').default(true),
  openingDate: text('opening_date').notNull(),
  lastContributionDate: text('last_contribution_date'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('pf_account_type_idx').on(table.accountType),
  index('pf_uan_idx').on(table.universalAccountNumber),
  index('epf_accounts_user_id_idx').on(table.userId),
  uniqueIndex('epf_account_number_unique').on(table.userId, table.accountNumber),
]);

// Backwards-compat alias — older code imports `providentFund`. New
// code should use `epfAccounts`.
export const providentFund = epfAccounts;
export type EpfAccount = typeof epfAccounts.$inferSelect;
export type NewEpfAccount = typeof epfAccounts.$inferInsert;
export type ProvidentFund = EpfAccount;
export type NewProvidentFund = NewEpfAccount;

/* ─── Small savings schemes (Sprint 3 Phase 5) ──────────────────────
 *
 * PPF, VPF, NSC, KVP, SSY, SCSS — Indian govt-backed small savings.
 * Each has distinct lock-in, interest rate, compounding, and tax
 * treatment. One row per account; transactions ledger records
 * deposits / interest credits / withdrawals.
 * ───────────────────────────────────────────────────────────────────── */

export type SmallSavingsScheme = 'PPF' | 'VPF' | 'NSC' | 'KVP' | 'SSY' | 'SCSS';
export type SmallSavingsStatus = 'ACTIVE' | 'MATURED' | 'CLOSED' | 'EXTENDED';
export type InterestCompounding = 'YEARLY' | 'HALF_YEARLY' | 'QUARTERLY';

export const smallSavingsAccounts = pgTable('small_savings_accounts', {
  id: serial('id').primaryKey(),
  schemeType: text('scheme_type').$type<SmallSavingsScheme>().notNull(),
  accountNumber: text('account_number').notNull(),
  // For SSY this is the child's name; for others it's the depositor.
  holderName: text('holder_name').notNull(),
  // For SSY: child's DOB (used to derive 21-year maturity from open-date
  // OR child age 18 — whichever later).
  holderDob: text('holder_dob'),
  pan: text('pan'),
  institution: text('institution'), // bank or post office branch
  openingDate: text('opening_date').notNull(),
  maturityDate: text('maturity_date').notNull(),
  // PPF can be extended in 5-year blocks past 15 years. Tracks how many.
  extensionBlocksUsed: integer('extension_blocks_used').default(0),
  // Annual deposit cap as of FY 2025-26: PPF 1.5L, SSY 1.5L, NSC 1.5L
  // for 80C; KVP/SCSS unlimited. We don't enforce — display only.
  depositAmountPaisa: bigint('deposit_amount_paisa', { mode: 'number' }).default(0),
  currentBalancePaisa: bigint('current_balance_paisa', { mode: 'number' }).notNull().default(0),
  // Annual interest rate as a percentage (e.g. 7.1 for PPF, 8.2 for SSY).
  // Govt-set and revised quarterly; user updates manually for now.
  interestRatePercent: real('interest_rate_percent').notNull(),
  interestCompounding: text('interest_compounding').$type<InterestCompounding>().notNull().default('YEARLY'),
  // For PPF: 15 years from opening, even if extension blocks add more.
  // For SCSS: 5 years from opening. NSC: 5 years. KVP: ~115 months.
  // SSY: 21 years OR child's 21st birthday — whichever later.
  lockInEndDate: text('lock_in_end_date'),
  // Total deposits since opening (paisa, useful for tax 80C tracking).
  totalDepositedPaisa: bigint('total_deposited_paisa', { mode: 'number' }).notNull().default(0),
  totalInterestPaisa: bigint('total_interest_paisa', { mode: 'number' }).notNull().default(0),
  status: text('status').$type<SmallSavingsStatus>().notNull().default('ACTIVE'),
  passbookPath: text('passbook_path'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('small_savings_user_id_idx').on(table.userId),
  index('small_savings_scheme_idx').on(table.schemeType),
  uniqueIndex('small_savings_account_unique').on(table.userId, table.schemeType, table.accountNumber),
]);

export type SmallSavingsAccount = typeof smallSavingsAccounts.$inferSelect;
export type NewSmallSavingsAccount = typeof smallSavingsAccounts.$inferInsert;

export type SmallSavingsTxnType =
  | 'DEPOSIT'
  | 'INTEREST_CREDIT'
  | 'WITHDRAWAL'
  | 'PARTIAL_WITHDRAWAL'
  | 'MATURITY';

export const smallSavingsTransactions = pgTable('small_savings_transactions', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id').notNull().references(() => smallSavingsAccounts.id, { onDelete: 'cascade' }),
  txnDate: text('txn_date').notNull(),
  txnType: text('txn_type').$type<SmallSavingsTxnType>().notNull(),
  amountPaisa: bigint('amount_paisa', { mode: 'number' }).notNull(),
  // Balance after this transaction (paisa) — denormalised so projections
  // are cheap.
  balanceAfterPaisa: bigint('balance_after_paisa', { mode: 'number' }),
  referenceNumber: text('reference_number'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('small_savings_txn_user_id_idx').on(table.userId),
  index('small_savings_txn_account_idx').on(table.accountId),
  index('small_savings_txn_date_idx').on(table.txnDate),
]);

export type SmallSavingsTransaction = typeof smallSavingsTransactions.$inferSelect;
export type NewSmallSavingsTransaction = typeof smallSavingsTransactions.$inferInsert;

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
  purchasePrice: bigint('purchase_price', { mode: 'number' }).notNull(),
  purchaseDate: text('purchase_date').notNull(),
  currentValuation: bigint('current_valuation', { mode: 'number' }).notNull(),
  valuationDate: text('valuation_date'),
  gainLoss: bigint('gain_loss', { mode: 'number' }).notNull(),
  gainLossPercent: real('gain_loss_percent').notNull(),
  mortgageAmount: bigint('mortgage_amount', { mode: 'number' }),
  mortgageLender: text('mortgage_lender'),
  mortgageRate: real('mortgage_rate'),
  mortgageStartDate: text('mortgage_start_date'),
  mortgageEndDate: text('mortgage_end_date'),
  monthlyRent: bigint('monthly_rent', { mode: 'number' }),
  rentStartDate: text('rent_start_date'),
  rentTenantName: text('rent_tenant_name'),
  propertyTaxAnnual: bigint('property_tax_annual', { mode: 'number' }),
  lastPropertyTaxPaid: text('last_property_tax_paid'),
  documentPath: text('document_path'),
  notes: text('notes'),
  // ─── Sprint 5.1a — housing loan + self-occupation flags ──────────
  /** Self-occupied properties cap sec 24(b) interest at ₹2L (post-1999
   *  loans) or ₹30k (pre-1999). Let-out properties have no cap on
   *  interest deduction but the loss can offset other heads only up
   *  to ₹2L (cross-head set-off rule). */
  isSelfOccupied: boolean('is_self_occupied').notNull().default(false),
  /** Annual home-loan interest paid in the FY — drives sec 24(b)
   *  deduction. Distinct from `mortgage_amount` (principal balance). */
  homeLoanInterestPaidPaisa: bigint('home_loan_interest_paid_paisa', { mode: 'number' }).notNull().default(0),
  /** Loan disbursal date is needed for the pre/post-Apr-1-1999 split
   *  on the self-occupied cap (₹30k vs ₹2L). */
  homeLoanDisbursedDate: text('home_loan_disbursed_date'),
  /** First home + stamp value ≤ ₹45L + loan disbursed Apr-2019 to
   *  Mar-2022 unlocks the additional sec 80EEA ₹1.5L deduction on
   *  interest above the 24(b) cap. */
  isFirstHome: boolean('is_first_home').notNull().default(false),
  /** Stamp duty value at purchase — only checked for the 80EEA
   *  ≤ ₹45L eligibility test. NULL means not captured. */
  stampValuePaisa: bigint('stamp_value_paisa', { mode: 'number' }),
  /** Carpet area in sqft. Sec 80EEA requires ≤ 968 sqft (60 sqm) for
   *  metro cities and ≤ 1290 sqft (120 sqm) elsewhere — the FY 2026-27
   *  Yeswanth template enforces the 968-sqft cap as the conservative
   *  default. NULL means not captured. */
  carpetAreaSqft: real('carpet_area_sqft'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('re_type_idx').on(table.type),
  index('re_city_idx').on(table.city),
  index('re_status_idx').on(table.status),
  index('real_estate_user_id_idx').on(table.userId),
]);

export type RealEstate = typeof realEstate.$inferSelect;
export type NewRealEstate = typeof realEstate.$inferInsert;

/* ─── Sprint 5.3 — historical rental track per property × FY ──────────
 * Each row = "this property earned this much rent during this FY".
 *
 * Why a separate table (not e.g. JSON on real_estate)?
 *   • Lets users edit / annotate prior-year figures independently of
 *     today's `monthly_rent` (which reflects the *current* tenant only).
 *   • Drives the YoY trend rows on /income (Sprint 5.2 footnote: rental
 *     was previously excluded from YoY because monthly_rent has no
 *     history). With this table, /api/income/summary trend rows can
 *     report real per-FY rental for every prior year the user backfills.
 *   • Keeps the JOIN cheap for the income page (one row per property
 *     per FY, scoped by user_id index).
 *
 * Fallback contract for the *current* FY:
 *   • If a row exists for the current FY → use it.
 *   • Else → fall back to `real_estate.monthly_rent × months_let_default`
 *     so a brand-new user with no history sees their tenanted property
 *     reflected in the income totals immediately.
 *
 * Months_let: 1..12 because partly-vacant FYs are common (mid-year
 * tenant exits, new acquisitions). Enforced via CHECK constraint at
 * the SQL layer — Drizzle doesn't surface CHECK in this version so the
 * migration SQL is hand-edited to add it.
 *
 * Unique (user_id, real_estate_id, fy) prevents two rows for the same
 * property+FY. If the tenant changes mid-year, the row holds the
 * combined annual total; the `notes` field captures the human-readable
 * split (e.g. "Tenant A Apr-Aug ₹1.2L, Tenant B Sep-Mar ₹1.55L"). */
export const rentalHistory = pgTable('rental_history', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  realEstateId: integer('real_estate_id').notNull().references(() => realEstate.id, { onDelete: 'cascade' }),
  fy: text('fy').notNull(),  // 'YYYY-YY' format, validated at API boundary
  rentReceivedPaisa: bigint('rent_received_paisa', { mode: 'number' }).notNull(),
  /** Months the property was let during this FY. 12 = full year tenanted.
   *  Lower values mean partial vacancy (e.g. 9 = three months vacant).
   *  Enforced 1..12 via CHECK constraint in migration SQL. */
  monthsLet: integer('months_let').notNull().default(12),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
}, (table) => [
  index('rental_history_user_id_idx').on(table.userId),
  index('rental_history_user_fy_idx').on(table.userId, table.fy),
  index('rental_history_property_idx').on(table.realEstateId),
  // One row per property × FY per tenant of the dashboard.
  uniqueIndex('rental_history_property_fy_unique').on(table.userId, table.realEstateId, table.fy),
]);

export type RentalHistory = typeof rentalHistory.$inferSelect;
export type NewRentalHistory = typeof rentalHistory.$inferInsert;

// 8. Insurance Policies
export type PolicyType = 'TERM_LIFE' | 'WHOLE_LIFE' | 'ENDOWMENT' | 'ULIP' | 'HEALTH' | 'CRITICAL_ILLNESS' | 'DISABILITY' | 'ACCIDENT';
export type PolicyStatus = 'ACTIVE' | 'LAPSED' | 'SURRENDERED' | 'MATURED' | 'CLAIMED';

export const insurancePolicies = pgTable('insurance_policies', {
  id: serial('id').primaryKey(),
  policyNumber: text('policy_number').notNull(),
  policyType: text('policy_type').$type<PolicyType>().notNull(),
  status: text('status').$type<PolicyStatus>().default('ACTIVE'),
  policyHolder: text('policy_holder').notNull(),
  insurer: text('insurer').notNull(),
  insurerCode: text('insurer_code'),
  sumAssured: bigint('sum_assured', { mode: 'number' }).notNull(),
  maturityBenefit: bigint('maturity_benefit', { mode: 'number' }),
  premiumAmount: bigint('premium_amount', { mode: 'number' }).notNull(),
  premiumFrequency: text('premium_frequency'),
  policyTerm: integer('policy_term'),
  premiumPaymentTerm: integer('premium_payment_term'),
  policyStartDate: text('policy_start_date').notNull(),
  maturityDate: text('maturity_date'),
  lastPremiumPaidDate: text('last_premium_paid_date'),
  nextPremiumDueDate: text('next_premium_due_date'),
  investmentValue: bigint('investment_value', { mode: 'number' }),
  investmentGainLoss: bigint('investment_gain_loss', { mode: 'number' }),
  // Whole life / pension policies — annuity payout per period (paisa)
  annuityAmount: bigint('annuity_amount', { mode: 'number' }),
  annuityFrequency: text('annuity_frequency'), // MONTHLY | QUARTERLY | HALF_YEARLY | YEARLY
  annuityStartDate: text('annuity_start_date'),
  riders: text('riders'),
  documentPath: text('document_path'),
  nomineeName: text('nominee_name'),
  nomineeRelation: text('nominee_relation'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  uniqueIndex('policy_number_idx').on(table.userId, table.policyNumber),
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
  originalAmount: bigint('original_amount', { mode: 'number' }).notNull(),
  currentBalance: bigint('current_balance', { mode: 'number' }).notNull(),
  interestRate: real('interest_rate').notNull(),
  monthlyEmi: bigint('monthly_emi', { mode: 'number' }).notNull(),
  startDate: text('start_date').notNull(),
  maturityDate: text('maturity_date'),
  remainingTenor: integer('remaining_tenor'),
  accountNumber: text('account_number'),
  loanNumber: text('loan_number'),
  totalPaidSoFar: bigint('total_paid_so_far', { mode: 'number' }).default(0),
  lastPaymentDate: text('last_payment_date'),
  nextPaymentDate: text('next_payment_date'),
  collateralType: text('collateral_type'),
  collateralValue: bigint('collateral_value', { mode: 'number' }),
  purposeOfLoan: text('purpose_of_loan'),
  documentPath: text('document_path'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
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
  amount: bigint('amount', { mode: 'number' }).notNull(),         // in paisa (statement total)
  paidOn: text('paid_on').notNull(),           // ISO date — kept for backward compat
  statementDate: text('statement_date'),       // ISO date — when bill was generated
  dueDate: text('due_date'),                   // ISO date — when payment is due
  paidAmount: bigint('paid_amount', { mode: 'number' }),          // paisa — NULL means statement still outstanding
  settledOn: text('settled_on'),               // ISO date — when statement was actually paid
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('cc_expense_liability_idx').on(table.liabilityId),
  index('cc_expense_period_idx').on(table.period),
  uniqueIndex('cc_expense_liability_period_idx').on(table.userId, table.liabilityId, table.period),
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
  openingBalance: bigint('opening_balance', { mode: 'number' }).notNull(), // paisa
  emi: bigint('emi', { mode: 'number' }).notNull(),                       // paisa
  principal: bigint('principal', { mode: 'number' }).notNull(),            // paisa
  interest: bigint('interest', { mode: 'number' }).notNull(),              // paisa
  closingBalance: bigint('closing_balance', { mode: 'number' }).notNull(), // paisa
  status: text('status').$type<AmortizationStatus>().default('UPCOMING'),
  paidOn: text('paid_on'),                             // ISO date
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
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
  pricePerUnit: bigint('price_per_unit', { mode: 'number' }).notNull(),
  amount: bigint('amount', { mode: 'number' }).notNull(),
  brokerageCharges: bigint('brokerage_charges', { mode: 'number' }).default(0),
  taxesAndCharges: bigint('taxes_and_charges', { mode: 'number' }).default(0),
  totalCost: bigint('total_cost', { mode: 'number' }).notNull(),
  transactionDate: text('transaction_date').notNull(),
  settlementDate: text('settlement_date'),
  referenceNumber: text('reference_number'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('tx_asset_type_idx').on(table.assetType),
  index('tx_date_idx').on(table.transactionDate),
  index('tx_type_idx').on(table.type),
  index('investment_transactions_user_id_idx').on(table.userId),
]);

export type InvestmentTransaction = typeof investmentTransactions.$inferSelect;
export type NewInvestmentTransaction = typeof investmentTransactions.$inferInsert;

/**
 * Income-tax slab table — Sprint 4 Phase 1.
 *
 * Government-published slabs per (FY, regime). Used by the goal +
 * retirement projections AND the new /tax regime-compare view.
 *
 * Shape:
 *   • fy             FY string, "2025-26"
 *   • regime         'NEW' | 'OLD'
 *   • slabOrder      0-indexed, must be contiguous within (fy, regime)
 *   • lowerPaisa     inclusive lower bound
 *   • upperPaisa     inclusive upper bound; NULL = open-ended top slab
 *   • ratePct        marginal rate within the slab
 *
 * NO user_id — these are shared govt-published rates. Multi-tenancy
 * doesn't apply; everyone reads from the same table. Maintaining a
 * single seeded table avoids per-tenant drift the day rates change.
 *
 * Conventions captured separately at the regime level (NOT in slabs):
 *   • Standard deduction — applied to gross salary before slabs
 *   • Section 87A rebate — applies after slab tax computation
 *   • Health & Education Cess — 4% applied after tax + rebate
 *   • Surcharge brackets — Sprint 4.5 or later (high-income edge cases)
 */
export type TaxRegime = 'NEW' | 'OLD';

export const taxSlabs = pgTable('tax_slabs', {
  id: serial('id').primaryKey(),
  fy: text('fy').notNull(),
  regime: text('regime').$type<TaxRegime>().notNull(),
  slabOrder: integer('slab_order').notNull(),
  lowerPaisa: bigint('lower_paisa', { mode: 'number' }).notNull(),
  /** NULL = open-ended (highest slab). */
  upperPaisa: bigint('upper_paisa', { mode: 'number' }),
  ratePct: real('rate_pct').notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
}, (table) => [
  index('tax_slabs_fy_regime_idx').on(table.fy, table.regime),
  uniqueIndex('tax_slabs_fy_regime_order_unique').on(table.fy, table.regime, table.slabOrder),
]);

export type TaxSlab = typeof taxSlabs.$inferSelect;
export type NewTaxSlab = typeof taxSlabs.$inferInsert;

/**
 * Regime-level constants per FY — standard deduction, 87A rebate
 * threshold + amount, cess rate. Kept separately from slabs because
 * these don't change at slab boundaries; they apply once per return.
 *
 * Seeded alongside taxSlabs for the same FYs. UI reads this table to
 * show "Standard deduction ₹75k for new regime" etc.
 */
export const taxRegimeConfig = pgTable('tax_regime_config', {
  id: serial('id').primaryKey(),
  fy: text('fy').notNull(),
  regime: text('regime').$type<TaxRegime>().notNull(),
  /** Subtracted from gross salary before slab application. */
  standardDeductionPaisa: bigint('standard_deduction_paisa', { mode: 'number' }).notNull(),
  /** Income at or below this threshold qualifies for 87A rebate. */
  rebate87aThresholdPaisa: bigint('rebate_87a_threshold_paisa', { mode: 'number' }).notNull(),
  /** Maximum rebate (capped at this OR the tax owed, whichever is lower). */
  rebate87aMaxPaisa: bigint('rebate_87a_max_paisa', { mode: 'number' }).notNull(),
  /** 4% in current law; kept configurable for future changes. */
  cessPct: real('cess_pct').notNull().default(4),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
}, (table) => [
  uniqueIndex('tax_regime_config_fy_regime_unique').on(table.fy, table.regime),
]);

export type TaxRegimeConfig = typeof taxRegimeConfig.$inferSelect;

// 11. Tax Deductions (Section 80)
export type DeductionSection = 'SECTION_80C' | 'SECTION_80CCC' | 'SECTION_80CCD' | 'SECTION_80D' | 'SECTION_80E' | 'SECTION_80EE' | 'SECTION_80TTA' | 'OTHER';

export const taxDeductions = pgTable('tax_deductions', {
  id: serial('id').primaryKey(),
  section: text('section').notNull(), // '80C'|'80CCD_1B'|'80D'|'80G'|'24B'|...
  description: text('description').notNull(),
  // Legacy columns (Phase <6)
  deductibleAmount: bigint('deductible_amount', { mode: 'number' }).notNull().default(0),
  availableLimit: bigint('available_limit', { mode: 'number' }).notNull().default(0),
  utilizableAmount: bigint('utilizable_amount', { mode: 'number' }).notNull().default(0),
  documentType: text('document_type'),
  documentPath: text('document_path'),
  category: text('category'),
  incurredDate: text('incurred_date').notNull().default(''),
  financialYear: text('financial_year').notNull(),
  claimed: boolean('claimed').default(false),
  claimedAmount: bigint('claimed_amount', { mode: 'number' }),
  claimedInYear: text('claimed_in_year'),
  notes: text('notes'),
  // Phase 6 columns
  subType: text('sub_type'),
  amountPaisa: bigint('amount_paisa', { mode: 'number' }).default(0),
  paymentDate: text('payment_date'),
  paymentMethod: text('payment_method'), // CASH|CHEQUE|NEFT|UPI|CARD
  recipientName: text('recipient_name'),
  recipientPan: text('recipient_pan'),
  recipient80gNumber: text('recipient_80g_number'),
  qualifyingPercent: real('qualifying_percent'),
  hasUpperLimit: boolean('has_upper_limit').default(false),
  linkedAssetType: text('linked_asset_type'),
  linkedAssetId: integer('linked_asset_id'),
  // ─── Sprint 5.1a — per-deduction NEW-regime eligibility ────────────
  /** Most chapter VI-A deductions disappear under NEW regime. The
   *  notable exception is 80CCD(2) (employer NPS contribution) which
   *  remains allowed. When `eligibleUnderNew=true`, the deduction
   *  contributes to the NEW-regime deduction sum in regime-compare;
   *  otherwise it counts only under OLD. Default false (conservative
   *  — matches pre-5.1 behaviour where NEW-regime deductions = ₹0). */
  eligibleUnderNew: boolean('eligible_under_new').notNull().default(false),
  // ─── Sprint 5.1c — 80G categorisation + 80D buckets ─────────────────
  /** 80G donation category. NULL for non-80G rows.
   *   - 50_NO_LIMIT  → 50% deduction, no upper bound (e.g. PM CARES)
   *   - 100_NO_LIMIT → 100% deduction, no upper bound (e.g. PMNRF)
   *   - 50_WITH_LIMIT → 50% deduction, capped at 10% of adjusted gross
   *   - 100_WITH_LIMIT → 100% deduction, capped at 10% of adjusted gross
   *  The two _WITH_LIMIT categories share the 10% adjusted-gross cap. */
  eightyGCategory: text('eighty_g_category'),
  /** 80D bucket. NULL for non-80D rows.
   *   - SELF_FAMILY → premium for self + spouse + children (₹25k / ₹50k sr)
   *   - PARENTS     → premium for parents (₹25k / ₹50k sr if parents are sr) */
  eightyDBucket: text('eighty_d_bucket'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
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
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
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
  equityTarget: bigint('equity_target', { mode: 'number' }).notNull(),
  equityAllocation: bigint('equity_allocation', { mode: 'number' }).default(0),
  equityActual: bigint('equity_actual', { mode: 'number' }).default(0),
  mfTarget: bigint('mf_target', { mode: 'number' }).notNull(),
  mfAllocation: bigint('mf_allocation', { mode: 'number' }).default(0),
  mfActual: bigint('mf_actual', { mode: 'number' }).default(0),
  goldTarget: bigint('gold_target', { mode: 'number' }).default(0),
  goldAllocation: bigint('gold_allocation', { mode: 'number' }).default(0),
  goldActual: bigint('gold_actual', { mode: 'number' }).default(0),
  npsTarget: bigint('nps_target', { mode: 'number' }).default(0),
  npsAllocation: bigint('nps_allocation', { mode: 'number' }).default(0),
  npsActual: bigint('nps_actual', { mode: 'number' }).default(0),
  pfTarget: bigint('pf_target', { mode: 'number' }).default(0),
  pfAllocation: bigint('pf_allocation', { mode: 'number' }).default(0),
  pfActual: bigint('pf_actual', { mode: 'number' }).default(0),
  reTarget: bigint('re_target', { mode: 'number' }).default(0),
  reAllocation: bigint('re_allocation', { mode: 'number' }).default(0),
  reActual: bigint('re_actual', { mode: 'number' }).default(0),
  emergencyTarget: bigint('emergency_target', { mode: 'number' }).notNull(),
  emergencyActual: bigint('emergency_actual', { mode: 'number' }).default(0),
  deductionTarget: bigint('deduction_target', { mode: 'number' }).notNull(),
  deductionActual: bigint('deduction_actual', { mode: 'number' }).default(0),
  totalPlannedInvestment: bigint('total_planned_investment', { mode: 'number' }).notNull(),
  totalActualInvestment: bigint('total_actual_investment', { mode: 'number' }).default(0),
  status: text('status').$type<PlanStatus>().default('PLANNED'),
  progressPercent: real('progress_percent').default(0),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  uniqueIndex('plan_fy_idx').on(table.userId, table.financialYear),
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
  price: bigint('price', { mode: 'number' }).notNull(),
  priceDate: text('price_date').notNull(),
  priceTime: text('price_time'),
  dayHigh: bigint('day_high', { mode: 'number' }),
  dayLow: bigint('day_low', { mode: 'number' }),
  volume: integer('volume'),
  previousClose: bigint('previous_close', { mode: 'number' }),
  change: bigint('change', { mode: 'number' }),
  changePercent: real('change_percent'),
  source: text('source').notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('snapshot_asset_idx').on(table.assetSymbol),
  index('snapshot_date_idx').on(table.priceDate),
  index('snapshot_source_idx').on(table.source),
  uniqueIndex('snapshot_unique_idx').on(table.userId, table.assetSymbol, table.priceDate),
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
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
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
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('alert_history_rule_idx').on(table.ruleId),
  index('alert_history_sent_idx').on(table.sentAt),
  uniqueIndex('alert_history_dedup_idx').on(table.userId, table.dedupKey),
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
  purchasePrice: bigint('purchase_price', { mode: 'number' }).notNull(),   // paisa
  salePrice: bigint('sale_price', { mode: 'number' }).notNull(),             // paisa
  capitalGain: bigint('capital_gain', { mode: 'number' }).notNull(),         // paisa (can be negative)
  holdingPeriod: text('holding_period').$type<HoldingPeriod>().notNull(),
  exemptionApplied: bigint('exemption_applied', { mode: 'number' }).default(0), // paisa
  taxableGain: bigint('taxable_gain', { mode: 'number' }).notNull(),         // paisa
  taxRate: real('tax_rate').notNull(),                     // percentage
  taxAmount: bigint('tax_amount', { mode: 'number' }).notNull(),             // paisa
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
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
  amount: bigint('amount', { mode: 'number' }).notNull(),   // paisa
  paymentDate: text('payment_date').notNull(),
  referenceNumber: text('reference_number'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
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
  grossSalaryPaisa: bigint('gross_salary_paisa', { mode: 'number' }).notNull(),
  exemptionsPaisa: bigint('exemptions_paisa', { mode: 'number' }).default(0),
  section16Paisa: bigint('section16_paisa', { mode: 'number' }).default(0),
  taxableSalaryPaisa: bigint('taxable_salary_paisa', { mode: 'number' }).notNull(),
  tdsPaisa: bigint('tds_paisa', { mode: 'number' }).default(0),
  // ─── Sprint 5.1a — salary components ──────────────────────────────
  // The Yeswanth template models salary as a sum of components so
  // HRA exemption + 80C limits can be computed correctly. We mirror
  // that structure: when these are populated, gross_salary_paisa is
  // the cached sum. When all zero (legacy rows), regime-compare
  // falls back to using gross_salary_paisa as a single bucket.
  basicPaisa: bigint('basic_paisa', { mode: 'number' }).notNull().default(0),
  daPaisa: bigint('da_paisa', { mode: 'number' }).notNull().default(0),
  hraReceivedPaisa: bigint('hra_received_paisa', { mode: 'number' }).notNull().default(0),
  ltaPaisa: bigint('lta_paisa', { mode: 'number' }).notNull().default(0),
  conveyancePaisa: bigint('conveyance_paisa', { mode: 'number' }).notNull().default(0),
  childrenEdAllowancePaisa: bigint('children_ed_allowance_paisa', { mode: 'number' }).notNull().default(0),
  medicalPaisa: bigint('medical_paisa', { mode: 'number' }).notNull().default(0),
  otherAllowancesPaisa: bigint('other_allowances_paisa', { mode: 'number' }).notNull().default(0),
  /** Annual rent paid (sheet's monthly Rent × months) — separate from
   *  `real_estate.monthly_rent` because the user may rent their primary
   *  residence while owning property elsewhere (very common). Drives
   *  the HRA exemption sec 10(13A) calculation. */
  rentPaidMonthlyPaisa: bigint('rent_paid_monthly_paisa', { mode: 'number' }).notNull().default(0),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('salary_income_fy_idx').on(table.financialYear),
  index('salary_income_user_id_idx').on(table.userId),
]);

export type SalaryIncomeRow = typeof salaryIncome.$inferSelect;

// ─── Sprint 4 Phase 2 — Form 26AS reconciliation ──────────────────────────
// User uploads their Form 26AS PDF for an FY. We store the file on disk
// and best-effort extract the headline "Total Tax Deducted" / "Total
// Income" numbers via pdfjs-dist regex sweep. The /tax/form-26as page
// then shows these alongside the user's own `tds_credits` rows so the
// user can spot mismatches and tick the matching rows as reconciled.
//
// Parsing is intentionally fragile-tolerant: govt PDF format shifts
// every couple of years and table-cell extraction quality is poor.
// When parse fails, parsed_total_*_paisa stay NULL and the user can
// still rely on visual comparison + manual matching.
export const form26asUploads = pgTable('form_26as_uploads', {
  id: serial('id').primaryKey(),
  fy: text('fy').notNull(),
  filePath: text('file_path').notNull(),
  uploadedAt: timestamp('uploaded_at', { mode: 'date' }).defaultNow(),
  parsedTotalTdsPaisa: bigint('parsed_total_tds_paisa', { mode: 'number' }),
  parsedTotalIncomePaisa: bigint('parsed_total_income_paisa', { mode: 'number' }),
  parsedAt: timestamp('parsed_at', { mode: 'date' }),
  parseNotes: text('parse_notes'),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('form_26as_uploads_user_id_idx').on(table.userId),
  index('form_26as_uploads_fy_idx').on(table.fy),
  index('form_26as_uploads_user_fy_idx').on(table.userId, table.fy),
]);

export type Form26asUpload = typeof form26asUploads.$inferSelect;
export type NewForm26asUpload = typeof form26asUploads.$inferInsert;

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
  incomePaisa: bigint('income_paisa', { mode: 'number' }).notNull(),
  tdsPaisa: bigint('tds_paisa', { mode: 'number' }).notNull(),
  notes: text('notes'),
  // Sprint 4 Phase 2 — Form 26AS reconciliation flags.
  isReconciled: boolean('is_reconciled').notNull().default(false),
  reconciledViaUploadId: integer('reconciled_via_upload_id').references(
    () => form26asUploads.id,
    { onDelete: 'set null' },
  ),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  index('tds_credits_fy_idx').on(table.financialYear),
  index('tds_credits_category_idx').on(table.category),
  index('tds_credits_user_id_idx').on(table.userId),
]);

export type TdsCreditsRow = typeof tdsCredits.$inferSelect;

// ─── Sprint 4 Phase 3 — Advance tax planner ──────────────────────────────
// Track the 4 quarterly advance-tax installments per FY. Due dates are
// fixed by law: 15 Jun / 15 Sep / 15 Dec / 15 Mar with cumulative
// thresholds 15% / 45% / 75% / 100% of projected annual liability.
// Underpayment by >10% at year-end triggers interest under 234B/234C —
// we surface the warning but defer the exact penalty math (slab-based,
// hairy) to a later phase.
//
// Rows are auto-seeded on first GET for a given (user, fy). The unique
// index on (user_id, fy, installment_order) prevents duplicates.
export const advanceTaxInstallments = pgTable('advance_tax_installments', {
  id: serial('id').primaryKey(),
  fy: text('fy').notNull(),
  installmentOrder: integer('installment_order').notNull(),
  dueDate: text('due_date').notNull(),
  duePct: real('due_pct').notNull(),
  paidAmountPaisa: bigint('paid_amount_paisa', { mode: 'number' }).notNull().default(0),
  paidDate: text('paid_date'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  uniqueIndex('advance_tax_user_fy_order_idx').on(
    table.userId,
    table.fy,
    table.installmentOrder,
  ),
  index('advance_tax_user_id_idx').on(table.userId),
  index('advance_tax_fy_idx').on(table.fy),
]);

export type AdvanceTaxInstallment = typeof advanceTaxInstallments.$inferSelect;
export type NewAdvanceTaxInstallment = typeof advanceTaxInstallments.$inferInsert;

// ─── Sprint 4 Phase 4 — ITR form selector ────────────────────────────────
// Persisted result of the ITR-form wizard. wizard_answers is jsonb so we
// can evolve the question set without schema churn. selected_form is
// constrained at the application layer to ITR-1/2/3/4.
export type ItrForm = 'ITR-1' | 'ITR-2' | 'ITR-3' | 'ITR-4';

export interface ItrWizardAnswers {
  hasSalary: boolean;
  numHouseProperties: number;
  hasCapitalGains: boolean;
  hasBusinessIncome: boolean;
  hasPresumptive: boolean;
  hasForeignIncome: boolean;
  hasOtherSources: boolean;
  totalIncomePaisa: number;
}

export const itrFormSelection = pgTable('itr_form_selection', {
  id: serial('id').primaryKey(),
  fy: text('fy').notNull(),
  selectedForm: text('selected_form').$type<ItrForm>().notNull(),
  wizardAnswers: jsonb('wizard_answers').$type<ItrWizardAnswers>().notNull(),
  reasoning: text('reasoning'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  uniqueIndex('itr_form_selection_user_fy_idx').on(table.userId, table.fy),
  index('itr_form_selection_user_id_idx').on(table.userId),
]);

export type ItrFormSelection = typeof itrFormSelection.$inferSelect;
export type NewItrFormSelection = typeof itrFormSelection.$inferInsert;

// ─── Sprint 4.1 — ITR-4 (Sugam) presumptive income lines ─────────────────
// One row per presumptive-income source per FY. Sections supported:
//   • 44AD  — small business (deemed 6% digital / 8% cash of gross)
//   • 44ADA — professionals (deemed 50% of gross)
//   • 44AE  — goods carriage (manual declared profit, no auto-minimum)
//
// `deemedProfitPct` is stored alongside `declaredProfitPaisa` so we can
// later spot any row where the user declared below the section minimum
// without re-deriving the rule from receipt_mode. CRUD routes enforce
// `declaredProfit >= grossReceipts * deemedProfitPct / 100` server-side
// for 44AD/44ADA; 44AE accepts the declared value as-is.
export type PresumptiveSection = '44AD' | '44ADA' | '44AE';
export type ReceiptMode = 'DIGITAL' | 'CASH' | 'MIXED';

export const presumptiveIncome = pgTable('presumptive_income', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  fy: text('fy').notNull(),
  section: text('section').$type<PresumptiveSection>().notNull(),
  businessName: text('business_name').notNull(),
  natureOfBusiness: text('nature_of_business'),
  grossReceiptsPaisa: bigint('gross_receipts_paisa', { mode: 'number' }).notNull(),
  receiptMode: text('receipt_mode').$type<ReceiptMode>().default('DIGITAL'),
  deemedProfitPct: real('deemed_profit_pct').notNull(),
  declaredProfitPaisa: bigint('declared_profit_paisa', { mode: 'number' }).notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
}, (table) => [
  index('presumptive_income_user_id_idx').on(table.userId),
  index('presumptive_income_user_fy_idx').on(table.userId, table.fy),
]);

export type PresumptiveIncomeRow = typeof presumptiveIncome.$inferSelect;
export type NewPresumptiveIncome = typeof presumptiveIncome.$inferInsert;

// Other sources income (Schedule OS) — interest, dividends, etc.
export type OtherIncomeSource =
  | 'BANK_INTEREST'
  | 'FD_INTEREST'
  | 'PF_INTEREST'
  | 'DIVIDEND'
  // Sprint 3 Phase 2 — broader categorisation for the /income summary.
  // These map to ITR sections users actually file under.
  | 'AGRICULTURAL'     // Section 10(1) exempt — but reported for rate determination
  | 'PENSION'          // Section 17(2) — treated as salary for tax purposes
  | 'GIFT'             // Section 56(2)(x) — taxable above ₹50k from non-relatives
  | 'BUSINESS'         // Section 28 — proprietorship / professional income
  | 'FREELANCE'        // 44ADA presumptive / freelance consulting
  | 'INSURANCE_MATURITY' // Section 10(10D) typically exempt
  | 'OTHER';

export const otherSourcesIncome = pgTable('other_sources_income', {
  id: serial('id').primaryKey(),
  financialYear: text('financial_year').notNull(),
  source: text('source').$type<OtherIncomeSource>().notNull(),
  description: text('description').notNull(),
  amountPaisa: bigint('amount_paisa', { mode: 'number' }).notNull(),
  // Sprint 3 Phase 2 — surface tax-exempt income (e.g. agricultural under
  // Section 10(1), life-insurance maturity under 10(10D)) in the /income
  // summary while still reporting them for ITR rate determination.
  isTaxExempt: boolean('is_tax_exempt').notNull().default(false),
  taxSection: text('tax_section'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
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
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  uniqueIndex('tax_pref_fy_section_idx').on(table.userId, table.financialYear, table.section),
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
  // Free-form attribution for who locked the FY — added later via manual
  // ALTER TABLE in personal v1's SQLite (see v1 CLAUDE.md note about
  // npm run db:push failing on existing indexes). Carried into pfd-saas
  // schema during Sprint 1.5 Phase 2 so the v1 import round-trips.
  lockedBy: text('locked_by'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => [
  uniqueIndex('fy_close_fy_cat_idx').on(table.userId, table.financialYear, table.category),
  index('fy_close_status_user_id_idx').on(table.userId),
]);

export type FyCloseStatusRow = typeof fyCloseStatus.$inferSelect;

// ─── Sprint 5.1c — Cost Inflation Index (CII) table ─────────────────────────
// Govt-published index values for indexed LTCG computation under the
// pre-Jul-2024 election. Base FY 2001-02 = 100. NOT user-scoped — this is
// public reference data, identical for all users. Seeded via migration.
export const costInflationIndex = pgTable('cost_inflation_index', {
  fy: text('fy').primaryKey(),
  /** Index value (real-valued so future fractional revisions can be
   *  represented; currently all integers). */
  indexValue: real('index_value').notNull(),
  notes: text('notes'),
});

export type CostInflationIndexRow = typeof costInflationIndex.$inferSelect;

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
