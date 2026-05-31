CREATE TABLE "scheduled_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"job_type" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp NOT NULL,
	"last_run_at" timestamp,
	"last_run_status" text,
	"last_run_error" text,
	"run_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "scheduled_jobs" ADD CONSTRAINT "scheduled_jobs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheduled_jobs_user_id_idx" ON "scheduled_jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "scheduled_jobs_next_run_idx" ON "scheduled_jobs" USING btree ("next_run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_jobs_user_job_unique" ON "scheduled_jobs" USING btree ("user_id","job_type");--> statement-breakpoint
-- Bootstrap: every existing user gets the three default cron jobs.
-- next_run_at = NOW() makes them all due immediately on the first tick;
-- the lib modules then bump next_run_at forward per their own schedule.
-- Idempotent via ON CONFLICT (user_id, job_type).
INSERT INTO "scheduled_jobs" ("user_id", "job_type", "enabled", "next_run_at")
SELECT u."id", j.job_type, true, NOW()
FROM "user" u
CROSS JOIN (VALUES ('daily_digest'), ('alerts_check'), ('sip_auto_execute')) AS j(job_type)
ON CONFLICT ("user_id", "job_type") DO NOTHING;