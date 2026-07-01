CREATE TABLE "agent_eod_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"review_date" text NOT NULL,
	"movers_json" jsonb,
	"phrases_minted" integer DEFAULT 0 NOT NULL,
	"phrases_updated" integer DEFAULT 0 NOT NULL,
	"coverage_gaps_json" jsonb,
	"summary" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agent_news_signal_tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"news_id" integer NOT NULL,
	"phrase_id" integer NOT NULL,
	"symbol" text NOT NULL,
	"direction" text NOT NULL,
	"tagged_date" text NOT NULL,
	"outcome" text DEFAULT 'PENDING' NOT NULL,
	"move_pct" real,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agent_signal_phrases" (
	"id" serial PRIMARY KEY NOT NULL,
	"phrase" text NOT NULL,
	"direction" text DEFAULT 'BULLISH' NOT NULL,
	"description" text,
	"status" text DEFAULT 'MONITORING' NOT NULL,
	"alpha" real DEFAULT 1 NOT NULL,
	"beta" real DEFAULT 1 NOT NULL,
	"observed_days" integer DEFAULT 0 NOT NULL,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"appear_count" integer DEFAULT 0 NOT NULL,
	"examples_json" jsonb,
	"active" boolean DEFAULT true NOT NULL,
	"first_seen" text,
	"last_updated" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "agent_news_signal_tags" ADD CONSTRAINT "agent_news_signal_tags_news_id_agent_news_id_fk" FOREIGN KEY ("news_id") REFERENCES "public"."agent_news"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_news_signal_tags" ADD CONSTRAINT "agent_news_signal_tags_phrase_id_agent_signal_phrases_id_fk" FOREIGN KEY ("phrase_id") REFERENCES "public"."agent_signal_phrases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_eod_reviews_date_idx" ON "agent_eod_reviews" USING btree ("review_date");--> statement-breakpoint
CREATE INDEX "agent_news_signal_tags_date_idx" ON "agent_news_signal_tags" USING btree ("tagged_date");--> statement-breakpoint
CREATE INDEX "agent_news_signal_tags_phrase_idx" ON "agent_news_signal_tags" USING btree ("phrase_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_news_signal_tags_unique_idx" ON "agent_news_signal_tags" USING btree ("news_id","phrase_id","symbol");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_signal_phrases_phrase_idx" ON "agent_signal_phrases" USING btree ("phrase");--> statement-breakpoint
CREATE INDEX "agent_signal_phrases_status_idx" ON "agent_signal_phrases" USING btree ("status");
--> statement-breakpoint
ALTER TABLE "agent_news" ADD COLUMN "signal_tagged" boolean DEFAULT false NOT NULL;