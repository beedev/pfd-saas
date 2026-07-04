CREATE TABLE "agent_user_strategies" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"source_nl" text DEFAULT '' NOT NULL,
	"spec_json" jsonb NOT NULL,
	"validation_json" jsonb,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "agent_user_strategies" ADD CONSTRAINT "agent_user_strategies_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_user_strategies_user_id_idx" ON "agent_user_strategies" USING btree ("user_id");