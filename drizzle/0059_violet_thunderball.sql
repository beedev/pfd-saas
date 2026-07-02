-- signal_tagged already shipped with the amended 0058; keep idempotent here.
ALTER TABLE "agent_news" ADD COLUMN IF NOT EXISTS "signal_tagged" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_positions" ADD COLUMN IF NOT EXISTS "stop_paisa" bigint;--> statement-breakpoint
ALTER TABLE "agent_positions" ADD COLUMN IF NOT EXISTS "target_paisa" bigint;
