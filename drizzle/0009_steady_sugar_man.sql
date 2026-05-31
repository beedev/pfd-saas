ALTER TABLE "other_sources_income" ADD COLUMN "is_tax_exempt" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "other_sources_income" ADD COLUMN "tax_section" text;