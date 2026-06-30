CREATE TABLE "agent_param_experiments" (
	"id" serial PRIMARY KEY NOT NULL,
	"sleeve_id" integer NOT NULL,
	"run_date" text NOT NULL,
	"window_from" text,
	"window_to" text,
	"sessions" integer DEFAULT 0 NOT NULL,
	"champion_params" jsonb,
	"champion_metrics" jsonb,
	"challenger_params" jsonb,
	"challenger_metrics" jsonb,
	"decision" text DEFAULT 'PROPOSED' NOT NULL,
	"reason" text,
	"llm_rationale" text,
	"created_at" timestamp DEFAULT now(),
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_param_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"sleeve_id" integer NOT NULL,
	"experiment_id" integer,
	"from_params" jsonb,
	"to_params" jsonb,
	"trigger_metrics" jsonb,
	"baseline_metrics" jsonb,
	"promoted_at" timestamp DEFAULT now(),
	"rolled_back" boolean DEFAULT false NOT NULL,
	"rolled_back_at" timestamp,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_session_bars" (
	"id" serial PRIMARY KEY NOT NULL,
	"sleeve_id" integer NOT NULL,
	"run_date" text NOT NULL,
	"symbol" text NOT NULL,
	"bars_json" jsonb NOT NULL,
	"bias" text,
	"created_at" timestamp DEFAULT now(),
	"user_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_sleeves" ADD COLUMN "tuning_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_sleeves" ADD COLUMN "tuning_auto_promote" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_param_experiments" ADD CONSTRAINT "agent_param_experiments_sleeve_id_agent_sleeves_id_fk" FOREIGN KEY ("sleeve_id") REFERENCES "public"."agent_sleeves"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_param_experiments" ADD CONSTRAINT "agent_param_experiments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_param_history" ADD CONSTRAINT "agent_param_history_sleeve_id_agent_sleeves_id_fk" FOREIGN KEY ("sleeve_id") REFERENCES "public"."agent_sleeves"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_param_history" ADD CONSTRAINT "agent_param_history_experiment_id_agent_param_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."agent_param_experiments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_param_history" ADD CONSTRAINT "agent_param_history_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session_bars" ADD CONSTRAINT "agent_session_bars_sleeve_id_agent_sleeves_id_fk" FOREIGN KEY ("sleeve_id") REFERENCES "public"."agent_sleeves"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session_bars" ADD CONSTRAINT "agent_session_bars_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_param_experiments_user_id_idx" ON "agent_param_experiments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_param_experiments_sleeve_date_idx" ON "agent_param_experiments" USING btree ("sleeve_id","run_date");--> statement-breakpoint
CREATE INDEX "agent_param_history_user_id_idx" ON "agent_param_history" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_param_history_sleeve_idx" ON "agent_param_history" USING btree ("sleeve_id");--> statement-breakpoint
CREATE INDEX "agent_session_bars_user_id_idx" ON "agent_session_bars" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_session_bars_sleeve_date_idx" ON "agent_session_bars" USING btree ("sleeve_id","run_date");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_session_bars_unique_idx" ON "agent_session_bars" USING btree ("sleeve_id","run_date","symbol");