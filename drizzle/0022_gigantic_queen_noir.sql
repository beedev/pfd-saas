CREATE TABLE "advance_tax_installments" (
	"id" serial PRIMARY KEY NOT NULL,
	"fy" text NOT NULL,
	"installment_order" integer NOT NULL,
	"due_date" text NOT NULL,
	"due_pct" real NOT NULL,
	"paid_amount_paisa" bigint DEFAULT 0 NOT NULL,
	"paid_date" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"user_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "advance_tax_installments" ADD CONSTRAINT "advance_tax_installments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "advance_tax_user_fy_order_idx" ON "advance_tax_installments" USING btree ("user_id","fy","installment_order");--> statement-breakpoint
CREATE INDEX "advance_tax_user_id_idx" ON "advance_tax_installments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "advance_tax_fy_idx" ON "advance_tax_installments" USING btree ("fy");