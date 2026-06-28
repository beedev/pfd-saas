CREATE TABLE "agent_decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"portfolio_id" integer NOT NULL,
	"run_id" integer NOT NULL,
	"signal_id" integer,
	"action" text NOT NULL,
	"asset_class" text NOT NULL,
	"symbol" text NOT NULL,
	"name" text NOT NULL,
	"quantity" real,
	"price_paisa" bigint,
	"amount_paisa" bigint,
	"confidence" text,
	"rationale" text,
	"executed" boolean DEFAULT false NOT NULL,
	"trade_id" integer,
	"created_at" timestamp DEFAULT now(),
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_portfolios" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text DEFAULT 'Paper Portfolio' NOT NULL,
	"mode" text DEFAULT 'PAPER' NOT NULL,
	"starting_capital_paisa" bigint DEFAULT 100000000 NOT NULL,
	"cash_balance_paisa" bigint DEFAULT 100000000 NOT NULL,
	"benchmark_symbol" text DEFAULT '^NSEI' NOT NULL,
	"risk_profile" text DEFAULT 'BALANCED' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"telegram_enabled" boolean DEFAULT true NOT NULL,
	"max_positions" integer DEFAULT 12 NOT NULL,
	"per_position_pct" real DEFAULT 8 NOT NULL,
	"cash_buffer_pct" real DEFAULT 10 NOT NULL,
	"last_run_date" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"portfolio_id" integer NOT NULL,
	"watchlist_id" integer,
	"asset_class" text NOT NULL,
	"symbol" text DEFAULT '' NOT NULL,
	"scheme_code" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"side" text DEFAULT 'LONG' NOT NULL,
	"quantity" real NOT NULL,
	"contract_multiplier" real DEFAULT 1 NOT NULL,
	"avg_price_paisa" bigint NOT NULL,
	"last_price_paisa" bigint,
	"market_value_paisa" bigint,
	"unrealized_pnl_paisa" bigint,
	"opened_date" text NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"portfolio_id" integer NOT NULL,
	"run_date" text NOT NULL,
	"status" text DEFAULT 'RUNNING' NOT NULL,
	"started_at" timestamp DEFAULT now(),
	"finished_at" timestamp,
	"quotes_fetched" integer DEFAULT 0 NOT NULL,
	"signals_computed" integer DEFAULT 0 NOT NULL,
	"trades_executed" integer DEFAULT 0 NOT NULL,
	"equity_value_paisa" bigint,
	"benchmark_value_paisa" bigint,
	"digest_text" text,
	"error" text,
	"created_at" timestamp DEFAULT now(),
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_signals" (
	"id" serial PRIMARY KEY NOT NULL,
	"portfolio_id" integer NOT NULL,
	"run_id" integer NOT NULL,
	"run_date" text NOT NULL,
	"asset_class" text NOT NULL,
	"symbol" text NOT NULL,
	"name" text NOT NULL,
	"last_price_paisa" bigint,
	"score" real DEFAULT 0 NOT NULL,
	"recommendation" text DEFAULT 'HOLD' NOT NULL,
	"signals_json" jsonb,
	"created_at" timestamp DEFAULT now(),
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"portfolio_id" integer NOT NULL,
	"decision_id" integer,
	"run_id" integer,
	"type" text NOT NULL,
	"asset_class" text NOT NULL,
	"symbol" text DEFAULT '' NOT NULL,
	"scheme_code" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"side" text DEFAULT 'LONG' NOT NULL,
	"quantity" real NOT NULL,
	"contract_multiplier" real DEFAULT 1 NOT NULL,
	"price_per_unit_paisa" bigint NOT NULL,
	"gross_amount_paisa" bigint NOT NULL,
	"fees_paisa" bigint DEFAULT 0 NOT NULL,
	"net_amount_paisa" bigint NOT NULL,
	"status" text DEFAULT 'FILLED' NOT NULL,
	"trade_date" text NOT NULL,
	"fill_date" text,
	"applicable_nav_date" text,
	"realized_pnl_paisa" bigint,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_watchlist" (
	"id" serial PRIMARY KEY NOT NULL,
	"portfolio_id" integer NOT NULL,
	"asset_class" text NOT NULL,
	"symbol" text DEFAULT '' NOT NULL,
	"scheme_code" text DEFAULT '' NOT NULL,
	"isin" text,
	"name" text NOT NULL,
	"contract_multiplier" real DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"user_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_decisions" ADD CONSTRAINT "agent_decisions_portfolio_id_agent_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."agent_portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_decisions" ADD CONSTRAINT "agent_decisions_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_decisions" ADD CONSTRAINT "agent_decisions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_portfolios" ADD CONSTRAINT "agent_portfolios_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_positions" ADD CONSTRAINT "agent_positions_portfolio_id_agent_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."agent_portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_positions" ADD CONSTRAINT "agent_positions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_portfolio_id_agent_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."agent_portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_signals" ADD CONSTRAINT "agent_signals_portfolio_id_agent_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."agent_portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_signals" ADD CONSTRAINT "agent_signals_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_signals" ADD CONSTRAINT "agent_signals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_trades" ADD CONSTRAINT "agent_trades_portfolio_id_agent_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."agent_portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_trades" ADD CONSTRAINT "agent_trades_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_watchlist" ADD CONSTRAINT "agent_watchlist_portfolio_id_agent_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."agent_portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_watchlist" ADD CONSTRAINT "agent_watchlist_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_decisions_user_run_idx" ON "agent_decisions" USING btree ("user_id","run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_portfolios_user_id_idx" ON "agent_portfolios" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_positions_user_id_idx" ON "agent_positions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_positions_unique_idx" ON "agent_positions" USING btree ("portfolio_id","asset_class","symbol");--> statement-breakpoint
CREATE INDEX "agent_runs_user_id_idx" ON "agent_runs" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runs_user_date_idx" ON "agent_runs" USING btree ("user_id","run_date");--> statement-breakpoint
CREATE INDEX "agent_signals_user_date_idx" ON "agent_signals" USING btree ("user_id","run_date");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_signals_run_symbol_idx" ON "agent_signals" USING btree ("run_id","symbol");--> statement-breakpoint
CREATE INDEX "agent_trades_user_id_idx" ON "agent_trades" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_trades_portfolio_idx" ON "agent_trades" USING btree ("user_id","portfolio_id");--> statement-breakpoint
CREATE INDEX "agent_trades_date_idx" ON "agent_trades" USING btree ("trade_date");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_trades_one_pending_idx" ON "agent_trades" USING btree ("portfolio_id","symbol","scheme_code") WHERE status = 'PENDING';--> statement-breakpoint
CREATE INDEX "agent_watchlist_user_id_idx" ON "agent_watchlist" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_watchlist_unique_idx" ON "agent_watchlist" USING btree ("user_id","asset_class","symbol","scheme_code");