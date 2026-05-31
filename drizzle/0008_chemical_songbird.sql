CREATE TABLE "health_insurance_cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"policy_id" integer NOT NULL,
	"member_name" text NOT NULL,
	"member_id" text,
	"relationship" text NOT NULL,
	"date_of_birth" text,
	"gender" text,
	"card_image_path" text,
	"e_card_url" text,
	"valid_until" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_insurance_claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"policy_id" integer NOT NULL,
	"member_name" text NOT NULL,
	"card_id" integer,
	"claim_date" text NOT NULL,
	"hospital" text,
	"diagnosis" text,
	"claim_amount_paisa" bigint NOT NULL,
	"approved_amount_paisa" bigint,
	"cashless" boolean DEFAULT true,
	"status" text DEFAULT 'INTIMATED' NOT NULL,
	"settlement_date" text,
	"rejection_reason" text,
	"document_path" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_insurance_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"insurer" text NOT NULL,
	"policy_number" text NOT NULL,
	"policy_type" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"policy_holder" text NOT NULL,
	"sum_insured_paisa" bigint NOT NULL,
	"cumulative_bonus_paisa" bigint DEFAULT 0,
	"ncb_percent" real DEFAULT 0,
	"premium_paisa" bigint NOT NULL,
	"premium_frequency" text DEFAULT 'ANNUAL' NOT NULL,
	"start_date" text NOT NULL,
	"renewal_date" text,
	"last_renewed_date" text,
	"waiting_period_months" integer DEFAULT 48,
	"served_waiting_months" integer DEFAULT 0,
	"pre_existing_diseases" text,
	"cashless_available" boolean DEFAULT true NOT NULL,
	"network_hospital_count" integer,
	"policy_document_path" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_insurance_portability" (
	"id" serial PRIMARY KEY NOT NULL,
	"policy_id" integer NOT NULL,
	"previous_insurer" text NOT NULL,
	"previous_policy_number" text,
	"ported_date" text NOT NULL,
	"ported_sum_insured_paisa" bigint,
	"waiting_period_used_months" integer DEFAULT 0 NOT NULL,
	"ncb_carried_percent" real DEFAULT 0,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"user_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "health_insurance_cards" ADD CONSTRAINT "health_insurance_cards_policy_id_health_insurance_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."health_insurance_policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_insurance_cards" ADD CONSTRAINT "health_insurance_cards_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_insurance_claims" ADD CONSTRAINT "health_insurance_claims_policy_id_health_insurance_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."health_insurance_policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_insurance_claims" ADD CONSTRAINT "health_insurance_claims_card_id_health_insurance_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."health_insurance_cards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_insurance_claims" ADD CONSTRAINT "health_insurance_claims_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_insurance_policies" ADD CONSTRAINT "health_insurance_policies_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_insurance_portability" ADD CONSTRAINT "health_insurance_portability_policy_id_health_insurance_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."health_insurance_policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_insurance_portability" ADD CONSTRAINT "health_insurance_portability_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "health_insurance_cards_user_id_idx" ON "health_insurance_cards" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "health_insurance_cards_policy_idx" ON "health_insurance_cards" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "health_insurance_claims_user_id_idx" ON "health_insurance_claims" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "health_insurance_claims_policy_idx" ON "health_insurance_claims" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "health_insurance_claims_status_idx" ON "health_insurance_claims" USING btree ("status");--> statement-breakpoint
CREATE INDEX "health_insurance_policies_user_id_idx" ON "health_insurance_policies" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "health_policy_number_unique" ON "health_insurance_policies" USING btree ("user_id","policy_number");--> statement-breakpoint
CREATE INDEX "health_insurance_portability_user_id_idx" ON "health_insurance_portability" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "health_insurance_portability_policy_idx" ON "health_insurance_portability" USING btree ("policy_id");--> statement-breakpoint
-- Data migration — move HEALTH-typed rows from insurance_policies into
-- the new health_insurance_policies table. After the move, those rows
-- are deleted from insurance_policies so /investments/insurance no
-- longer shows health policies among LIC / endowment / term life.
-- Defaults applied:
--   policy_type 'HEALTH' → 'INDIVIDUAL' (user can re-classify to
--                                        FAMILY_FLOATER / TOPUP / etc.)
--   premium_frequency 'YEARLY' → 'ANNUAL' (normalises naming)
--   waiting_period_months → schema default (48 = 4 yrs PED standard)
--   cashless_available → schema default true
INSERT INTO "health_insurance_policies" (
  "insurer", "policy_number", "policy_type", "status", "policy_holder",
  "sum_insured_paisa", "premium_paisa", "premium_frequency",
  "start_date", "renewal_date", "user_id", "created_at", "updated_at"
)
SELECT
  ip."insurer",
  ip."policy_number",
  'INDIVIDUAL'::text,
  CASE
    WHEN ip."status" IN ('ACTIVE', 'LAPSED', 'CANCELLED') THEN ip."status"
    WHEN ip."status" = 'SURRENDERED' THEN 'CANCELLED'
    WHEN ip."status" = 'MATURED' THEN 'CLAIM_SETTLED'
    ELSE 'ACTIVE'
  END,
  ip."policy_holder",
  ip."sum_assured",
  ip."premium_amount",
  CASE
    WHEN ip."premium_frequency" = 'YEARLY' THEN 'ANNUAL'
    WHEN ip."premium_frequency" IN ('ANNUAL', 'SEMI_ANNUAL', 'QUARTERLY', 'MONTHLY')
      THEN ip."premium_frequency"
    ELSE 'ANNUAL'
  END,
  ip."policy_start_date",
  ip."next_premium_due_date",
  ip."user_id",
  ip."created_at",
  ip."updated_at"
FROM "insurance_policies" ip
WHERE ip."policy_type" = 'HEALTH';--> statement-breakpoint
DELETE FROM "insurance_policies" WHERE "policy_type" = 'HEALTH';