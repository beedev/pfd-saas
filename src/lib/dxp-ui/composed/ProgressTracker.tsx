import React from 'react';
import { Card, CardHeader, CardContent } from '../primitives/Card';
import { Badge } from '../primitives/Badge';

export interface ProgressStep {
  label: string;
  description?: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  timestamp?: string;
}

export interface ProgressTrackerProps {
  steps: ProgressStep[];
  title?: string;
  estimatedCompletion?: string;
}

const statusStyle = {
  pending: { dot: 'bg-[var(--dxp-border)]', line: 'bg-[var(--dxp-border)]', badge: 'default' as const, text: 'text-[var(--dxp-text-muted)]' },
  'in-progress': { dot: 'bg-[var(--dxp-brand)] animate-pulse', line: 'bg-[var(--dxp-brand)]/30', badge: 'info' as const, text: 'text-[var(--dxp-brand)]' },
  completed: { dot: 'bg-[var(--dxp-success)]', line: 'bg-[var(--dxp-success)]', badge: 'success' as const, text: 'text-[var(--dxp-text)]' },
  failed: { dot: 'bg-[var(--dxp-danger)]', line: 'bg-[var(--dxp-danger)]', badge: 'danger' as const, text: 'text-[var(--dxp-danger)]' },
};

export function ProgressTracker({ steps, title, estimatedCompletion }: ProgressTrackerProps) {
  const completedCount = steps.filter((s) => s.status === 'completed').length;

  return (
    <Card>
      {title && (
        <CardHeader className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-[var(--dxp-text)]">{title}</h3>
            <p className="text-xs text-[var(--dxp-text-muted)] mt-0.5">{completedCount} of {steps.length} steps completed</p>
          </div>
          {estimatedCompletion && (
            <span className="text-xs text-[var(--dxp-text-muted)]">Est. {estimatedCompletion}</span>
          )}
        </CardHeader>
      )}
      <CardContent>
        {/* Progress bar */}
        <div className="h-1.5 w-full bg-[var(--dxp-border-light)] rounded-full mb-6 overflow-hidden">
          <div
            className="h-full bg-[var(--dxp-brand)] rounded-full transition-all duration-500"
            style={{ width: `${(completedCount / steps.length) * 100}%` }}
          />
        </div>

        {/* Steps */}
        <div className="space-y-0">
          {steps.map((step, i) => {
            const style = statusStyle[step.status];
            const isLast = i === steps.length - 1;
            return (
              <div key={i} className="flex gap-4">
                {/* Timeline */}
                <div className="flex flex-col items-center">
                  <div className={`w-3 h-3 rounded-full flex-shrink-0 ${style.dot}`}>
                    {step.status === 'completed' && (
                      <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="currentColor">
                        <path d="M10 3L4.5 8.5L2 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
                      </svg>
                    )}
                  </div>
                  {!isLast && <div className={`w-0.5 flex-1 min-h-[2rem] ${style.line}`} />}
                </div>

                {/* Content */}
                <div className={`pb-6 ${isLast ? 'pb-0' : ''}`}>
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium ${style.text}`}>{step.label}</span>
                    <Badge variant={style.badge}>
                      {step.status === 'in-progress' ? 'In Progress' : step.status}
                    </Badge>
                  </div>
                  {step.description && (
                    <p className="text-xs text-[var(--dxp-text-muted)] mt-1">{step.description}</p>
                  )}
                  {step.timestamp && (
                    <p className="text-[10px] text-[var(--dxp-text-muted)] mt-1">{step.timestamp}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
