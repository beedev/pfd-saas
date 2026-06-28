CREATE TABLE "agent_backtests" (
	"id" serial PRIMARY KEY NOT NULL,
	"portfolio_id" integer,
	"sleeve_id" integer,
	"strategy" text NOT NULL,
	"label" text,
	"from_date" text,
	"to_date" text,
	"params_json" jsonb,
	"universe_json" jsonb,
	"cost_model_json" jsonb,
	"metrics_json" jsonb,
	"equity_curve_json" jsonb,
	"created_at" timestamp DEFAULT now(),
	"user_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_backtests" ADD CONSTRAINT "agent_backtests_portfolio_id_agent_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."agent_portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_backtests" ADD CONSTRAINT "agent_backtests_sleeve_id_agent_sleeves_id_fk" FOREIGN KEY ("sleeve_id") REFERENCES "public"."agent_sleeves"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_backtests" ADD CONSTRAINT "agent_backtests_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_backtests_user_id_idx" ON "agent_backtests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_backtests_sleeve_idx" ON "agent_backtests" USING btree ("sleeve_id");