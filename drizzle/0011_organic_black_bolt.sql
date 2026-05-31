CREATE TABLE "subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"category" text NOT NULL,
	"plan_name" text,
	"amount_paisa" bigint NOT NULL,
	"billing_frequency" text NOT NULL,
	"start_date" text NOT NULL,
	"next_renewal_date" text,
	"payment_method" text,
	"auto_renew" boolean DEFAULT true NOT NULL,
	"url" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"cancellation_date" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"user_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subscriptions_user_id_idx" ON "subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subscriptions_next_renewal_idx" ON "subscriptions" USING btree ("next_renewal_date");--> statement-breakpoint
CREATE INDEX "subscriptions_status_idx" ON "subscriptions" USING btree ("status");