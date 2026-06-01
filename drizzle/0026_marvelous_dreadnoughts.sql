CREATE TABLE "cost_inflation_index" (
	"fy" text PRIMARY KEY NOT NULL,
	"index_value" real NOT NULL,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "tax_deductions" ADD COLUMN "eighty_g_category" text;--> statement-breakpoint
ALTER TABLE "tax_deductions" ADD COLUMN "eighty_d_bucket" text;--> statement-breakpoint
ALTER TABLE "tax_deductions" ADD CONSTRAINT "tax_deductions_eighty_g_category_check" CHECK ("eighty_g_category" IS NULL OR "eighty_g_category" IN ('50_NO_LIMIT','100_NO_LIMIT','50_WITH_LIMIT','100_WITH_LIMIT'));--> statement-breakpoint
ALTER TABLE "tax_deductions" ADD CONSTRAINT "tax_deductions_eighty_d_bucket_check" CHECK ("eighty_d_bucket" IS NULL OR "eighty_d_bucket" IN ('SELF_FAMILY','PARENTS'));--> statement-breakpoint
-- Sprint 5.1c — Seed Cost Inflation Index table.
-- Source: CBDT Notifications. Base FY 2001-02 = 100.
-- These are govt-published public values; safe to seed in migration.
INSERT INTO "cost_inflation_index" ("fy", "index_value", "notes") VALUES
  ('2001-02', 100, 'Base year'),
  ('2002-03', 105, NULL),
  ('2003-04', 109, NULL),
  ('2004-05', 113, NULL),
  ('2005-06', 117, NULL),
  ('2006-07', 122, NULL),
  ('2007-08', 129, NULL),
  ('2008-09', 137, NULL),
  ('2009-10', 148, NULL),
  ('2010-11', 167, NULL),
  ('2011-12', 184, NULL),
  ('2012-13', 200, NULL),
  ('2013-14', 220, NULL),
  ('2014-15', 240, NULL),
  ('2015-16', 254, NULL),
  ('2016-17', 264, NULL),
  ('2017-18', 272, NULL),
  ('2018-19', 280, NULL),
  ('2019-20', 289, NULL),
  ('2020-21', 301, NULL),
  ('2021-22', 317, NULL),
  ('2022-23', 331, NULL),
  ('2023-24', 348, NULL),
  ('2024-25', 363, NULL),
  ('2025-26', 376, NULL)
ON CONFLICT ("fy") DO NOTHING;
