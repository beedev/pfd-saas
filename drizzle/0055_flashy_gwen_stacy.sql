CREATE TABLE "agent_news" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"guid" text NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"summary" text,
	"published_at" timestamp,
	"symbols" jsonb,
	"sentiment" text,
	"sentiment_score" real,
	"relevance" real,
	"llm_done" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_news_guid_idx" ON "agent_news" USING btree ("guid");--> statement-breakpoint
CREATE INDEX "agent_news_published_idx" ON "agent_news" USING btree ("published_at");