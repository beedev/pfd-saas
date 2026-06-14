CREATE TABLE "assistant_api_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"capability_id" text NOT NULL,
	"included" boolean DEFAULT true NOT NULL,
	"data_integrity" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "telegram_command_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text,
	"chat_id" text NOT NULL,
	"message_id" bigint,
	"raw_text" text,
	"route" text,
	"capability_id" text,
	"args" jsonb,
	"confirmed" boolean DEFAULT false,
	"executed" boolean DEFAULT false,
	"result_status" text,
	"result_summary" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "telegram_conversations" (
	"chat_id" text PRIMARY KEY NOT NULL,
	"pending_capability" text,
	"collected_args" jsonb,
	"awaiting" text,
	"pending_id" text,
	"source_message_id" bigint,
	"expires_at" timestamp,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "telegram_inbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"update_id" bigint NOT NULL,
	"chat_id" text NOT NULL,
	"message_id" bigint,
	"from_username" text,
	"text" text,
	"received_at" timestamp DEFAULT now(),
	"status" text DEFAULT 'pending' NOT NULL,
	"processed_at" timestamp,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "telegram_outbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"kind" text DEFAULT 'reply' NOT NULL,
	"text" text NOT NULL,
	"reply_markup" jsonb,
	"created_at" timestamp DEFAULT now(),
	"status" text DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "assistant_api_settings" ADD CONSTRAINT "assistant_api_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_command_log" ADD CONSTRAINT "telegram_command_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_api_settings_user_cap_unique" ON "assistant_api_settings" USING btree ("user_id","capability_id");--> statement-breakpoint
CREATE INDEX "telegram_command_log_user_idx" ON "telegram_command_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "telegram_command_log_dedupe_idx" ON "telegram_command_log" USING btree ("message_id","capability_id");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_inbox_update_id_unique" ON "telegram_inbox" USING btree ("update_id");--> statement-breakpoint
CREATE INDEX "telegram_inbox_status_idx" ON "telegram_inbox" USING btree ("status");--> statement-breakpoint
CREATE INDEX "telegram_outbox_status_idx" ON "telegram_outbox" USING btree ("status");