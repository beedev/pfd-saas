CREATE TABLE "user_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"base_currency" text DEFAULT 'INR' NOT NULL,
	"financial_year_start_month" integer DEFAULT 4 NOT NULL,
	"onboarded_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Backfill: pre-existing users (imported data, no real onboarding) get
-- a user_preferences row so the layout doesn't redirect them to the
-- onboarding wizard they don't need. display_name derives from
-- user.name or the local-part of email. onboarded_at stays NULL to
-- mark these as auto-created. Idempotent via ON CONFLICT.
INSERT INTO "user_preferences" ("user_id", "display_name", "base_currency", "financial_year_start_month")
SELECT
  u."id",
  COALESCE(u."name", split_part(u."email", '@', 1), 'User'),
  'INR',
  4
FROM "user" u
ON CONFLICT ("user_id") DO NOTHING;