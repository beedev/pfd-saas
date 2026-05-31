/**
 * POST /api/cron/tick — Sprint 2 Phase 5 dispatcher.
 *
 * Called by external cron (Vercel Cron in Sprint 6; curl + cron.weekly
 * for now). Selects all `scheduled_jobs` rows where enabled = true AND
 * next_run_at <= NOW(), dispatches each to its lib module, then updates
 * the row's last_run_* and bumps next_run_at forward.
 *
 * Auth: shared secret in `Authorization: Bearer <CRON_SECRET>`. NOT
 * tied to any user — this endpoint runs FOR every user. The proxy
 * middleware allows /api/cron/tick through because the bearer-secret
 * check below is the actual gate.
 *
 * Each job advance schedule for MVP (Sprint 7+ adds per-user override):
 *   daily_digest      → +24 hours
 *   alerts_check      → +5 minutes
 *   sip_auto_execute  → +24 hours
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { db, scheduledJobs, type JobType } from '@/db';
import { runSipAutoExecute } from '@/lib/cron/sip-auto-execute';
import { runAlertsCheck } from '@/lib/cron/alerts-check';
import { runDailyDigestJob } from '@/lib/cron/daily-digest';

const CRON_SECRET = process.env.CRON_SECRET ?? '';

const ADVANCE_MS: Record<JobType, number> = {
  daily_digest: 24 * 60 * 60 * 1000,
  alerts_check: 5 * 60 * 1000,
  sip_auto_execute: 24 * 60 * 60 * 1000,
};

interface JobReport {
  userId: string;
  jobType: JobType;
  status: 'success' | 'failed';
  durationMs: number;
  result?: unknown;
  error?: string;
}

export async function POST(request: NextRequest) {
  if (!CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  const auth = request.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Compare in DB-time. The migration's NOW() wrote next_run_at as
  // wall-clock IST (timestamp without timezone). A JS Date sent through
  // postgres-js serialises to UTC, so a JS-side `<=` comparison fails
  // even when rows are clearly due in DB-time. Letting Postgres' own
  // NOW() do the comparison keeps both sides in the same frame.
  // TODO: migrate every timestamp column to `timestamptz` to remove
  // this entire class of bug (~80 columns, deferred to a later sprint).
  const due = await db
    .select()
    .from(scheduledJobs)
    .where(
      and(
        eq(scheduledJobs.enabled, true),
        sql`${scheduledJobs.nextRunAt} <= NOW()`,
      ),
    );

  const tickStartedAt = new Date().toISOString();
  if (due.length === 0) {
    return NextResponse.json({ now: tickStartedAt, dispatched: 0, jobs: [] });
  }

  const reports: JobReport[] = [];

  for (const job of due) {
    const start = Date.now();
    const report: JobReport = {
      userId: job.userId,
      jobType: job.jobType,
      status: 'success',
      durationMs: 0,
    };

    try {
      switch (job.jobType) {
        case 'daily_digest':
          report.result = await runDailyDigestJob(job.userId);
          break;
        case 'alerts_check':
          report.result = await runAlertsCheck(job.userId);
          break;
        case 'sip_auto_execute':
          report.result = await runSipAutoExecute(job.userId);
          break;
        default:
          throw new Error(`Unknown job type: ${job.jobType}`);
      }
    } catch (err) {
      report.status = 'failed';
      report.error = err instanceof Error ? err.message : String(err);
      console.error(`[cron/tick] ${job.jobType} for ${job.userId} failed:`, err);
    }

    report.durationMs = Date.now() - start;

    // Update the scheduled_jobs row regardless of success — bump
    // next_run_at so a failing job doesn't immediately re-fire on the
    // very next tick. Sprint 7+ could add an exponential backoff.
    // Compute next_run_at in DB-time (same reason as the WHERE above).
    const advanceMs = ADVANCE_MS[job.jobType] ?? 60 * 60 * 1000;
    await db
      .update(scheduledJobs)
      .set({
        lastRunAt: sql`NOW()`,
        lastRunStatus: report.status,
        lastRunError: report.error ?? null,
        runCount: (job.runCount ?? 0) + 1,
        nextRunAt: sql`NOW() + (${advanceMs}::text || ' milliseconds')::interval`,
        updatedAt: sql`NOW()`,
      })
      .where(eq(scheduledJobs.id, job.id));

    reports.push(report);
  }

  return NextResponse.json({
    now: tickStartedAt,
    dispatched: reports.length,
    jobs: reports,
  });
}
