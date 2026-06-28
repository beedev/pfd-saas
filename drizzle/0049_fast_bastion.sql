CREATE TABLE "recurring_deposits" (
	"id" serial PRIMARY KEY NOT NULL,
	"bank_name" text NOT NULL,
	"account_number" text,
	"monthly_installment_paisa" bigint NOT NULL,
	"interest_rate" real NOT NULL,
	"compounding_freq" text DEFAULT 'QUARTERLY',
	"tenure_months" integer NOT NULL,
	"start_date" text NOT NULL,
	"maturity_date" text NOT NULL,
	"total_deposit_paisa" bigint,
	"maturity_amount_paisa" bigint,
	"status" text DEFAULT 'ACTIVE',
	"auto_renew" boolean DEFAULT false,
	"premature_withdrawal_penalty_pct" real DEFAULT 1,
	"joint_holder_name" text,
	"document_path" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"user_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recurring_deposits" ADD CONSTRAINT "recurring_deposits_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rd_bank_idx" ON "recurring_deposits" USING btree ("bank_name");--> statement-breakpoint
CREATE INDEX "rd_status_idx" ON "recurring_deposits" USING btree ("status");--> statement-breakpoint
CREATE INDEX "rd_maturity_idx" ON "recurring_deposits" USING btree ("maturity_date");--> statement-breakpoint
CREATE INDEX "recurring_deposits_user_id_idx" ON "recurring_deposits" USING btree ("user_id");