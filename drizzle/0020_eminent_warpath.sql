CREATE TABLE "tax_regime_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"fy" text NOT NULL,
	"regime" text NOT NULL,
	"standard_deduction_paisa" bigint NOT NULL,
	"rebate_87a_threshold_paisa" bigint NOT NULL,
	"rebate_87a_max_paisa" bigint NOT NULL,
	"cess_pct" real DEFAULT 4 NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tax_slabs" (
	"id" serial PRIMARY KEY NOT NULL,
	"fy" text NOT NULL,
	"regime" text NOT NULL,
	"slab_order" integer NOT NULL,
	"lower_paisa" bigint NOT NULL,
	"upper_paisa" bigint,
	"rate_pct" real NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "tax_regime_default" text DEFAULT 'NEW' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "tax_regime_config_fy_regime_unique" ON "tax_regime_config" USING btree ("fy","regime");--> statement-breakpoint
CREATE INDEX "tax_slabs_fy_regime_idx" ON "tax_slabs" USING btree ("fy","regime");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_slabs_fy_regime_order_unique" ON "tax_slabs" USING btree ("fy","regime","slab_order");--> statement-breakpoint
-- Seed FY 2025-26 + 2026-27 slabs for both regimes. Govt-published
-- rates as of FY 2025-26 (Union Budget 2025); FY 2026-27 reuses the
-- same brackets until govt publishes new ones.
--
-- NEW regime (post-Budget 2025):
--   0–4L      0%
--   4–8L      5%
--   8–12L    10%
--   12–16L   15%
--   16–20L   20%
--   20–24L   25%
--   24L+     30%
-- Standard deduction: ₹75,000. 87A rebate up to ₹60,000 when income ≤ ₹12L.
INSERT INTO "tax_slabs" (fy, regime, slab_order, lower_paisa, upper_paisa, rate_pct) VALUES
  ('2025-26', 'NEW', 0,         0,  40000000, 0),
  ('2025-26', 'NEW', 1,  40000000,  80000000, 5),
  ('2025-26', 'NEW', 2,  80000000, 120000000, 10),
  ('2025-26', 'NEW', 3, 120000000, 160000000, 15),
  ('2025-26', 'NEW', 4, 160000000, 200000000, 20),
  ('2025-26', 'NEW', 5, 200000000, 240000000, 25),
  ('2025-26', 'NEW', 6, 240000000, NULL, 30),
  ('2026-27', 'NEW', 0,         0,  40000000, 0),
  ('2026-27', 'NEW', 1,  40000000,  80000000, 5),
  ('2026-27', 'NEW', 2,  80000000, 120000000, 10),
  ('2026-27', 'NEW', 3, 120000000, 160000000, 15),
  ('2026-27', 'NEW', 4, 160000000, 200000000, 20),
  ('2026-27', 'NEW', 5, 200000000, 240000000, 25),
  ('2026-27', 'NEW', 6, 240000000, NULL, 30);
--> statement-breakpoint
-- OLD regime (unchanged from FY 2023-24):
--   0–2.5L    0%
--   2.5–5L    5%
--   5–10L    20%
--   10L+     30%
-- Standard deduction: ₹50,000. 87A rebate up to ₹12,500 when income ≤ ₹5L.
INSERT INTO "tax_slabs" (fy, regime, slab_order, lower_paisa, upper_paisa, rate_pct) VALUES
  ('2025-26', 'OLD', 0,         0,  25000000, 0),
  ('2025-26', 'OLD', 1,  25000000,  50000000, 5),
  ('2025-26', 'OLD', 2,  50000000, 100000000, 20),
  ('2025-26', 'OLD', 3, 100000000, NULL, 30),
  ('2026-27', 'OLD', 0,         0,  25000000, 0),
  ('2026-27', 'OLD', 1,  25000000,  50000000, 5),
  ('2026-27', 'OLD', 2,  50000000, 100000000, 20),
  ('2026-27', 'OLD', 3, 100000000, NULL, 30);
--> statement-breakpoint
-- Regime config (std deduction, 87A rebate, cess). Cess is 4% for both
-- regimes in current law.
INSERT INTO "tax_regime_config" (fy, regime, standard_deduction_paisa, rebate_87a_threshold_paisa, rebate_87a_max_paisa, cess_pct) VALUES
  ('2025-26', 'NEW',  7500000, 120000000,  6000000, 4),
  ('2025-26', 'OLD',  5000000,  50000000,  1250000, 4),
  ('2026-27', 'NEW',  7500000, 120000000,  6000000, 4),
  ('2026-27', 'OLD',  5000000,  50000000,  1250000, 4);