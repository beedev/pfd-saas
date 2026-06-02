-- Sprint 5.8a — Retirement tax brackets per user.
--
-- JSONB array sorted ascending by `threshold`. Each entry is a
-- `{threshold, ratePct}` pair where threshold is the LOWER bound of
-- the band in RUPEES (not paisa — matches how the user thinks about
-- "₹10L slab"). The compute lib applies standard slab math.
--
-- Default: 0% up to ₹10L, 15% ₹10L-₹30L, 25% above ₹30L. This is
-- Bharath's planning starting point — conservative, reflects the
-- typical post-retirement income mix (pension + capital gains +
-- some rental). Configurable per user via the /settings page editor.
--
-- The first bracket's threshold MUST be 0; subsequent thresholds
-- must be strictly ascending. The lib validates this at compute
-- time and returns zero tax for malformed input.

ALTER TABLE user_preferences
  ADD COLUMN retirement_tax_brackets jsonb
  DEFAULT '[{"threshold":0,"ratePct":0},{"threshold":1000000,"ratePct":15},{"threshold":3000000,"ratePct":25}]'::jsonb
  NOT NULL;
