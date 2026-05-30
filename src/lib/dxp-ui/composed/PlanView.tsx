import React from 'react';
import { Card, CardHeader, CardContent } from '../primitives/Card';
import { Badge } from '../primitives/Badge';

export interface PlanTask {
  id: string;
  title: string;
  status: 'todo' | 'in-progress' | 'done' | 'blocked';
  assignee?: string;
  dueDate?: string;
  subtasks?: { title: string; done: boolean }[];
}

export interface PlanViewProps {
  title: string;
  description?: string;
  tasks: PlanTask[];
}

const statusBadge = {
  'todo': { variant: 'default' as const, label: 'To Do' },
  'in-progress': { variant: 'info' as const, label: 'In Progress' },
  'done': { variant: 'success' as const, label: 'Done' },
  'blocked': { variant: 'danger' as const, label: 'Blocked' },
};

export function PlanView({ title, description, tasks }: PlanViewProps) {
  const doneCount = tasks.filter((t) => t.status === 'done').length;
  const percent = Math.round((doneCount / tasks.length) * 100);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-base font-bold text-[var(--dxp-text)]">{title}</h3>
            {description && <p className="text-xs text-[var(--dxp-text-muted)] mt-1">{description}</p>}
          </div>
          <span className="text-sm font-bold text-[var(--dxp-brand)]">{percent}%</span>
        </div>
        <div className="h-1.5 w-full bg-[var(--dxp-border-light)] rounded-full mt-3 overflow-hidden">
          <div className="h-full bg-[var(--dxp-brand)] rounded-full transition-all" style={{ width: `${percent}%` }} />
        </div>
      </CardHeader>
      <CardContent className="space-y-0">
        {tasks.map((task, i) => {
          const badge = statusBadge[task.status];
          return (
            <div key={task.id} className={`py-4 ${i > 0 ? 'border-t border-[var(--dxp-border-light)]' : ''}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
                    task.status === 'done' ? 'bg-[var(--dxp-success)]' : 'border-2 border-[var(--dxp-border)]'
                  }`}>
                    {task.status === 'done' && (
                      <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
                        <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    )}
                  </div>
                  <span className={`text-sm font-medium ${task.status === 'done' ? 'line-through text-[var(--dxp-text-muted)]' : 'text-[var(--dxp-text)]'}`}>
                    {task.title}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {task.assignee && <span className="text-xs text-[var(--dxp-text-muted)]">{task.assignee}</span>}
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                </div>
              </div>
              {task.subtasks && task.subtasks.length > 0 && (
                <div className="ml-8 mt-2 space-y-1">
                  {task.subtasks.map((sub, j) => (
                    <div key={j} className="flex items-center gap-2">
                      <div className={`w-3.5 h-3.5 rounded flex items-center justify-center ${sub.done ? 'bg-[var(--dxp-success)]' : 'border border-[var(--dxp-border)]'}`}>
                        {sub.done && <svg className="w-2 h-2 text-white" viewBox="0 0 12 12" fill="none"><path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>}
                      </div>
                      <span className={`text-xs ${sub.done ? 'line-through text-[var(--dxp-text-muted)]' : 'text-[var(--dxp-text-secondary)]'}`}>{sub.title}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
