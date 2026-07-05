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
import { runPremarketBrief } from '@/lib/agent/news/brief';
import { runMorningPicks } from '@/lib/cron/agent-morning-picks';
import { recordDailySnapshot } from '@/lib/cron/agent-snapshot';
import { runAgentSelfTune } from '@/lib/cron/agent-self-tune';
import { runEodReview } from '@/lib/agent/signal/eod-review';
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
  agent_intraday_run: 10 * 60 * 1000, // every 10 min (catches more ORB breakouts; no-ops outside market hours)
  agent_news_ingest: 30 * 60 * 1000,  // poll RSS feeds every 30 min
  agent_premarket_brief: 24 * 60 * 60 * 1000, // daily (anchored to 07:30 IST below)
  agent_self_tune: 24 * 60 * 60 * 1000,       // daily (anchored to 16:00 IST below)
  agent_eod_review: 24 * 60 * 60 * 1000,      // daily (anchored to 16:30 IST below)
  agent_morning_picks: 24 * 60 * 60 * 1000,   // daily (anchored to 07:35 IST below — just after the brief)
  agent_daily_snapshot: 24 * 60 * 60 * 1000,  // daily (anchored to 16:10 IST below — after close/square-off)
};

// agent_premarket_brief fires at 07:30 IST — overnight/morning news digested
// into a directional buy/short list before the 09:15 open. Same UTC-frame trick.
const NEXT_PREMARKET_IST = sql`(
  CASE WHEN ((date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') + interval '7 hours 30 minutes') AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'UTC' > now()
  THEN ((date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') + interval '7 hours 30 minutes') AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'UTC'
  ELSE ((date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') + interval '7 hours 30 minutes') AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'UTC' + interval '1 day' END
)`;

// agent_morning_picks fires at 07:35 IST — 5 min after the brief (07:30) so the
// day's directional names are fresh: vet candidates → split intraday/2-3mo →
// store the day's picks + signal. run-swing trades them during the session.
const NEXT_MORNINGPICKS_IST = sql`(
  CASE WHEN ((date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') + interval '7 hours 35 minutes') AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'UTC' > now()
  THEN ((date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') + interval '7 hours 35 minutes') AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'UTC'
  ELSE ((date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') + interval '7 hours 35 minutes') AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'UTC' + interval '1 day' END
)`;

// agent_daily_snapshot fires at 16:10 IST — after square-off (15:15) + close
// (15:30) so held positions have final prices for the day's equity snapshot.
const NEXT_SNAPSHOT_IST = sql`(
  CASE WHEN ((date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') + interval '16 hours 10 minutes') AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'UTC' > now()
  THEN ((date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') + interval '16 hours 10 minutes') AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'UTC'
  ELSE ((date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') + interval '16 hours 10 minutes') AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'UTC' + interval '1 day' END
)`;

// agent_daily_run fires at the NSE open — 09:20 IST, a 5-min buffer past the
// 09:15 bell so `marketState` is reliably REGULAR and the first ticks have
// printed — NOT a drifting NOW()+24h. Computed in the DB's UTC frame via the
// Asia/Kolkata zone, so it lands at the open regardless of when it last ran.
const NEXT_DAILY_OPEN_IST = sql`(
  CASE WHEN ((date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') + interval '9 hours 20 minutes') AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'UTC' > now()
  THEN ((date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') + interval '9 hours 20 minutes') AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'UTC'
  ELSE ((date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') + interval '9 hours 20 minutes') AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'UTC' + interval '1 day' END
)`;

// agent_self_tune fires at 16:00 IST — after the 15:30 close + 15:15 square-off
// have settled, so the day's closed trades + bars are final for archiving and
// replay. Same UTC-frame trick.
const NEXT_SELFTUNE_IST = sql`(
  CASE WHEN ((date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') + interval '16 hours') AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'UTC' > now()
  THEN ((date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') + interval '16 hours') AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'UTC'
  ELSE ((date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') + interval '16 hours') AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'UTC' + interval '1 day' END
)`;

// agent_eod_review fires at 16:30 IST — after self-tune (16:00), the day's news
// tags + closes are final for movers vs non-movers credit assignment.
const NEXT_EODREVIEW_IST = sql`(
  CASE WHEN ((date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') + interval '16 hours 30 minutes') AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'UTC' > now()
  THEN ((date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') + interval '16 hours 30 minutes') AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'UTC'
  ELSE ((date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') + interval '16 hours 30 minutes') AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'UTC' + interval '1 day' END
)`;

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
  // Atomically CLAIM due jobs by leasing next_run_at 10 min forward in the SAME
  // statement that selects them. A concurrent tick (the scheduler fires every
  // 60s, but a job can run for minutes) won't re-select a leased job — this
  // prevents the double-run that caused lost cash updates. The real next_run_at
  // is set per job after it completes below.
  const due = await db
    .update(scheduledJobs)
    .set({ nextRunAt: sql`NOW() + interval '10 minutes'` })
    .where(
      and(
        eq(scheduledJobs.enabled, true),
        sql`${scheduledJobs.nextRunAt} <= NOW()`,
      ),
    )
    .returning();

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
        case 'agent_premarket_brief':
          // Global pre-market directional brief (07:30 IST) → drives intraday.
          report.result = await runPremarketBrief();
          break;
        case 'agent_morning_picks':
          // Per-user (07:35 IST): vet the day's candidates → split intraday/2-3mo
          // → store picks + Telegram signal. run-swing trades them intraday.
          report.result = await runMorningPicks(job.userId);
          break;
        case 'agent_daily_snapshot':
          // Per-user (16:10 IST): record the day's equity/metrics snapshot for the
          // forward-test time series + send an EOD performance line.
          report.result = await recordDailySnapshot(job.userId);
          break;
        case 'agent_self_tune':
          // L3 post-close (16:00 IST): archive bars + propose ORB param tuning.
          // No-ops unless a sleeve has tuning enabled. Propose-only in Phase 3.
          report.result = await runAgentSelfTune(job.userId);
          break;
        case 'agent_eod_review':
          // Global post-close (16:30 IST): score news-signal tags vs the day's
          // Nifty 500 movers, update phrase weights, flag coverage gaps.
          // Self-guards to run once/day even though scheduled per user.
          report.result = await runEodReview();
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
        nextRunAt: job.jobType === 'agent_daily_run'
          ? NEXT_DAILY_OPEN_IST
          : job.jobType === 'agent_premarket_brief'
            ? NEXT_PREMARKET_IST
            : job.jobType === 'agent_self_tune'
              ? NEXT_SELFTUNE_IST
              : job.jobType === 'agent_eod_review'
                ? NEXT_EODREVIEW_IST
                : job.jobType === 'agent_morning_picks'
                  ? NEXT_MORNINGPICKS_IST
                  : job.jobType === 'agent_daily_snapshot'
                    ? NEXT_SNAPSHOT_IST
                    : sql`NOW() + (${advanceMs}::text || ' milliseconds')::interval`,
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
    CROSS JOIN (VALUES ('daily_digest'), ('alerts_check'), ('sip_auto_execute'), ('agent_daily_run'), ('agent_intraday_run'), ('agent_news_ingest'), ('agent_premarket_brief'), ('agent_self_tune'), ('agent_eod_review'), ('agent_morning_picks'), ('agent_daily_snapshot')) AS j(jt)
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
