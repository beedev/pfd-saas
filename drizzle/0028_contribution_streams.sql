-- Sprint 5.5a — Contribution-aware retirement projections.
--
-- Adds monthly/periodic contribution columns to NPS, EPF and Small
-- Savings accounts. The cashflow derivation layer and retirement assets
-- engine project forward using current balance + ongoing contributions
-- at the per-class growth rate (asset_class_returns) instead of just
-- carrying the current balance through to retirement.

ALTER TABLE "nps_accounts"
  ADD COLUMN "monthly_contribution_paisa" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint

ALTER TABLE "epf_accounts"
  ADD COLUMN "monthly_contribution_paisa" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint

ALTER TABLE "small_savings_accounts"
  ADD COLUMN "periodic_contribution_paisa" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint

ALTER TABLE "small_savings_accounts"
  ADD COLUMN "contribution_frequency" text DEFAULT 'MONTHLY' NOT NULL;
--> statement-breakpoint

ALTER TABLE "small_savings_accounts"
  ADD CONSTRAINT "small_savings_contribution_freq_check"
  CHECK ("contribution_frequency" IN ('MONTHLY', 'YEARLY'));
