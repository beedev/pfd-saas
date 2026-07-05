CREATE TABLE "agent_daily_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"snapshot_date" text NOT NULL,
	"equity_paisa" bigint NOT NULL,
	"cash_paisa" bigint NOT NULL,
	"unrealized_paisa" bigint DEFAULT 0,
	"realized_cum_paisa" bigint DEFAULT 0,
	"open_positions" integer DEFAULT 0,
	"closed_trades" integer DEFAULT 0,
	"win_rate_pct" real DEFAULT 0,
	"peak_equity_paisa" bigint,
	"drawdown_pct" real DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agent_run_health" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"run_date" text NOT NULL,
	"status" text NOT NULL,
	"considered" integer DEFAULT 0,
	"picked" integer DEFAULT 0,
	"bhav_rows" integer DEFAULT 0,
	"screen_count" integer DEFAULT 0,
	"announcement_count" integer DEFAULT 0,
	"quotes_ok" boolean DEFAULT false,
	"note" text DEFAULT '',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "agent_daily_snapshots" ADD CONSTRAINT "agent_daily_snapshots_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run_health" ADD CONSTRAINT "agent_run_health_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_daily_snap_unique_idx" ON "agent_daily_snapshots" USING btree ("user_id","snapshot_date");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_run_health_unique_idx" ON "agent_run_health" USING btree ("user_id","run_date");