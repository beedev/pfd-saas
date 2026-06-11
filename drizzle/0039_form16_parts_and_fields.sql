-- Form 16 parts + tax-computation fields (V1 back-port).
--
-- V1 added five columns to form_16_uploads to support the two-part
-- (Part A / Part B) merge model and the Part-B tax-computation card:
--
--   hra_exemption_paisa        — sec 10(13A), line 2(e); a component of
--                                exempt_allowances, surfaced on its own.
--   total_taxable_income_paisa — line 12; the figure tax is computed on.
--   tax_on_total_income_paisa  — line 13; tax before cess/surcharge/rebate.
--   net_tax_payable_paisa      — line 21; the final liability on the cert.
--   parts_present              — which halves are merged: '', 'A', 'B',
--                                or 'A,B'. The upload route MERGEs a second
--                                part into the existing (user_id, tan, fy)
--                                row instead of creating a duplicate.
--
-- All money columns are bigint NOT NULL DEFAULT 0 (paisa). parts_present
-- is text NOT NULL DEFAULT '' so existing rows read as "no parts tracked".
--
-- Already user-scoped via the existing row (form_16_uploads.user_id) — no
-- extra user_id needed on these columns.

ALTER TABLE form_16_uploads
  ADD COLUMN hra_exemption_paisa bigint NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE form_16_uploads
  ADD COLUMN total_taxable_income_paisa bigint NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE form_16_uploads
  ADD COLUMN tax_on_total_income_paisa bigint NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE form_16_uploads
  ADD COLUMN net_tax_payable_paisa bigint NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE form_16_uploads
  ADD COLUMN parts_present text NOT NULL DEFAULT '';
