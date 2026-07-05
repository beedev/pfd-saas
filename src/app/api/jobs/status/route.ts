/**
 * GET /api/jobs/status — today's status of every scheduled cron job for the user,
 * enriched with each job's result-of-the-day where a source exists (analyst runs,
 * brief, self-tune, news). Times are IST; "ran today" is computed DB-side (jobs
 * store last_run_at as naive-UTC via NOW()) to dodge JS timezone ambiguity.
 */

import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db, agentEodReviews, type JobType } from '@/db';
import { eq } from 'drizzle-orm';
import { getSessionUserId, unauthenticated } from '@/lib/api/auth-guard';

const JOB_META: Record<JobType, { label: string; cadence: string; group: 'Analyst' | 'General' }> = {
  daily_digest: { label: 'Daily digest', cadence: 'daily', group: 'General' },
  alerts_check: { label: 'Alerts check', cadence: 'every 5 min', group: 'General' },
  sip_auto_execute: { label: 'SIP auto-execute', cadence: 'daily', group: 'General' },
  agent_premarket_brief: { label: 'Pre-market brief', cadence: '07:30 IST', group: 'Analyst' },
  agent_morning_picks: { label: 'Morning picks (vet + signal)', cadence: '07:35 IST', group: 'Analyst' },
  agent_daily_run: { label: 'Daily run', cadence: '09:20 IST', group: 'Analyst' },
  agent_intraday_run: { label: 'Intraday (ORB)', cadence: 'every 10 min', group: 'Analyst' },
  agent_news_ingest: { label: 'News ingest', cadence: 'every 30 min', group: 'Analyst' },
  agent_self_tune: { label: 'Self-tune', cadence: '16:00 IST', group: 'Analyst' },
  agent_eod_review: { label: 'EOD signal review', cadence: '16:30 IST', group: 'Analyst' },
};

interface JobRow {
  job_type: JobType; enabled: boolean; last_run_status: string | null; last_run_error: string | null;
  run_count: number; last_run_date_ist: string | null; last_run_time_ist: string | null;
  next_run_ist: string | null; ran_today: boolean | null;
}

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return unauthenticated();

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

  const jobsRes = await db.execute(sql`
    SELECT job_type, enabled, last_run_status, last_run_error, run_count,
      to_char(last_run_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS last_run_date_ist,
      to_char(last_run_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS last_run_time_ist,
      to_char(next_run_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'DD Mon HH24:MI') AS next_run_ist,
      (last_run_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date AS ran_today
    FROM scheduled_jobs WHERE user_id = ${userId}
  `);
  const rows = (jobsRes as unknown as { rows?: JobRow[] }).rows ?? (jobsRes as unknown as JobRow[]);

  // Today's result sources (best-effort; only for jobs that have one).
  const details = await todaysResults(userId, today);

  const jobs = rows
    .filter((r) => JOB_META[r.job_type])
    .map((r) => {
      const meta = JOB_META[r.job_type];
      const status: 'success' | 'failed' | 'pending' = !r.ran_today ? 'pending' : (r.last_run_status === 'failed' ? 'failed' : 'success');
      return {
        jobType: r.job_type, label: meta.label, cadence: meta.cadence, group: meta.group,
        enabled: r.enabled, status, ranToday: !!r.ran_today,
        lastRunTimeIst: r.ran_today ? r.last_run_time_ist : null,
        nextRunIst: r.next_run_ist, runCount: r.run_count,
        error: r.last_run_status === 'failed' ? r.last_run_error : null,
        result: r.ran_today ? (details[r.job_type] ?? null) : null,
      };
    })
    .sort((a, b) => (a.group === b.group ? a.label.localeCompare(b.label) : a.group === 'Analyst' ? -1 : 1));

  return NextResponse.json({ today, jobs });
}

/** Per-job "what it produced today" strings, from each job's own tables. */
async function todaysResults(userId: string, today: string): Promise<Partial<Record<JobType, string>>> {
  const out: Partial<Record<JobType, string>> = {};
  const one = async (q: ReturnType<typeof sql>): Promise<Record<string, unknown>[]> => {
    const r = await db.execute(q);
    return (r as unknown as { rows?: Record<string, unknown>[] }).rows ?? (r as unknown as Record<string, unknown>[]);
  };

  const daily = await one(sql`SELECT coalesce(sum(trades_executed),0) trades, max(equity_value_paisa) eq FROM agent_runs WHERE user_id=${userId} AND run_date=${today}`);
  if (daily[0] && daily[0].eq != null) out.agent_daily_run = `${Number(daily[0].trades)} trade(s) · equity ₹${Math.round(Number(daily[0].eq) / 100).toLocaleString('en-IN')}`;

  const intra = await one(sql`SELECT coalesce(sum(trades_executed),0) trades, count(*) ticks FROM agent_runs WHERE user_id=${userId} AND run_date LIKE ${today + 'T%'}`);
  if (intra[0] && Number(intra[0].ticks) > 0) out.agent_intraday_run = `${Number(intra[0].trades)} trade(s) across ${Number(intra[0].ticks)} tick(s)`;

  const brief = await one(sql`SELECT bias, count(*) n FROM agent_daily_brief WHERE brief_date=${today} GROUP BY bias`);
  if (brief.length) {
    const b = (name: string) => Number(brief.find((x) => x.bias === name)?.n ?? 0);
    out.agent_premarket_brief = `${b('BULLISH')} bullish · ${b('BEARISH')} bearish · ${b('NEUTRAL')} neutral`;
  }

  const tune = await one(sql`SELECT decision, reason FROM agent_param_experiments WHERE user_id=${userId} AND run_date=${today} ORDER BY id DESC LIMIT 1`);
  if (tune[0]) out.agent_self_tune = `${tune[0].decision}${tune[0].reason ? ' · ' + tune[0].reason : ''}`;

  const news = await one(sql`SELECT count(*) n FROM agent_news WHERE (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date`);
  if (news[0]) out.agent_news_ingest = `${Number(news[0].n)} item(s) ingested`;

  const review = (await db.select({ summary: agentEodReviews.summary }).from(agentEodReviews).where(eq(agentEodReviews.reviewDate, today)).limit(1))[0];
  if (review?.summary) out.agent_eod_review = review.summary;

  return out;
}
