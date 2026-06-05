-- Sprint A.2 (saas back-port) — auto-derive 194J TDS rows from
-- finalised B2B invoices.
--
-- New columns:
--
--   invoices.tds_deducted (boolean, default true)
--     Per-invoice override that suppresses TDS auto-derivation
--     independent of the customer-level config. Defaults true so the
--     existing rows keep their auto-derived rows on next sync. Set
--     false via the invoice detail page when the deduction was waived
--     for that one-off invoice.
--
--   tds_credits.auto_derived (boolean, default false)
--     true when the row was emitted by a derivation hook (today only
--     syncInvoiceTdsCredit). false for hand-entered rows. Manual rows
--     are sacred — the sync hook never overwrites them, even when the
--     (source_kind, source_id) key matches.
--
--   tds_credits.source_kind (text, nullable)
--     'GST_INVOICE' | 'MANUAL' | 'OTHER'. NULL on legacy rows.
--
--   tds_credits.source_id (integer, nullable)
--     FK-shaped pointer to the source row (e.g. invoices.id when
--     source_kind='GST_INVOICE'). No FK constraint because the source
--     can vary in future (cashflow_events, etc).
--
--   tds_credits.payment_date (date, nullable)
--     The date TDS was deducted. For GST_INVOICE rows this is the
--     invoice_date. Used to bucket into quarterly 26AS comparisons
--     downstream.
--
-- Partial UNIQUE INDEX on (user_id, source_kind, source_id) WHERE
-- source_kind IS NOT NULL AND source_id IS NOT NULL — the idempotency
-- key for re-derivation. user_id is part of the constraint so different
-- tenants can each have their own auto-derived row for the same
-- invoice id (the rows live in different tenant scopes). Legacy /
-- manual rows have NULL source_kind/source_id and are unconstrained.

ALTER TABLE invoices
  ADD COLUMN tds_deducted boolean NOT NULL DEFAULT true;

ALTER TABLE tds_credits
  ADD COLUMN auto_derived boolean NOT NULL DEFAULT false,
  ADD COLUMN source_kind text,
  ADD COLUMN source_id integer,
  ADD COLUMN payment_date date;

CREATE UNIQUE INDEX tds_credits_source_unique
  ON tds_credits (user_id, source_kind, source_id)
  WHERE source_kind IS NOT NULL AND source_id IS NOT NULL;
