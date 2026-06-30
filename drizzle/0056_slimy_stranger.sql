CREATE TABLE "agent_daily_brief" (
	"id" serial PRIMARY KEY NOT NULL,
	"brief_date" text NOT NULL,
	"symbol" text NOT NULL,
	"bias" text NOT NULL,
	"impact" real,
	"rationale" text,
	"headline_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_brief_date_symbol_idx" ON "agent_daily_brief" USING btree ("brief_date","symbol");--> statement-breakpoint
CREATE INDEX "agent_brief_date_idx" ON "agent_daily_brief" USING btree ("brief_date");