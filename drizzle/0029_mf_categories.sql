-- Sprint 5.7a — Mutual fund sub-classification.
--
-- Adds a `category` column to mutual_funds so per-fund growth rates can
-- be resolved against MF_EQUITY / MF_DEBT / MF_HYBRID asset class rates
-- (Sprint 5.7b wires the projection layer through). Default UNKNOWN so
-- existing rows stay backward-compatible — the UI's bulk-categorise
-- modal surfaces them for the user to triage.
--
-- Why not reuse the existing fund_type column: fund_type is a finer
-- taxonomy (EQUITY/DEBT/HYBRID/LIQUID/GOLD) borrowed from the AMFI
-- scheme classification, and conflating it with growth-rate buckets
-- would lose the (LIQUID, GOLD) sub-cases. Category is the rate-bucket
-- key; fund_type stays the scheme-classification key.

ALTER TABLE mutual_funds
  ADD COLUMN category text DEFAULT 'UNKNOWN' NOT NULL;

ALTER TABLE mutual_funds
  ADD CONSTRAINT mutual_funds_category_check
  CHECK (category IN ('EQUITY','DEBT','HYBRID','UNKNOWN'));
