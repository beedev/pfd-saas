CREATE TABLE "agent_sleeve_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"sleeve_id" integer NOT NULL,
	"snapshot_date" text NOT NULL,
	"corpus_paisa" bigint NOT NULL,
	"opening_paisa" bigint NOT NULL,
	"cash_paisa" bigint NOT NULL,
	"positions_value_paisa" bigint DEFAULT 0 NOT NULL,
	"equity_paisa" bigint NOT NULL,
	"daily_realized_paisa" bigint DEFAULT 0 NOT NULL,
	"daily_unrealized_paisa" bigint DEFAULT 0 NOT NULL,
	"daily_pnl_paisa" bigint DEFAULT 0 NOT NULL,
	"overall_pnl_paisa" bigint DEFAULT 0 NOT NULL,
	"open_positions" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "agent_sleeve_snapshots" ADD CONSTRAINT "agent_sleeve_snapshots_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_sleeve_snapshots" ADD CONSTRAINT "agent_sleeve_snapshots_sleeve_id_agent_sleeves_id_fk" FOREIGN KEY ("sleeve_id") REFERENCES "public"."agent_sleeves"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_sleeve_snap_unique_idx" ON "agent_sleeve_snapshots" USING btree ("sleeve_id","snapshot_date");