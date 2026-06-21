CREATE TABLE "form_16a_uploads" (
	"id" serial PRIMARY KEY NOT NULL,
	"fy" text NOT NULL,
	"cert_number" text NOT NULL,
	"deductor_name" text NOT NULL,
	"deductor_tan" text NOT NULL,
	"deductee_pan" text,
	"section" text DEFAULT '194JB' NOT NULL,
	"period_from" text,
	"period_to" text,
	"quarter" text,
	"amount_paid_paisa" bigint DEFAULT 0 NOT NULL,
	"tds_paisa" bigint DEFAULT 0 NOT NULL,
	"tds_deposited_paisa" bigint DEFAULT 0 NOT NULL,
	"uploaded_at" timestamp DEFAULT now(),
	"source_filename" text,
	"source_kind" text NOT NULL,
	"raw_text" text,
	"notes" text,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mf_redemptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"mutual_fund_id" integer NOT NULL,
	"request_date" text NOT NULL,
	"after_cutoff" boolean DEFAULT false NOT NULL,
	"applicable_nav_date" text NOT NULL,
	"mode" text NOT NULL,
	"requested_value" real NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"nav_paisa" bigint,
	"units_sold" real,
	"proceeds_paisa" bigint,
	"cost_basis_paisa" bigint,
	"realized_gain_paisa" bigint,
	"acquisition_date" text,
	"holding_period" text,
	"financial_year" text,
	"settled_at" timestamp,
	"transaction_id" integer,
	"capital_gain_id" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"user_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "form_16a_uploads" ADD CONSTRAINT "form_16a_uploads_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mf_redemptions" ADD CONSTRAINT "mf_redemptions_mutual_fund_id_mutual_funds_id_fk" FOREIGN KEY ("mutual_fund_id") REFERENCES "public"."mutual_funds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mf_redemptions" ADD CONSTRAINT "mf_redemptions_transaction_id_investment_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."investment_transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mf_redemptions" ADD CONSTRAINT "mf_redemptions_capital_gain_id_capital_gains_id_fk" FOREIGN KEY ("capital_gain_id") REFERENCES "public"."capital_gains"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mf_redemptions" ADD CONSTRAINT "mf_redemptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "form_16a_uploads_fy_idx" ON "form_16a_uploads" USING btree ("user_id","fy");--> statement-breakpoint
CREATE INDEX "form_16a_uploads_tan_idx" ON "form_16a_uploads" USING btree ("user_id","deductor_tan");--> statement-breakpoint
CREATE INDEX "form_16a_uploads_user_id_idx" ON "form_16a_uploads" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "form_16a_uploads_cert_uq" ON "form_16a_uploads" USING btree ("user_id","cert_number");--> statement-breakpoint
CREATE INDEX "mf_redemptions_mf_idx" ON "mf_redemptions" USING btree ("user_id","mutual_fund_id");--> statement-breakpoint
CREATE INDEX "mf_redemptions_status_idx" ON "mf_redemptions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "mf_redemptions_user_id_idx" ON "mf_redemptions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mf_redemptions_one_pending_per_fund" ON "mf_redemptions" USING btree ("mutual_fund_id") WHERE "mf_redemptions"."status" = 'PENDING';