CREATE TABLE "tax_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"fy" text NOT NULL,
	"eighty_c_cap_paisa" bigint DEFAULT 15000000 NOT NULL,
	"eighty_ccd_1b_cap_paisa" bigint DEFAULT 5000000 NOT NULL,
	"eighty_d_base_cap_paisa" bigint DEFAULT 2500000 NOT NULL,
	"eighty_d_senior_cap_paisa" bigint DEFAULT 5000000 NOT NULL,
	"sec_24b_self_occupied_cap_paisa" bigint DEFAULT 20000000 NOT NULL,
	"sec_24b_pre1999_cap_paisa" bigint DEFAULT 3000000 NOT NULL,
	"sec_80eea_cap_paisa" bigint DEFAULT 15000000 NOT NULL,
	"surcharge_old_brackets" jsonb,
	"surcharge_new_brackets" jsonb,
	"capital_gains_rules" jsonb,
	"presumptive_rules" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tax_rules_fy_unique" ON "tax_rules" USING btree ("fy");