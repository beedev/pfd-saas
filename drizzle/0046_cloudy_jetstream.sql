CREATE UNIQUE INDEX IF NOT EXISTS "user_preferences_telegram_chat_unique" ON "user_preferences" USING btree ("telegram_chat_id") WHERE "user_preferences"."telegram_chat_id" IS NOT NULL;
