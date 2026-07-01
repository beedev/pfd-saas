'use client';

/** Scheduled jobs — today's run status + result for every cron job. */

import { useCallback, useEffect, useState } from 'react';
import { Card, CardHeader, CardContent, Button } from '@dxp/ui';
import { Loader2, RefreshCw, CheckCircle2, XCircle, Clock } from 'lucide-react';

interface Job {
  jobType: string; label: string; cadence: string; group: 'Analyst' | 'General';
  enabled: boolean; status: 'success' | 'failed' | 'pending'; ranToday: boolean;
  lastRunTimeIst: string | null; nextRunIst: string | null; runCount: number;
  error: string | null; result: string | null;
}

export default function JobsPage() {
  const [loaded, setLoaded] = useState(false);
  const [today, setToday] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/jobs/status').then((x) => x.json());
      setToday(r.today ?? '');
      setJobs(r.jobs ?? []);
    } catch { /* leave */ }
    setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!loaded) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-[var(--dxp-text-muted)]" /></div>;

  const groups: Array<'Analyst' | 'General'> = ['Analyst', 'General'];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">Scheduled jobs</h1>
          <p className="text-sm text-[var(--dxp-text-muted)]">Today&apos;s run status · {today} IST</p>
        </div>
        <Button variant="secondary" onClick={load}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
      </div>

      {groups.map((g) => {
        const list = jobs.filter((j) => j.group === g);
        if (!list.length) return null;
        return (
          <Card key={g}>
            <CardHeader><h3 className="text-base font-bold text-[var(--dxp-text)]">{g}</h3></CardHeader>
            <CardContent>
              <div className="divide-y divide-[var(--dxp-border)]">
                {list.map((j) => <JobRow key={j.jobType} job={j} />)}
              </div>
            </CardContent>
          </Card>
        );
      })}
      <p className="text-xs text-[var(--dxp-text-muted)]">
        Status reflects whether each job ran <strong>today</strong>. Recurring jobs (intraday, news, alerts)
        show their latest run of the day. Disabled or not-yet-fired jobs show as pending with the next scheduled time.
      </p>
    </div>
  );
}

function JobRow({ job }: { job: Job }) {
  const icon = job.status === 'success' ? <CheckCircle2 className="h-5 w-5 text-green-600" />
    : job.status === 'failed' ? <XCircle className="h-5 w-5 text-red-600" />
    : <Clock className="h-5 w-5 text-[var(--dxp-text-muted)]" />;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
      <div className="shrink-0">{icon}</div>
      <div className="min-w-[10rem] flex-1">
        <div className="font-medium text-[var(--dxp-text)]">{job.label}{!job.enabled && <span className="ml-2 text-xs text-[var(--dxp-text-muted)]">(disabled)</span>}</div>
        <div className="text-xs text-[var(--dxp-text-muted)]">{job.cadence}</div>
      </div>
      <div className="min-w-[9rem] text-sm">
        {job.ranToday
          ? <span className="text-[var(--dxp-text)]">Ran {job.lastRunTimeIst} IST</span>
          : <span className="text-[var(--dxp-text-muted)]">Pending → {job.nextRunIst ?? '—'}</span>}
        {job.result && <div className="text-xs text-[var(--dxp-text-muted)]">{job.result}</div>}
        {job.error && <div className="text-xs text-red-600">{job.error}</div>}
      </div>
    </div>
  );
}
