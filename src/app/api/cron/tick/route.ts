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

import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { db, scheduledJobs, mfRedemptions, type JobType } from '@/db';
import { runSipAutoExecute } from '@/lib/cron/sip-auto-execute';
import { runAlertsCheck } from '@/lib/cron/alerts-check';
import { runDailyDigestJob } from '@/lib/cron/daily-digest';
import { runAgentV2, runAgentIntraday } from '@/lib/cron/agent-run-v2';
import { runNewsIngest } from '@/lib/agent/news/ingest';
import { settlePendingRedemptions } from '@/lib/finance/mf-redeem-worker';

const CRON_SECRET = process.env.CRON_SECRET ?? '';

// Constant-time string compare — avoids leaking the secret's contents
// through response-timing differences. Length check first because
// timingSafeEqual throws on unequal-length buffers.
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

const ADVANCE_MS: Record<JobType, number> = {
  daily_digest: 24 * 60 * 60 * 1000,
  alerts_check: 5 * 60 * 1000,
  sip_auto_execute: 24 * 60 * 60 * 1000,
  agent_daily_run: 24 * 60 * 60 * 1000,
  agent_intraday_run: 30 * 60 * 1000, // every 30 min (no-ops outside market hours)
  agent_news_ingest: 30 * 60 * 1000,  // poll RSS feeds every 30 min
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
  if (!safeCompare(auth, `Bearer ${CRON_SECRET}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Self-heal: ensure every user has the default cron jobs before selecting due
  // ones. A user seeded outside the onboarding flow (e.g. the demo account) would
  // otherwise have NO jobs, so its digests/alerts/SIP pass never run.
  await ensureDefaultJobsForAllUsers();

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

  // Global MF redemption settlement — runs EVERY tick for every user that has a
  // PENDING redemption, independent of scheduled jobs. A redemption must never be
  // orphaned because its owner lacks a sip_auto_execute job (e.g. a seeded/demo
  // account that never went through onboarding). Idempotent: already-settled
  // redemptions are skipped; NAV-not-yet-published ones stay pending.
  const settlement = await settleAllPendingRedemptions();

  if (due.length === 0) {
    return NextResponse.json({ now: tickStartedAt, dispatched: 0, jobs: [], settlement });
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
          // MF redemption settlement is handled by the global pass below (so it
          // runs for every user, not only those with this job).
          report.result = await runSipAutoExecute(job.userId);
          break;
        case 'agent_daily_run':
          // No-ops unless the user has an enabled paper portfolio.
          report.result = await runAgentV2(job.userId);
          break;
        case 'agent_intraday_run':
          // Only the INTRADAY sleeves, only during market hours.
          report.result = await runAgentIntraday(job.userId);
          break;
        case 'agent_news_ingest':
          // Global RSS poll + tag + sentiment (idempotent; dedup by guid).
          report.result = await runNewsIngest();
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
    settlement,
  });
}

/**
 * Idempotently create the default cron jobs for any user missing them. Fixes
 * accounts seeded outside onboarding (demo/seed users), which otherwise have no
 * scheduled jobs at all. next_run_at = NOW() so they fire on this same tick.
 */
async function ensureDefaultJobsForAllUsers(): Promise<void> {
  await db.execute(sql`
    INSERT INTO scheduled_jobs (user_id, job_type, enabled, next_run_at)
    SELECT u.id, j.jt, true, NOW()
    FROM "user" u
    CROSS JOIN (VALUES ('daily_digest'), ('alerts_check'), ('sip_auto_execute'), ('agent_daily_run'), ('agent_intraday_run'), ('agent_news_ingest')) AS j(jt)
    WHERE NOT EXISTS (
      SELECT 1 FROM scheduled_jobs s WHERE s.user_id = u.id AND s.job_type = j.jt
    )
  `);
}

/**
 * Settle PENDING MF redemptions for every user that has one. Decoupled from
 * scheduled jobs so settlement is never gated on a per-user sip_auto_execute row.
 */
async function settleAllPendingRedemptions(): Promise<
  Array<{ userId: string; settled?: number; stillPending?: number; error?: string }>
> {
  const usersWithPending = await db
    .selectDistinct({ userId: mfRedemptions.userId })
    .from(mfRedemptions)
    .where(eq(mfRedemptions.status, 'PENDING'));

  const out: Array<{ userId: string; settled?: number; stillPending?: number; error?: string }> = [];
  for (const { userId } of usersWithPending) {
    try {
      const r = await settlePendingRedemptions(userId);
      out.push({ userId, settled: r.settled, stillPending: r.stillPending });
    } catch (err) {
      console.error(`[cron/tick] redemption settlement failed for ${userId}:`, err);
      out.push({ userId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}
