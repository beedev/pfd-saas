-- Snapshot-sync migration.
--
-- Migrations 0028-0037 were hand-written (no drizzle-kit snapshots), so
-- drizzle-kit was still diffing schema.ts against the stale 0027 snapshot.
-- This generate run re-baselines drizzle/meta (0038_snapshot.json is the
-- full current-schema state). The auto-generated SQL therefore contained
-- ~10 migrations' worth of DDL that ALREADY exists in the database
-- (forex_deposits, form_16_uploads, customer TDS columns, contribution
-- streams, mf categories, loan tax flags, retirement brackets/treatment,
-- 26AS parsed deductors, invoice TDS auto-derive columns + the
-- tds_credits_source_unique partial index, etc). All of that was trimmed
-- away — each statement was verified present in 0028-0037.
--
-- What remains is the ONLY genuinely-new DDL: re-scoping business_profile
-- GSTIN uniqueness from global to per-tenant (user_id, gstin).
ALTER TABLE "business_profile" DROP CONSTRAINT "business_profile_gstin_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "business_profile_gstin_user_unique" ON "business_profile" USING btree ("user_id","gstin");
