-- Sprint 5.13 — parsed_deductors_json on form_26as_uploads.
--
-- The v0 26AS parser matched bare digit runs after marker labels, so
-- TANs like CHEH02287F leaked `02287` as ₹2,287 and section codes like
-- 194JB leaked `194` as ₹194 of income. The v1 parser rewrite (mirrored
-- in this sprint) requires `.NN` decimal suffixes on every money match
-- and additionally extracts per-deductor rows from Part-I of the 26AS
-- so the reconciliation surface can cross-match by TAN.
--
-- This column stores those per-deductor rows as a JSON string:
--   Array<{
--     deductorName: string,
--     tan: string,
--     section: string | null,
--     totalPaidPaisa: number,
--     totalTdsPaisa: number,
--     totalDepositedPaisa: number,
--     transactionDate: string | null,   // "DD-Mon-YYYY"
--   }>
--
-- NULL when the parser couldn't pull a tabular Part-I (e.g. scanned
-- PDFs or non-standard templates) — the fallback marker-search totals
-- in parsed_total_*_paisa still apply.
--
-- Already user-scoped via the existing row (form_26as_uploads.user_id) —
-- no extra user_id needed on this column.

ALTER TABLE form_26as_uploads
  ADD COLUMN parsed_deductors_json text;
