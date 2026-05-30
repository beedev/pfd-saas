'use client';

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Button, Card, CardHeader, CardContent, Badge, Select } from '@dxp/ui';
import {
  CheckCircle,
  AlertCircle,
  XCircle,
  Loader2,
  Lock,
  Unlock,
} from 'lucide-react';
import { getCurrentFinancialYear } from '@/lib/finance/tax-constants';

interface ChecklistItem {
  label: string;
  category: string;
  status: 'done' | 'partial' | 'pending';
  detail: string;
  isLocked: boolean;
}

interface FyStatus {
  fy: string;
  checklist: ChecklistItem[];
  readyToClose: boolean;
  isClosed: boolean;
}

function previousFy(): string {
  const current = getCurrentFinancialYear();
  const s = Number(current.split('-')[0]) - 1;
  return `${s}-${String((s + 1) % 100).padStart(2, '0')}`;
}

function generateFyOptions(): Array<{ value: string; label: string }> {
  const currentStart = Number(getCurrentFinancialYear().split('-')[0]);
  const opts: Array<{ value: string; label: string }> = [];
  for (let i = 3; i >= 0; i--) {
    const s = currentStart - i;
    opts.push({
      value: `${s}-${String((s + 1) % 100).padStart(2, '0')}`,
      label: `FY ${s}-${String((s + 1) % 100).padStart(2, '0')}`,
    });
  }
  return opts;
}

const statusIcon = (status: string) => {
  switch (status) {
    case 'done':
      return <CheckCircle className="h-5 w-5 text-emerald-500" />;
    case 'partial':
      return <AlertCircle className="h-5 w-5 text-amber-500" />;
    default:
      return <XCircle className="h-5 w-5 text-rose-400" />;
  }
};

const statusBadge = (status: string) => {
  switch (status) {
    case 'done':
      return <Badge variant="success">Complete</Badge>;
    case 'partial':
      return <Badge variant="warning">Partial</Badge>;
    default:
      return <Badge variant="danger">Pending</Badge>;
  }
};

export default function FyClosePage() {
  const [fy, setFy] = useState(previousFy());
  const [data, setData] = useState<FyStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isClosing, setIsClosing] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const r = await fetch(`/api/settings/fy-close?fy=${encodeURIComponent(fy)}`).then((r) => r.json());
      if (r.error) throw new Error(r.error);
      setData(r);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load FY status');
    } finally {
      setIsLoading(false);
    }
  }, [fy]);

  useEffect(() => {
    load();
  }, [load]);

  const closeFy = async () => {
    if (!confirm(`Close FY ${fy}? This will update the business profile to the next financial year.`)) return;
    setIsClosing(true);
    try {
      const r = await fetch(`/api/settings/fy-close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fy }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || 'Failed');
      toast.success(`FY ${fy} closed. Business profile updated.`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to close FY');
    } finally {
      setIsClosing(false);
    }
  };

  const toggleLock = async (category: string, currentlyLocked: boolean) => {
    try {
      const r = await fetch('/api/settings/fy-close', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fy, category, lock: !currentlyLocked }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || 'Failed');
      toast.success(d.message);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  if (isLoading || !data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--dxp-text-muted)]" />
      </div>
    );
  }

  const doneCount = data.checklist.filter((c) => c.status === 'done').length;
  const totalCount = data.checklist.length;
  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--dxp-text)]">FY Close Checklist</h1>
          <p className="text-[var(--dxp-text-secondary)]">
            Review and close the financial year
          </p>
        </div>
        <div className="w-40">
          <Select options={generateFyOptions()} value={fy} onChange={setFy} />
        </div>
      </div>

      {/* Progress */}
      <Card>
        <CardContent>
          <div className="flex items-center justify-between mb-3">
            <p className="text-lg font-bold text-[var(--dxp-text)]">
              FY {fy} — {doneCount}/{totalCount} complete
            </p>
            {data.isClosed ? (
              <Badge variant="success">Closed</Badge>
            ) : (
              <Badge variant={pct === 100 ? 'success' : pct > 50 ? 'warning' : 'danger'}>
                {pct}%
              </Badge>
            )}
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-[var(--dxp-border-light)]">
            <div
              className={`h-full transition-all ${pct === 100 ? 'bg-emerald-500' : pct > 50 ? 'bg-amber-500' : 'bg-rose-400'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Checklist */}
      <Card>
        <CardHeader>
          <h2 className="text-base font-bold text-[var(--dxp-text)]">Checklist</h2>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {data.checklist.map((item, idx) => (
              <div
                key={idx}
                className={`flex items-center justify-between rounded-lg border px-4 py-3 ${
                  item.isLocked
                    ? 'border-blue-200 bg-blue-50'
                    : item.status === 'done'
                      ? 'border-emerald-200 bg-emerald-50'
                      : item.status === 'partial'
                        ? 'border-amber-200 bg-amber-50'
                        : 'border-[var(--dxp-border-light)]'
                }`}
              >
                <div className="flex items-center gap-3">
                  {item.isLocked ? (
                    <Lock className="h-5 w-5 text-blue-500" />
                  ) : (
                    statusIcon(item.status)
                  )}
                  <div>
                    <p className="font-semibold text-[var(--dxp-text)]">
                      {item.label}
                      {item.isLocked && <span className="ml-2 text-xs text-blue-600 font-normal">Locked</span>}
                    </p>
                    <p className="text-xs text-[var(--dxp-text-muted)]">{item.detail}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {statusBadge(item.status)}
                  <Button
                    variant={item.isLocked ? 'secondary' : 'primary'}
                    size="sm"
                    onClick={() => toggleLock(item.category, item.isLocked)}
                  >
                    {item.isLocked ? (
                      <><Unlock className="mr-1 h-3 w-3" /> Unlock</>
                    ) : (
                      <><Lock className="mr-1 h-3 w-3" /> Lock</>
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Close FY Button */}
      {!data.isClosed && (
        <div className="flex justify-center">
          <Button
            variant="primary"
            onClick={closeFy}
            disabled={isClosing}
          >
            {isClosing ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : (
              <Lock className="mr-2 h-5 w-5" />
            )}
            Close FY {fy}
          </Button>
        </div>
      )}
    </div>
  );
}
