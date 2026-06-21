CREATE TABLE IF NOT EXISTS "ais_imports" (
	"id" serial PRIMARY KEY NOT NULL,
	"fy" text NOT NULL,
	"kind" text NOT NULL,
	"pan" text,
	"categories_json" jsonb,
	"tds_json" jsonb,
	"source_filename" text,
	"uploaded_at" timestamp DEFAULT now(),
	"notes" text,
	"user_id" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ais_imports" ADD CONSTRAINT "ais_imports_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ais_imports_user_fy_idx" ON "ais_imports" USING btree ("user_id","fy");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ais_imports_user_id_idx" ON "ais_imports" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ais_imports_user_fy_kind_uq" ON "ais_imports" USING btree ("user_id","fy","kind");
