-- Sprint B (saas back-port) — Form 16 upload + manual entry.
--
-- Third leg of the reconciliation triangle (books vs Form 16 vs 26AS).
-- Mirrors form_26as_uploads in pattern: file goes to
-- uploads/<userId>/form-16/, parser is best-effort, manual edits are
-- first-class via /tax/form-16/[id].
--
-- Part A (TRACES-generated) carries quarterly TDS in a stable
-- table. Part B varies a lot across employers — the parser is
-- best-effort and we always allow manual edits.
--
-- sourceKind:
--   'PDF'    — uploaded TRACES-generated PDF, parsed by upload route
--   'MANUAL' — user-entered without a source PDF
--
-- Multi-tenant: user_id NOT NULL REFERENCES user(id) ON DELETE CASCADE.
-- Note the auth.js adapter uses singular table name `user` (not
-- `users`); the matching Drizzle reference is `users` (the exported
-- name in src/db/schema.ts) → `user(id)` at the DB level.

CREATE TABLE form_16_uploads (
  id serial PRIMARY KEY,
  fy text NOT NULL,
  employer_name text NOT NULL,
  employer_tan text NOT NULL,
  uploaded_at timestamp DEFAULT NOW(),
  source_filename text,
  source_kind text NOT NULL,

  -- Part B headline numbers (paisa)
  gross_salary_paisa bigint DEFAULT 0,
  exempt_allowances_paisa bigint DEFAULT 0,
  standard_deduction_paisa bigint DEFAULT 0,
  professional_tax_paisa bigint DEFAULT 0,
  taxable_salary_paisa bigint DEFAULT 0,

  -- Part A — TDS by quarter
  total_tds_paisa bigint DEFAULT 0,
  quarterly_tds_q1_paisa bigint DEFAULT 0,
  quarterly_tds_q2_paisa bigint DEFAULT 0,
  quarterly_tds_q3_paisa bigint DEFAULT 0,
  quarterly_tds_q4_paisa bigint DEFAULT 0,

  -- Diagnostic
  raw_text text,
  notes text,

  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);

CREATE INDEX form_16_uploads_fy_idx ON form_16_uploads(user_id, fy);
CREATE INDEX form_16_uploads_employer_idx ON form_16_uploads(user_id, employer_tan);
CREATE INDEX form_16_uploads_user_id_idx ON form_16_uploads(user_id);
