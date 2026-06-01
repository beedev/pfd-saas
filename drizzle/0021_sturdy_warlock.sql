CREATE TABLE "form_26as_uploads" (
	"id" serial PRIMARY KEY NOT NULL,
	"fy" text NOT NULL,
	"file_path" text NOT NULL,
	"uploaded_at" timestamp DEFAULT now(),
	"parsed_total_tds_paisa" bigint,
	"parsed_total_income_paisa" bigint,
	"parsed_at" timestamp,
	"parse_notes" text,
	"user_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tds_credits" ADD COLUMN "is_reconciled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tds_credits" ADD COLUMN "reconciled_via_upload_id" integer;--> statement-breakpoint
ALTER TABLE "form_26as_uploads" ADD CONSTRAINT "form_26as_uploads_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "form_26as_uploads_user_id_idx" ON "form_26as_uploads" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "form_26as_uploads_fy_idx" ON "form_26as_uploads" USING btree ("fy");--> statement-breakpoint
CREATE INDEX "form_26as_uploads_user_fy_idx" ON "form_26as_uploads" USING btree ("user_id","fy");--> statement-breakpoint
ALTER TABLE "tds_credits" ADD CONSTRAINT "tds_credits_reconciled_via_upload_id_form_26as_uploads_id_fk" FOREIGN KEY ("reconciled_via_upload_id") REFERENCES "public"."form_26as_uploads"("id") ON DELETE set null ON UPDATE no action;