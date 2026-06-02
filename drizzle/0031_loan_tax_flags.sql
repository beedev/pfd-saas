-- Sprint 5.9a — Loan tax-deduction qualifying flags.
--
-- Two boolean flags per liability row controlling whether the loan's
-- principal/interest contributes to the user's tax-deduction
-- aggregates:
--
--   • principal_qualifies_80c — when true, the FY-aggregated principal
--     paid (from the amortization schedule) flows into Section 80C.
--     Subject to the ₹1.5L 80C cap downstream.
--
--   • interest_qualifies_24b — when true, the FY-aggregated interest
--     paid flows into Section 24(b) house-property head. The 24B cap
--     (₹2L self-occupied / uncapped let-out) is applied at the
--     aggregator, not here.
--
-- Defaults: false for new rows (conservative — don't double-count
-- when the user hasn't told us this is a tax-qualifying loan). The
-- one-shot UPDATE below auto-flips both flags to true for ALL existing
-- HOME_LOAN rows since that's the by-far-most-common case where both
-- benefits apply.
--
-- Non-HOME_LOAN rows (auto, personal, education, credit-card) stay at
-- false. Education-loan interest is 80E not 24B, and 80E is a
-- separate Chapter VI-A row the user adds via the deduction wizard —
-- not modelled here. Auto / personal loans don't qualify for either
-- benefit.

ALTER TABLE liabilities
  ADD COLUMN principal_qualifies_80c boolean DEFAULT false NOT NULL,
  ADD COLUMN interest_qualifies_24b boolean DEFAULT false NOT NULL;

-- Auto-default existing HOME_LOAN rows. Pre-existing user intent is
-- "this is my home loan, of course it counts for 80C + 24(b)".
UPDATE liabilities
  SET principal_qualifies_80c = true,
      interest_qualifies_24b  = true
  WHERE type = 'HOME_LOAN';
