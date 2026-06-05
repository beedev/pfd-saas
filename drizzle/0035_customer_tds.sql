-- Sprint A.1 (saas back-port) — per-customer TDS deduction config.
--
-- Two columns on customers driving the auto-derivation of tds_credits
-- rows when a B2B sales invoice is finalised. Defaults match the most
-- common consulting case (10% u/s 194J) so existing rows just work.
--
--   • tds_rate_pct — the % of pre-GST taxable value the customer
--     deducts as TDS. Set to 0 on the customer detail page when the
--     customer does not deduct TDS at all (e.g. small B2C clients).
--
--   • tds_section — the Income Tax Act section code under which the
--     deduction happens. Common values: 194J (professional / technical
--     services, default), 194C (works contract), 194A (interest),
--     194-IA (property sale).
--
-- Already user-scoped via customers.user_id — no extra user_id column
-- needed on these per-row settings.

ALTER TABLE customers
  ADD COLUMN tds_rate_pct real NOT NULL DEFAULT 10,
  ADD COLUMN tds_section text NOT NULL DEFAULT '194J';
