CREATE TABLE "small_savings_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"scheme_type" text NOT NULL,
	"account_number" text NOT NULL,
	"holder_name" text NOT NULL,
	"holder_dob" text,
	"pan" text,
	"institution" text,
	"opening_date" text NOT NULL,
	"maturity_date" text NOT NULL,
	"extension_blocks_used" integer DEFAULT 0,
	"deposit_amount_paisa" bigint DEFAULT 0,
	"current_balance_paisa" bigint DEFAULT 0 NOT NULL,
	"interest_rate_percent" real NOT NULL,
	"interest_compounding" text DEFAULT 'YEARLY' NOT NULL,
	"lock_in_end_date" text,
	"total_deposited_paisa" bigint DEFAULT 0 NOT NULL,
	"total_interest_paisa" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"passbook_path" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "small_savings_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"txn_date" text NOT NULL,
	"txn_type" text NOT NULL,
	"amount_paisa" bigint NOT NULL,
	"balance_after_paisa" bigint,
	"reference_number" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"user_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provident_fund" RENAME TO "epf_accounts";--> statement-breakpoint
ALTER TABLE "epf_accounts" DROP CONSTRAINT "provident_fund_user_id_user_id_fk";
--> statement-breakpoint
DROP INDEX "provident_fund_user_id_idx";--> statement-breakpoint
DROP INDEX "provident_fund_account_number_unique";--> statement-breakpoint
ALTER TABLE "small_savings_accounts" ADD CONSTRAINT "small_savings_accounts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "small_savings_transactions" ADD CONSTRAINT "small_savings_transactions_account_id_small_savings_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."small_savings_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "small_savings_transactions" ADD CONSTRAINT "small_savings_transactions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "small_savings_user_id_idx" ON "small_savings_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "small_savings_scheme_idx" ON "small_savings_accounts" USING btree ("scheme_type");--> statement-breakpoint
CREATE UNIQUE INDEX "small_savings_account_unique" ON "small_savings_accounts" USING btree ("user_id","scheme_type","account_number");--> statement-breakpoint
CREATE INDEX "small_savings_txn_user_id_idx" ON "small_savings_transactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "small_savings_txn_account_idx" ON "small_savings_transactions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "small_savings_txn_date_idx" ON "small_savings_transactions" USING btree ("txn_date");--> statement-breakpoint
ALTER TABLE "epf_accounts" ADD CONSTRAINT "epf_accounts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "epf_accounts_user_id_idx" ON "epf_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "epf_account_number_unique" ON "epf_accounts" USING btree ("user_id","account_number");--> statement-breakpoint
-- Data migration — move PPF and VPF rows out of the renamed
-- epf_accounts (now EPF-only by convention) into the new
-- small_savings_accounts table. After this runs, epf_accounts holds
-- only account_type='EPF' rows; PPF/VPF live in their proper home.
-- Default interest rates: PPF 7.1%, VPF 8.25% (FY 2025-26 govt rates).
-- These can be updated by the user post-migration.
INSERT INTO "small_savings_accounts" (
  "user_id", "scheme_type", "account_number", "holder_name", "pan",
  "opening_date", "maturity_date",
  "current_balance_paisa", "total_deposited_paisa", "total_interest_paisa",
  "interest_rate_percent", "interest_compounding", "lock_in_end_date",
  "status", "notes", "created_at", "updated_at"
)
SELECT
  e."user_id",
  e."account_type"::text,
  COALESCE(e."account_number", 'MIGRATED-EPF-' || e."id"::text),
  e."account_holder",
  e."pan",
  e."opening_date",
  COALESCE(
    e."ppf_maturity_date",
    TO_CHAR(e."opening_date"::date + INTERVAL '15 years', 'YYYY-MM-DD')
  ),
  COALESCE(e."total_balance", 0),
  COALESCE(e."total_contributed", 0),
  COALESCE(e."interest_earned", 0),
  CASE e."account_type" WHEN 'PPF' THEN 7.1 ELSE 8.25 END,
  'YEARLY',
  COALESCE(
    e."ppf_maturity_date",
    TO_CHAR(e."opening_date"::date + INTERVAL '15 years', 'YYYY-MM-DD')
  ),
  CASE WHEN e."is_active" IS DISTINCT FROM false THEN 'ACTIVE' ELSE 'CLOSED' END,
  e."notes",
  e."created_at",
  e."updated_at"
FROM "epf_accounts" e
WHERE e."account_type" IN ('PPF', 'VPF');--> statement-breakpoint
DELETE FROM "epf_accounts" WHERE "account_type" IN ('PPF', 'VPF');