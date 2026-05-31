ALTER TABLE "financial_goals" ADD COLUMN "goal_type" text DEFAULT 'OTHER' NOT NULL;--> statement-breakpoint
ALTER TABLE "financial_goals" ADD COLUMN "disbursement_type" text DEFAULT 'LUMPSUM' NOT NULL;--> statement-breakpoint
ALTER TABLE "financial_goals" ADD COLUMN "disbursement_amount_per_yr_paisa" bigint;--> statement-breakpoint
ALTER TABLE "financial_goals" ADD COLUMN "disbursement_years" integer;--> statement-breakpoint
ALTER TABLE "financial_goals" ADD COLUMN "disbursement_start_date" text;--> statement-breakpoint
ALTER TABLE "financial_goals" ADD COLUMN "growth_pct_per_yr" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "financial_goals" ADD COLUMN "expected_return_pct" real DEFAULT 8 NOT NULL;--> statement-breakpoint
ALTER TABLE "financial_goals" ADD COLUMN "inflation_pct" real DEFAULT 6 NOT NULL;--> statement-breakpoint
CREATE INDEX "financial_goals_type_idx" ON "financial_goals" USING btree ("goal_type");