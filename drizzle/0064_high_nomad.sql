CREATE TABLE "agent_daily_picks" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"pick_date" text NOT NULL,
	"symbol" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"horizon" text NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"recommended" text DEFAULT '' NOT NULL,
	"report_json" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "agent_daily_picks" ADD CONSTRAINT "agent_daily_picks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_daily_picks_user_date_idx" ON "agent_daily_picks" USING btree ("user_id","pick_date");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_daily_picks_unique_idx" ON "agent_daily_picks" USING btree ("user_id","pick_date","symbol");