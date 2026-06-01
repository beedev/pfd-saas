ALTER TABLE "real_estate" ADD COLUMN "is_self_occupied" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "real_estate" ADD COLUMN "home_loan_interest_paid_paisa" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "real_estate" ADD COLUMN "home_loan_disbursed_date" text;--> statement-breakpoint
ALTER TABLE "real_estate" ADD COLUMN "is_first_home" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "real_estate" ADD COLUMN "stamp_value_paisa" bigint;--> statement-breakpoint
ALTER TABLE "real_estate" ADD COLUMN "carpet_area_sqft" real;--> statement-breakpoint
ALTER TABLE "salary_income" ADD COLUMN "basic_paisa" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "salary_income" ADD COLUMN "da_paisa" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "salary_income" ADD COLUMN "hra_received_paisa" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "salary_income" ADD COLUMN "lta_paisa" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "salary_income" ADD COLUMN "conveyance_paisa" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "salary_income" ADD COLUMN "children_ed_allowance_paisa" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "salary_income" ADD COLUMN "medical_paisa" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "salary_income" ADD COLUMN "other_allowances_paisa" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "salary_income" ADD COLUMN "rent_paid_monthly_paisa" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tax_deductions" ADD COLUMN "eligible_under_new" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "metro_city" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "is_sr_citizen" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "spouse_is_sr_citizen" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "parents_are_sr_citizens" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "has_permanent_disability" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "disability_severity" text;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_disability_severity_check" CHECK ("disability_severity" IS NULL OR "disability_severity" IN ('REGULAR','SEVERE'));--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "is_family_pensioner" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "is_govt_employee_for_nps" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Sprint 5.1a backfill: existing 80CCD(2) (employer NPS) rows count under
-- NEW regime too. Mark them eligible so the regime-compare no longer
-- under-states NEW-regime deductions for users who already track this.
UPDATE "tax_deductions" SET "eligible_under_new" = true
WHERE "section" LIKE '%80CCD(2)%' OR "section" = '80CCD_2';