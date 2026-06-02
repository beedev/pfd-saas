-- Sprint 5.10a — Forex deposits asset class.
--
-- New asset table for foreign-currency holdings (NRE FX accounts, multi-
-- currency wallets, foreign FDs, GIFT-City balances). Amounts are stored
-- in the foreign currency as numeric(18,4) — NOT paisa — because the
-- "paisa rule" only applies to INR. Conversion to INR happens at read
-- time via the live FX rate service (Sprint 5.10b).
--
-- Multi-tenant: user_id is NOT NULL with cascade. Indexed on user_id
-- and (user_id, status) for the dashboard tiles + list-page filters.

CREATE TABLE forex_deposits (
  id serial PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  bank_name text NOT NULL,
  account_number text,
  currency_code text NOT NULL,
  amount_in_currency numeric(18,4) NOT NULL,
  interest_rate real,
  opening_date text NOT NULL,
  maturity_date text,
  status text DEFAULT 'ACTIVE' NOT NULL CHECK (status IN ('ACTIVE','MATURED','CLOSED')),
  notes text,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);
CREATE INDEX forex_deposits_user_id_idx ON forex_deposits(user_id);
CREATE INDEX forex_deposits_user_status_idx ON forex_deposits(user_id, status);
