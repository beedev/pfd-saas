CREATE TABLE "agent_delivery_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"trade_date" text NOT NULL,
	"symbol" text NOT NULL,
	"delivery_pct" real NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_delivery_hist_unique_idx" ON "agent_delivery_history" USING btree ("trade_date","symbol");--> statement-breakpoint
CREATE INDEX "agent_delivery_hist_symbol_idx" ON "agent_delivery_history" USING btree ("symbol");