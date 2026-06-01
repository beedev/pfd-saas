ALTER TABLE "user_preferences" ADD COLUMN "telegram_chat_id" text;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "telegram_username" text;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "telegram_connect_token" text;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "telegram_connect_token_expires_at" timestamp;