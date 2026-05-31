CREATE TABLE "account" (
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "account_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "alert_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"rule_id" integer NOT NULL,
	"dedup_key" text NOT NULL,
	"message" text NOT NULL,
	"triggered_value" real,
	"sent_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"rule_type" text NOT NULL,
	"symbol" text,
	"asset_id" integer,
	"operator" text,
	"threshold" real NOT NULL,
	"is_enabled" boolean DEFAULT true,
	"cooldown_hours" integer DEFAULT 24,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "budget_carry_forward" (
	"id" serial PRIMARY KEY NOT NULL,
	"period" text NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "budget_carry_forward_period_unique" UNIQUE("period")
);
--> statement-breakpoint
CREATE TABLE "budget_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"sort_order" integer DEFAULT 0,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "budget_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"category_id" integer NOT NULL,
	"period" text NOT NULL,
	"planned_amount" integer DEFAULT 0,
	"actual_amount" integer DEFAULT 0,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "business_profile" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_name" text NOT NULL,
	"trade_name" text,
	"gstin" text NOT NULL,
	"pan" text NOT NULL,
	"state_code" text NOT NULL,
	"address" text,
	"city" text,
	"pincode" text,
	"email" text,
	"phone" text,
	"financial_year" text NOT NULL,
	"invoice_prefix" text,
	"invoice_start_number" integer DEFAULT 1,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "business_profile_gstin_unique" UNIQUE("gstin")
);
--> statement-breakpoint
CREATE TABLE "capital_gains" (
	"id" serial PRIMARY KEY NOT NULL,
	"financial_year" text NOT NULL,
	"asset_type" text NOT NULL,
	"asset_name" text NOT NULL,
	"purchase_date" text,
	"sale_date" text NOT NULL,
	"purchase_price" integer NOT NULL,
	"sale_price" integer NOT NULL,
	"capital_gain" integer NOT NULL,
	"holding_period" text NOT NULL,
	"exemption_applied" integer DEFAULT 0,
	"taxable_gain" integer NOT NULL,
	"tax_rate" real NOT NULL,
	"tax_amount" integer NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "carryforward_balances" (
	"id" serial PRIMARY KEY NOT NULL,
	"category_id" integer NOT NULL,
	"amount" integer NOT NULL,
	"as_of_date" text NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "chit_fund_installments" (
	"id" serial PRIMARY KEY NOT NULL,
	"chit_fund_id" integer NOT NULL,
	"month_number" integer NOT NULL,
	"due_date" text NOT NULL,
	"installment_paid" integer NOT NULL,
	"dividend_received" integer DEFAULT 0,
	"net_outgo" integer NOT NULL,
	"paid_on" text NOT NULL,
	"payment_method" text DEFAULT 'NEFT',
	"winner_name" text,
	"winner_bid_discount_pct" real,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "chit_funds" (
	"id" serial PRIMARY KEY NOT NULL,
	"foreman_name" text NOT NULL,
	"scheme_name" text NOT NULL,
	"registration_number" text,
	"is_registered" boolean DEFAULT true,
	"chit_value" integer NOT NULL,
	"monthly_installment" integer NOT NULL,
	"duration_months" integer NOT NULL,
	"group_size" integer NOT NULL,
	"ticket_number" text,
	"start_date" text NOT NULL,
	"expected_end_date" text NOT NULL,
	"foreman_commission_pct" real DEFAULT 5,
	"document_charges_paisa" integer DEFAULT 0,
	"prompt_payment_discount_pct" real DEFAULT 0,
	"installments_paid" integer DEFAULT 0,
	"total_paid" integer DEFAULT 0,
	"total_dividends" integer DEFAULT 0,
	"net_contribution" integer DEFAULT 0,
	"status" text DEFAULT 'ACTIVE',
	"win_month" integer,
	"win_date" text,
	"win_bid_discount_pct" real,
	"win_amount_received" integer,
	"xirr" real,
	"next_due_date" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "credit_card_expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"liability_id" integer NOT NULL,
	"period" text NOT NULL,
	"amount" integer NOT NULL,
	"paid_on" text NOT NULL,
	"statement_date" text,
	"due_date" text,
	"paid_amount" integer,
	"settled_on" text,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"gstin" text,
	"pan" text,
	"state_code" text NOT NULL,
	"address" text,
	"city" text,
	"pincode" text,
	"email" text,
	"phone" text,
	"is_b2b" boolean DEFAULT false NOT NULL,
	"supply_type" text DEFAULT 'REGULAR',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "financial_goals" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"target_amount" integer NOT NULL,
	"target_date" text,
	"current_amount" integer DEFAULT 0,
	"color" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "fixed_deposits" (
	"id" serial PRIMARY KEY NOT NULL,
	"bank_name" text NOT NULL,
	"account_number" text,
	"principal_paisa" integer NOT NULL,
	"interest_rate" real NOT NULL,
	"compounding_freq" text DEFAULT 'QUARTERLY',
	"interest_type" text DEFAULT 'CUMULATIVE',
	"start_date" text NOT NULL,
	"maturity_date" text NOT NULL,
	"tenure_months" integer,
	"maturity_amount_paisa" integer,
	"status" text DEFAULT 'ACTIVE',
	"is_tax_saver" boolean DEFAULT false,
	"auto_renew" boolean DEFAULT false,
	"premature_withdrawal_penalty_pct" real DEFAULT 1,
	"joint_holder_name" text,
	"document_path" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "future_savings_plan" (
	"id" serial PRIMARY KEY NOT NULL,
	"lump_sum_paisa" integer DEFAULT 0 NOT NULL,
	"monthly_paisa" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "fy_close_status" (
	"id" serial PRIMARY KEY NOT NULL,
	"financial_year" text NOT NULL,
	"category" text NOT NULL,
	"is_locked" boolean DEFAULT false,
	"locked_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "gold_holdings" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"quantity" real NOT NULL,
	"current_price" integer NOT NULL,
	"total_value" integer NOT NULL,
	"purchase_price" integer,
	"certificate_number" text,
	"last_price_update" text,
	"name" text,
	"grams" real,
	"purity" text,
	"purchase_date" text,
	"purchase_price_per_gram" integer,
	"current_rate_per_gram" integer,
	"last_rate_update" text,
	"total_investment" integer,
	"current_value" integer,
	"gain_loss" integer,
	"gain_loss_percent" real,
	"notes" text,
	"sgb_series" text,
	"sgb_issue_date" text,
	"sgb_maturity_date" text,
	"sgb_interest_rate" real DEFAULT 2.5,
	"etf_symbol" text,
	"etf_units" real,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "holdings" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"quantity" real NOT NULL,
	"average_price" integer NOT NULL,
	"current_price" integer NOT NULL,
	"purchase_date" text NOT NULL,
	"total_investment" integer NOT NULL,
	"current_value" integer NOT NULL,
	"gain_loss" integer NOT NULL,
	"gain_loss_percent" real NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "income_tax_paid" (
	"id" serial PRIMARY KEY NOT NULL,
	"financial_year" text NOT NULL,
	"payment_type" text NOT NULL,
	"amount" integer NOT NULL,
	"payment_date" text NOT NULL,
	"reference_number" text,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "insurance_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"policy_number" text NOT NULL,
	"policy_type" text NOT NULL,
	"status" text DEFAULT 'ACTIVE',
	"policy_holder" text NOT NULL,
	"insurer" text NOT NULL,
	"insurer_code" text,
	"sum_assured" integer NOT NULL,
	"maturity_benefit" integer,
	"premium_amount" integer NOT NULL,
	"premium_frequency" text,
	"policy_term" integer,
	"premium_payment_term" integer,
	"policy_start_date" text NOT NULL,
	"maturity_date" text,
	"last_premium_paid_date" text,
	"next_premium_due_date" text,
	"investment_value" integer,
	"investment_gain_loss" integer,
	"annuity_amount" integer,
	"annuity_frequency" text,
	"annuity_start_date" text,
	"riders" text,
	"document_path" text,
	"nominee_name" text,
	"nominee_relation" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "insurance_policies_policy_number_unique" UNIQUE("policy_number")
);
--> statement-breakpoint
CREATE TABLE "investment_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"asset_type" text NOT NULL,
	"asset_id" integer,
	"asset_name" text NOT NULL,
	"quantity" real NOT NULL,
	"price_per_unit" integer NOT NULL,
	"amount" integer NOT NULL,
	"brokerage_charges" integer DEFAULT 0,
	"taxes_and_charges" integer DEFAULT 0,
	"total_cost" integer NOT NULL,
	"transaction_date" text NOT NULL,
	"settlement_date" text,
	"reference_number" text,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "invoice_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
	"description" text NOT NULL,
	"sac_code" text NOT NULL,
	"quantity" real DEFAULT 1,
	"unit_price" integer NOT NULL,
	"discount" integer DEFAULT 0,
	"taxable_amount" integer NOT NULL,
	"tax_rate" real NOT NULL,
	"cgst_rate" real DEFAULT 0,
	"cgst_amount" integer DEFAULT 0,
	"sgst_rate" real DEFAULT 0,
	"sgst_amount" integer DEFAULT 0,
	"igst_rate" real DEFAULT 0,
	"igst_amount" integer DEFAULT 0,
	"total_amount" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_number" text NOT NULL,
	"invoice_date" text NOT NULL,
	"customer_id" integer,
	"customer_name" text NOT NULL,
	"customer_gstin" text,
	"invoice_type" text NOT NULL,
	"original_invoice_id" integer,
	"original_invoice_number" text,
	"original_invoice_date" text,
	"place_of_supply_code" text NOT NULL,
	"is_inter_state" boolean NOT NULL,
	"is_reverse_charge" boolean DEFAULT false,
	"supply_type" text DEFAULT 'REGULAR',
	"taxable_amount" integer NOT NULL,
	"cgst_amount" integer DEFAULT 0,
	"sgst_amount" integer DEFAULT 0,
	"igst_amount" integer DEFAULT 0,
	"cess_amount" integer DEFAULT 0,
	"total_amount" integer NOT NULL,
	"return_period" text NOT NULL,
	"status" text DEFAULT 'DRAFT',
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "liabilities" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'ACTIVE',
	"creditor_name" text NOT NULL,
	"creditor_type" text,
	"original_amount" integer NOT NULL,
	"current_balance" integer NOT NULL,
	"interest_rate" real NOT NULL,
	"monthly_emi" integer NOT NULL,
	"start_date" text NOT NULL,
	"maturity_date" text,
	"remaining_tenor" integer,
	"account_number" text,
	"loan_number" text,
	"total_paid_so_far" integer DEFAULT 0,
	"last_payment_date" text,
	"next_payment_date" text,
	"collateral_type" text,
	"collateral_value" integer,
	"purpose_of_loan" text,
	"document_path" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "loan_amortization" (
	"id" serial PRIMARY KEY NOT NULL,
	"liability_id" integer NOT NULL,
	"month_number" integer NOT NULL,
	"due_date" text,
	"opening_balance" integer NOT NULL,
	"emi" integer NOT NULL,
	"principal" integer NOT NULL,
	"interest" integer NOT NULL,
	"closing_balance" integer NOT NULL,
	"status" text DEFAULT 'UPCOMING',
	"paid_on" text,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "mutual_funds" (
	"id" serial PRIMARY KEY NOT NULL,
	"isin" text NOT NULL,
	"scheme_name" text NOT NULL,
	"fund_type" text NOT NULL,
	"folio_number" text,
	"units" real NOT NULL,
	"nav" integer NOT NULL,
	"total_investment" integer NOT NULL,
	"current_value" integer NOT NULL,
	"gain_loss" integer NOT NULL,
	"gain_loss_percent" real NOT NULL,
	"last_nav_date" text,
	"investment_start_date" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nps_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_number" text NOT NULL,
	"account_holder" text NOT NULL,
	"pan" text NOT NULL,
	"tier" text NOT NULL,
	"status" text DEFAULT 'ACTIVE',
	"subscriber_id" text,
	"equity_fund_value" integer DEFAULT 0,
	"debt_fund_value" integer DEFAULT 0,
	"alternative_fund_value" integer DEFAULT 0,
	"total_value" integer DEFAULT 0 NOT NULL,
	"total_contributed" integer DEFAULT 0 NOT NULL,
	"employer_contribution" integer DEFAULT 0,
	"gain_loss" integer DEFAULT 0,
	"opening_date" text NOT NULL,
	"expected_maturity_date" text,
	"last_statement_date" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "nps_accounts_account_number_unique" UNIQUE("account_number")
);
--> statement-breakpoint
CREATE TABLE "other_sources_income" (
	"id" serial PRIMARY KEY NOT NULL,
	"financial_year" text NOT NULL,
	"source" text NOT NULL,
	"description" text NOT NULL,
	"amount_paisa" integer NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "price_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_type" text NOT NULL,
	"asset_symbol" text NOT NULL,
	"asset_name" text,
	"price" integer NOT NULL,
	"price_date" text NOT NULL,
	"price_time" text,
	"day_high" integer,
	"day_low" integer,
	"volume" integer,
	"previous_close" integer,
	"change" integer,
	"change_percent" real,
	"source" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "projection_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"is_inflow" boolean DEFAULT true NOT NULL,
	"goal_id" integer,
	"sort_order" integer DEFAULT 0,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "projection_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"category_id" integer NOT NULL,
	"period" text NOT NULL,
	"amount" integer NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "provident_fund" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_type" text NOT NULL,
	"account_number" text,
	"account_holder" text NOT NULL,
	"pan" text,
	"uan" text,
	"employee_balance" integer DEFAULT 0,
	"employer_balance" integer DEFAULT 0,
	"interest_balance" integer DEFAULT 0,
	"total_balance" integer DEFAULT 0 NOT NULL,
	"total_contributed" integer DEFAULT 0 NOT NULL,
	"interest_earned" integer DEFAULT 0,
	"ppf_maturity_date" text,
	"ppf_extension_date" text,
	"is_active" boolean DEFAULT true,
	"opening_date" text NOT NULL,
	"last_contribution_date" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "provident_fund_account_number_unique" UNIQUE("account_number")
);
--> statement-breakpoint
CREATE TABLE "purchase_invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor_id" integer NOT NULL,
	"vendor_name" text NOT NULL,
	"vendor_gstin" text NOT NULL,
	"invoice_number" text NOT NULL,
	"invoice_date" text NOT NULL,
	"place_of_supply_code" text NOT NULL,
	"is_inter_state" boolean NOT NULL,
	"is_reverse_charge" boolean DEFAULT false,
	"taxable_amount" integer NOT NULL,
	"cgst_amount" integer DEFAULT 0,
	"sgst_amount" integer DEFAULT 0,
	"igst_amount" integer DEFAULT 0,
	"cess_amount" integer DEFAULT 0,
	"total_amount" integer NOT NULL,
	"itc_eligible" boolean DEFAULT true,
	"itc_claimed" boolean DEFAULT false,
	"return_period" text NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "real_estate" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_name" text NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"address" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"pincode" text,
	"latitude" real,
	"longitude" real,
	"area" real NOT NULL,
	"area_unit" text DEFAULT 'sqft',
	"built_up_area" real,
	"purchase_price" integer NOT NULL,
	"purchase_date" text NOT NULL,
	"current_valuation" integer NOT NULL,
	"valuation_date" text,
	"gain_loss" integer NOT NULL,
	"gain_loss_percent" real NOT NULL,
	"mortgage_amount" integer,
	"mortgage_lender" text,
	"mortgage_rate" real,
	"mortgage_start_date" text,
	"mortgage_end_date" text,
	"monthly_rent" integer,
	"rent_start_date" text,
	"rent_tenant_name" text,
	"property_tax_annual" integer,
	"last_property_tax_paid" text,
	"document_path" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "recurring_expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"category_id" integer NOT NULL,
	"amount" integer NOT NULL,
	"recurrence" text NOT NULL,
	"start_period" text NOT NULL,
	"end_period" text,
	"notes" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "retirement_asset_selection" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_class" text NOT NULL,
	"source_id" integer NOT NULL,
	"included" boolean DEFAULT true NOT NULL,
	"mode" text,
	"sale_price_override_paisa" integer,
	"expected_future_rent_paisa" integer,
	"nps_lumpsum_pct" real,
	"nps_annuity_rate_pct" real,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "retirement_assumptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"current_age" integer DEFAULT 30 NOT NULL,
	"target_age" integer DEFAULT 60 NOT NULL,
	"monthly_expense_rupees" integer DEFAULT 50000 NOT NULL,
	"inflation_pct" real DEFAULT 6 NOT NULL,
	"expected_return_pct" real DEFAULT 10 NOT NULL,
	"post_retirement_return_pct" real DEFAULT 8 NOT NULL,
	"nps_income_grows" boolean DEFAULT false NOT NULL,
	"annuity_income_grows" boolean DEFAULT true NOT NULL,
	"insurance_ladder_income_grows" boolean DEFAULT false NOT NULL,
	"rental_income_grows" boolean DEFAULT true NOT NULL,
	"ladder_start_age" integer DEFAULT 60 NOT NULL,
	"bucket_enabled" boolean DEFAULT false NOT NULL,
	"liquid_pct" real DEFAULT 10 NOT NULL,
	"stable_pct" real DEFAULT 30 NOT NULL,
	"growth_pct" real DEFAULT 60 NOT NULL,
	"liquid_return_pct" real DEFAULT 6 NOT NULL,
	"stable_return_pct" real DEFAULT 8 NOT NULL,
	"growth_return_pct" real DEFAULT 11 NOT NULL,
	"liquid_yrs_held" real DEFAULT 1 NOT NULL,
	"stable_yrs_held" real DEFAULT 3 NOT NULL,
	"retirement_duration_years" integer DEFAULT 25 NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sac_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"description" text NOT NULL,
	"default_tax_rate" real DEFAULT 18,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "sac_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "salary_income" (
	"id" serial PRIMARY KEY NOT NULL,
	"financial_year" text NOT NULL,
	"employer_name" text NOT NULL,
	"employer_tan" text NOT NULL,
	"gross_salary_paisa" integer NOT NULL,
	"exemptions_paisa" integer DEFAULT 0,
	"section16_paisa" integer DEFAULT 0,
	"taxable_salary_paisa" integer NOT NULL,
	"tds_paisa" integer DEFAULT 0,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "savings_asset_inclusion" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_class" text NOT NULL,
	"source_id" integer,
	"included" boolean DEFAULT false NOT NULL,
	"goal_id" integer,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "session" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sips" (
	"id" serial PRIMARY KEY NOT NULL,
	"mutual_fund_id" integer NOT NULL,
	"starting_units" real NOT NULL,
	"starting_nav" integer NOT NULL,
	"monthly_amount" integer NOT NULL,
	"frequency" text DEFAULT 'MONTHLY' NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text,
	"status" text DEFAULT 'ACTIVE',
	"total_invested_so_far" integer DEFAULT 0 NOT NULL,
	"last_execution_date" text,
	"next_execution_date" text,
	"expected_xirr" real,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tax_deductions" (
	"id" serial PRIMARY KEY NOT NULL,
	"section" text NOT NULL,
	"description" text NOT NULL,
	"deductible_amount" integer DEFAULT 0 NOT NULL,
	"available_limit" integer DEFAULT 0 NOT NULL,
	"utilizable_amount" integer DEFAULT 0 NOT NULL,
	"document_type" text,
	"document_path" text,
	"category" text,
	"incurred_date" text DEFAULT '' NOT NULL,
	"financial_year" text NOT NULL,
	"claimed" boolean DEFAULT false,
	"claimed_amount" integer,
	"claimed_in_year" text,
	"notes" text,
	"sub_type" text,
	"amount_paisa" integer DEFAULT 0,
	"payment_date" text,
	"payment_method" text,
	"recipient_name" text,
	"recipient_pan" text,
	"recipient_80g_number" text,
	"qualifying_percent" real,
	"has_upper_limit" boolean DEFAULT false,
	"linked_asset_type" text,
	"linked_asset_id" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tax_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"type" text DEFAULT 'OTHER' NOT NULL,
	"file_size" integer,
	"file_name" text,
	"file_path" text NOT NULL,
	"mime_type" text,
	"issuer_name" text,
	"reference_number" text,
	"issue_date" text,
	"expiry_date" text,
	"financial_year" text,
	"tags" text,
	"is_encrypted" boolean DEFAULT false,
	"notes" text,
	"deduction_id" integer,
	"category" text,
	"title" text,
	"hash_sha256" text,
	"uploaded_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tax_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"return_period" text NOT NULL,
	"cgst_liability" integer DEFAULT 0,
	"sgst_liability" integer DEFAULT 0,
	"igst_liability" integer DEFAULT 0,
	"cess_liability" integer DEFAULT 0,
	"cgst_itc_utilized" integer DEFAULT 0,
	"sgst_itc_utilized" integer DEFAULT 0,
	"igst_itc_utilized" integer DEFAULT 0,
	"cgst_cash_paid" integer DEFAULT 0,
	"sgst_cash_paid" integer DEFAULT 0,
	"igst_cash_paid" integer DEFAULT 0,
	"cess_cash_paid" integer DEFAULT 0,
	"status" text DEFAULT 'PENDING',
	"payment_date" text,
	"payment_reference" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tax_section_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"financial_year" text NOT NULL,
	"section" text NOT NULL,
	"is_excluded" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tds_credits" (
	"id" serial PRIMARY KEY NOT NULL,
	"financial_year" text NOT NULL,
	"category" text NOT NULL,
	"deductor_name" text NOT NULL,
	"deductor_tan" text,
	"deductor_pan" text,
	"section" text NOT NULL,
	"income_paisa" integer NOT NULL,
	"tds_paisa" integer NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "transformation_checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"day_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"checked" integer DEFAULT 0 NOT NULL,
	"text_value" text,
	"estimated_calories" integer,
	"estimated_protein_g" real,
	"estimation_input" text,
	"estimated_at" integer
);
--> statement-breakpoint
CREATE TABLE "transformation_days" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_id" integer NOT NULL,
	"date" text NOT NULL,
	"day_number" integer,
	"current_weight_kg" real,
	"journal" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "transformation_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"section_id" integer NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"kind" text DEFAULT 'check' NOT NULL,
	"options" text,
	"deleted_at" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "transformation_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"start_date" text NOT NULL,
	"day_count" integer DEFAULT 100 NOT NULL,
	"start_weight_kg" real,
	"goal_weight_kg" real,
	"daily_calorie_target" integer,
	"daily_protein_target_g" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "transformation_sections" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_id" integer NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"deleted_at" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"email_verified" timestamp,
	"image" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"gstin" text NOT NULL,
	"pan" text,
	"state_code" text NOT NULL,
	"address" text,
	"city" text,
	"pincode" text,
	"email" text,
	"phone" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "verification_token" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp NOT NULL,
	CONSTRAINT "verification_token_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
CREATE TABLE "yearly_investment_plan" (
	"id" serial PRIMARY KEY NOT NULL,
	"financial_year" text NOT NULL,
	"equity_target" integer NOT NULL,
	"equity_allocation" integer DEFAULT 0,
	"equity_actual" integer DEFAULT 0,
	"mf_target" integer NOT NULL,
	"mf_allocation" integer DEFAULT 0,
	"mf_actual" integer DEFAULT 0,
	"gold_target" integer DEFAULT 0,
	"gold_allocation" integer DEFAULT 0,
	"gold_actual" integer DEFAULT 0,
	"nps_target" integer DEFAULT 0,
	"nps_allocation" integer DEFAULT 0,
	"nps_actual" integer DEFAULT 0,
	"pf_target" integer DEFAULT 0,
	"pf_allocation" integer DEFAULT 0,
	"pf_actual" integer DEFAULT 0,
	"re_target" integer DEFAULT 0,
	"re_allocation" integer DEFAULT 0,
	"re_actual" integer DEFAULT 0,
	"emergency_target" integer NOT NULL,
	"emergency_actual" integer DEFAULT 0,
	"deduction_target" integer NOT NULL,
	"deduction_actual" integer DEFAULT 0,
	"total_planned_investment" integer NOT NULL,
	"total_actual_investment" integer DEFAULT 0,
	"status" text DEFAULT 'PLANNED',
	"progress_percent" real DEFAULT 0,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_history" ADD CONSTRAINT "alert_history_rule_id_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."alert_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_entries" ADD CONSTRAINT "budget_entries_category_id_budget_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."budget_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carryforward_balances" ADD CONSTRAINT "carryforward_balances_category_id_projection_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."projection_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chit_fund_installments" ADD CONSTRAINT "chit_fund_installments_chit_fund_id_chit_funds_id_fk" FOREIGN KEY ("chit_fund_id") REFERENCES "public"."chit_funds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_card_expenses" ADD CONSTRAINT "credit_card_expenses_liability_id_liabilities_id_fk" FOREIGN KEY ("liability_id") REFERENCES "public"."liabilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_amortization" ADD CONSTRAINT "loan_amortization_liability_id_liabilities_id_fk" FOREIGN KEY ("liability_id") REFERENCES "public"."liabilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projection_categories" ADD CONSTRAINT "projection_categories_goal_id_financial_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."financial_goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projection_entries" ADD CONSTRAINT "projection_entries_category_id_projection_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."projection_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_category_id_budget_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."budget_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_asset_inclusion" ADD CONSTRAINT "savings_asset_inclusion_goal_id_financial_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."financial_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sips" ADD CONSTRAINT "sips_mutual_fund_id_mutual_funds_id_fk" FOREIGN KEY ("mutual_fund_id") REFERENCES "public"."mutual_funds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transformation_checks" ADD CONSTRAINT "transformation_checks_day_id_transformation_days_id_fk" FOREIGN KEY ("day_id") REFERENCES "public"."transformation_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transformation_checks" ADD CONSTRAINT "transformation_checks_item_id_transformation_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."transformation_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transformation_days" ADD CONSTRAINT "transformation_days_plan_id_transformation_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."transformation_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transformation_items" ADD CONSTRAINT "transformation_items_section_id_transformation_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."transformation_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transformation_sections" ADD CONSTRAINT "transformation_sections_plan_id_transformation_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."transformation_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_history_rule_idx" ON "alert_history" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "alert_history_sent_idx" ON "alert_history" USING btree ("sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_history_dedup_idx" ON "alert_history" USING btree ("dedup_key");--> statement-breakpoint
CREATE INDEX "alert_rule_category_idx" ON "alert_rules" USING btree ("category");--> statement-breakpoint
CREATE INDEX "alert_rule_enabled_idx" ON "alert_rules" USING btree ("is_enabled");--> statement-breakpoint
CREATE INDEX "budget_period_idx" ON "budget_entries" USING btree ("period");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_category_period_idx" ON "budget_entries" USING btree ("category_id","period");--> statement-breakpoint
CREATE INDEX "cg_fy_idx" ON "capital_gains" USING btree ("financial_year");--> statement-breakpoint
CREATE UNIQUE INDEX "carryforward_category_idx" ON "carryforward_balances" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "chit_install_fund_idx" ON "chit_fund_installments" USING btree ("chit_fund_id");--> statement-breakpoint
CREATE INDEX "chit_install_month_idx" ON "chit_fund_installments" USING btree ("month_number");--> statement-breakpoint
CREATE INDEX "chit_status_idx" ON "chit_funds" USING btree ("status");--> statement-breakpoint
CREATE INDEX "chit_foreman_idx" ON "chit_funds" USING btree ("foreman_name");--> statement-breakpoint
CREATE INDEX "cc_expense_liability_idx" ON "credit_card_expenses" USING btree ("liability_id");--> statement-breakpoint
CREATE INDEX "cc_expense_period_idx" ON "credit_card_expenses" USING btree ("period");--> statement-breakpoint
CREATE UNIQUE INDEX "cc_expense_liability_period_idx" ON "credit_card_expenses" USING btree ("liability_id","period");--> statement-breakpoint
CREATE INDEX "customers_gstin_idx" ON "customers" USING btree ("gstin");--> statement-breakpoint
CREATE INDEX "customers_state_idx" ON "customers" USING btree ("state_code");--> statement-breakpoint
CREATE INDEX "fd_bank_idx" ON "fixed_deposits" USING btree ("bank_name");--> statement-breakpoint
CREATE INDEX "fd_status_idx" ON "fixed_deposits" USING btree ("status");--> statement-breakpoint
CREATE INDEX "fd_maturity_idx" ON "fixed_deposits" USING btree ("maturity_date");--> statement-breakpoint
CREATE UNIQUE INDEX "fy_close_fy_cat_idx" ON "fy_close_status" USING btree ("financial_year","category");--> statement-breakpoint
CREATE INDEX "gold_type_idx" ON "gold_holdings" USING btree ("type");--> statement-breakpoint
CREATE INDEX "holdings_symbol_idx" ON "holdings" USING btree ("symbol");--> statement-breakpoint
CREATE UNIQUE INDEX "holdings_symbol_unique" ON "holdings" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "itp_fy_idx" ON "income_tax_paid" USING btree ("financial_year");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_number_idx" ON "insurance_policies" USING btree ("policy_number");--> statement-breakpoint
CREATE INDEX "policy_type_idx" ON "insurance_policies" USING btree ("policy_type");--> statement-breakpoint
CREATE INDEX "policy_status_idx" ON "insurance_policies" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tx_asset_type_idx" ON "investment_transactions" USING btree ("asset_type");--> statement-breakpoint
CREATE INDEX "tx_date_idx" ON "investment_transactions" USING btree ("transaction_date");--> statement-breakpoint
CREATE INDEX "tx_type_idx" ON "investment_transactions" USING btree ("type");--> statement-breakpoint
CREATE INDEX "item_invoice_idx" ON "invoice_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "item_sac_idx" ON "invoice_items" USING btree ("sac_code");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_number_idx" ON "invoices" USING btree ("invoice_number");--> statement-breakpoint
CREATE INDEX "invoice_period_idx" ON "invoices" USING btree ("return_period");--> statement-breakpoint
CREATE INDEX "invoice_customer_idx" ON "invoices" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "invoice_type_idx" ON "invoices" USING btree ("invoice_type");--> statement-breakpoint
CREATE INDEX "liability_type_idx" ON "liabilities" USING btree ("type");--> statement-breakpoint
CREATE INDEX "liability_status_idx" ON "liabilities" USING btree ("status");--> statement-breakpoint
CREATE INDEX "liability_creditor_idx" ON "liabilities" USING btree ("creditor_name");--> statement-breakpoint
CREATE INDEX "amort_liability_idx" ON "loan_amortization" USING btree ("liability_id");--> statement-breakpoint
CREATE INDEX "amort_month_idx" ON "loan_amortization" USING btree ("month_number");--> statement-breakpoint
CREATE INDEX "mf_isin_idx" ON "mutual_funds" USING btree ("isin");--> statement-breakpoint
CREATE INDEX "mf_folio_idx" ON "mutual_funds" USING btree ("folio_number");--> statement-breakpoint
CREATE UNIQUE INDEX "nps_account_number_idx" ON "nps_accounts" USING btree ("account_number");--> statement-breakpoint
CREATE INDEX "nps_pan_idx" ON "nps_accounts" USING btree ("pan");--> statement-breakpoint
CREATE INDEX "other_income_fy_idx" ON "other_sources_income" USING btree ("financial_year");--> statement-breakpoint
CREATE INDEX "snapshot_asset_idx" ON "price_snapshots" USING btree ("asset_symbol");--> statement-breakpoint
CREATE INDEX "snapshot_date_idx" ON "price_snapshots" USING btree ("price_date");--> statement-breakpoint
CREATE INDEX "snapshot_source_idx" ON "price_snapshots" USING btree ("source");--> statement-breakpoint
CREATE UNIQUE INDEX "snapshot_unique_idx" ON "price_snapshots" USING btree ("asset_symbol","price_date");--> statement-breakpoint
CREATE INDEX "projection_period_idx" ON "projection_entries" USING btree ("period");--> statement-breakpoint
CREATE INDEX "projection_category_idx" ON "projection_entries" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projection_category_period_idx" ON "projection_entries" USING btree ("category_id","period");--> statement-breakpoint
CREATE INDEX "pf_account_type_idx" ON "provident_fund" USING btree ("account_type");--> statement-breakpoint
CREATE INDEX "pf_uan_idx" ON "provident_fund" USING btree ("uan");--> statement-breakpoint
CREATE INDEX "purchase_vendor_idx" ON "purchase_invoices" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "purchase_period_idx" ON "purchase_invoices" USING btree ("return_period");--> statement-breakpoint
CREATE INDEX "re_type_idx" ON "real_estate" USING btree ("type");--> statement-breakpoint
CREATE INDEX "re_city_idx" ON "real_estate" USING btree ("city");--> statement-breakpoint
CREATE INDEX "re_status_idx" ON "real_estate" USING btree ("status");--> statement-breakpoint
CREATE INDEX "recurring_expenses_category_idx" ON "recurring_expenses" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "recurring_expenses_active_idx" ON "recurring_expenses" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "retirement_asset_class_idx" ON "retirement_asset_selection" USING btree ("asset_class");--> statement-breakpoint
CREATE UNIQUE INDEX "retirement_asset_unique_idx" ON "retirement_asset_selection" USING btree ("asset_class","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sac_code_idx" ON "sac_codes" USING btree ("code");--> statement-breakpoint
CREATE INDEX "salary_income_fy_idx" ON "salary_income" USING btree ("financial_year");--> statement-breakpoint
CREATE INDEX "savings_asset_class_idx" ON "savings_asset_inclusion" USING btree ("asset_class");--> statement-breakpoint
CREATE INDEX "savings_asset_source_idx" ON "savings_asset_inclusion" USING btree ("asset_class","source_id");--> statement-breakpoint
CREATE INDEX "sip_mf_idx" ON "sips" USING btree ("mutual_fund_id");--> statement-breakpoint
CREATE INDEX "sip_status_idx" ON "sips" USING btree ("status");--> statement-breakpoint
CREATE INDEX "deduction_section_idx" ON "tax_deductions" USING btree ("section");--> statement-breakpoint
CREATE INDEX "deduction_fy_idx" ON "tax_deductions" USING btree ("financial_year");--> statement-breakpoint
CREATE INDEX "doc_type_idx" ON "tax_documents" USING btree ("type");--> statement-breakpoint
CREATE INDEX "doc_fy_idx" ON "tax_documents" USING btree ("financial_year");--> statement-breakpoint
CREATE INDEX "doc_category_idx" ON "tax_documents" USING btree ("category");--> statement-breakpoint
CREATE INDEX "doc_deduction_idx" ON "tax_documents" USING btree ("deduction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_period_idx" ON "tax_payments" USING btree ("return_period");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_pref_fy_section_idx" ON "tax_section_preferences" USING btree ("financial_year","section");--> statement-breakpoint
CREATE INDEX "tds_credits_fy_idx" ON "tds_credits" USING btree ("financial_year");--> statement-breakpoint
CREATE INDEX "tds_credits_category_idx" ON "tds_credits" USING btree ("category");--> statement-breakpoint
CREATE INDEX "trans_check_day_idx" ON "transformation_checks" USING btree ("day_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trans_check_day_item_unique" ON "transformation_checks" USING btree ("day_id","item_id");--> statement-breakpoint
CREATE INDEX "trans_day_plan_date_idx" ON "transformation_days" USING btree ("plan_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "trans_day_plan_date_unique" ON "transformation_days" USING btree ("plan_id","date");--> statement-breakpoint
CREATE INDEX "trans_item_sec_idx" ON "transformation_items" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "trans_sec_plan_idx" ON "transformation_sections" USING btree ("plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vendors_gstin_idx" ON "vendors" USING btree ("gstin");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_fy_idx" ON "yearly_investment_plan" USING btree ("financial_year");