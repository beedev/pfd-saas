-- Sprint 5.12 — retirement_treatment column on real_estate.
--
-- Captures the user's retirement intent for a property — decoupled from
-- the existing `status` column (which models tenancy/legal state, not
-- strategy). Drives every retirement/cashflow surface:
--
--   • 'sell'           — liquidate at retirement; full appreciated value
--                        enters the corpus. Rental income (if any) STOPS
--                        at the retirement year.
--   • 'rental_only'    — keep forever; value EXCLUDED from corpus.
--                        Rental annuity continues post-retirement.
--   • 'self_occupied'  — keep forever; value EXCLUDED from corpus. No
--                        rental stream emitted regardless of monthly_rent.
--
-- Independent of the existing `is_self_occupied` tax flag (which caps
-- sec 24(b) interest at ₹2L). The `retirement_treatment` column models
-- the user's strategic *intent* (sell vs hold for retirement). Both
-- coexist and may legitimately disagree on a given property — e.g. a
-- let-out property (is_self_occupied=false) that the user plans to
-- self-occupy at retirement (retirement_treatment='self_occupied').
--
-- Backfill: status='RENTED' rows default to 'rental_only' since the
-- user has explicitly tagged them as let-out properties — the
-- conservative assumption is they're income-producing rather than
-- corpus-contributing. Saas's PropertyStatus enum has no 'SELF_OCCUPIED'
-- value (v1 doesn't either; only OWNED/MORTGAGED/UNDER_CONSTRUCTION/
-- RENTED), so the SELF_OCCUPIED backfill branch from the v1 reference
-- commit is intentionally omitted. Everything else defaults to 'sell'
-- via the column DEFAULT.

ALTER TABLE real_estate
  ADD COLUMN retirement_treatment text DEFAULT 'sell' NOT NULL;

-- Backfill status='RENTED' → 'rental_only'. New inserts inherit 'sell'
-- via the column default.
UPDATE real_estate
  SET retirement_treatment = 'rental_only'
  WHERE status = 'RENTED';
