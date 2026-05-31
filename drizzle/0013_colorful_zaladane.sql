CREATE TABLE "cashflow_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" integer,
	"start_date" text NOT NULL,
	"end_date" text,
	"amount_paisa" bigint NOT NULL,
	"frequency" text NOT NULL,
	"growth_pct_per_year" real DEFAULT 0 NOT NULL,
	"tax_treatment" text DEFAULT 'TAXABLE' NOT NULL,
	"goal_id" integer,
	"auto_derived" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"user_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cashflow_events" ADD CONSTRAINT "cashflow_events_goal_id_financial_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."financial_goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashflow_events" ADD CONSTRAINT "cashflow_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cashflow_events_user_id_idx" ON "cashflow_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "cashflow_events_kind_idx" ON "cashflow_events" USING btree ("source_kind");--> statement-breakpoint
CREATE INDEX "cashflow_events_date_idx" ON "cashflow_events" USING btree ("start_date");--> statement-breakpoint
CREATE INDEX "cashflow_events_goal_idx" ON "cashflow_events" USING btree ("goal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cashflow_events_derive_unique" ON "cashflow_events" USING btree ("user_id","source_kind","source_id");