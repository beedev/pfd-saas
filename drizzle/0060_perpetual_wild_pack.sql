CREATE TABLE "agent_llm_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"task" text NOT NULL,
	"model" text NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micro_usd" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "agent_llm_usage_created_idx" ON "agent_llm_usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "agent_llm_usage_task_idx" ON "agent_llm_usage" USING btree ("task");