ALTER TABLE "other_sources_income" ADD COLUMN IF NOT EXISTS "source_kind" text DEFAULT 'MANUAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "other_sources_income" ADD COLUMN IF NOT EXISTS "source_ref_id" integer;
