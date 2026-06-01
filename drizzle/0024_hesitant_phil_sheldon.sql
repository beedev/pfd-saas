CREATE TABLE "presumptive_income" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"fy" text NOT NULL,
	"section" text NOT NULL,
	"business_name" text NOT NULL,
	"nature_of_business" text,
	"gross_receipts_paisa" bigint NOT NULL,
	"receipt_mode" text DEFAULT 'DIGITAL',
	"deemed_profit_pct" real NOT NULL,
	"declared_profit_paisa" bigint NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "presumptive_income" ADD CONSTRAINT "presumptive_income_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "presumptive_income_user_id_idx" ON "presumptive_income" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "presumptive_income_user_fy_idx" ON "presumptive_income" USING btree ("user_id","fy");