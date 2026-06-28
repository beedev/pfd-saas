CREATE TABLE "agent_sleeves" (
	"id" serial PRIMARY KEY NOT NULL,
	"portfolio_id" integer NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"strategy" text NOT NULL,
	"allocation_paisa" bigint NOT NULL,
	"cash_balance_paisa" bigint NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"cadence" text DEFAULT 'DAILY_OPEN' NOT NULL,
	"params_json" jsonb,
	"last_run_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"user_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_decisions" ADD COLUMN "sleeve_id" integer;--> statement-breakpoint
ALTER TABLE "agent_decisions" ADD COLUMN "evidence_json" jsonb;--> statement-breakpoint
ALTER TABLE "agent_positions" ADD COLUMN "sleeve_id" integer;--> statement-breakpoint
ALTER TABLE "agent_signals" ADD COLUMN "sleeve_id" integer;--> statement-breakpoint
ALTER TABLE "agent_signals" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "agent_signals" ADD COLUMN "data_as_of" timestamp;--> statement-breakpoint
ALTER TABLE "agent_trades" ADD COLUMN "sleeve_id" integer;--> statement-breakpoint
ALTER TABLE "agent_watchlist" ADD COLUMN "sleeve_id" integer;--> statement-breakpoint
ALTER TABLE "agent_sleeves" ADD CONSTRAINT "agent_sleeves_portfolio_id_agent_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."agent_portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_sleeves" ADD CONSTRAINT "agent_sleeves_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_sleeves_user_id_idx" ON "agent_sleeves" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_sleeves_portfolio_key_idx" ON "agent_sleeves" USING btree ("portfolio_id","key");--> statement-breakpoint
ALTER TABLE "agent_decisions" ADD CONSTRAINT "agent_decisions_sleeve_id_agent_sleeves_id_fk" FOREIGN KEY ("sleeve_id") REFERENCES "public"."agent_sleeves"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_positions" ADD CONSTRAINT "agent_positions_sleeve_id_agent_sleeves_id_fk" FOREIGN KEY ("sleeve_id") REFERENCES "public"."agent_sleeves"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_signals" ADD CONSTRAINT "agent_signals_sleeve_id_agent_sleeves_id_fk" FOREIGN KEY ("sleeve_id") REFERENCES "public"."agent_sleeves"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_trades" ADD CONSTRAINT "agent_trades_sleeve_id_agent_sleeves_id_fk" FOREIGN KEY ("sleeve_id") REFERENCES "public"."agent_sleeves"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_watchlist" ADD CONSTRAINT "agent_watchlist_sleeve_id_agent_sleeves_id_fk" FOREIGN KEY ("sleeve_id") REFERENCES "public"."agent_sleeves"("id") ON DELETE cascade ON UPDATE no action;