import React from 'react';
import { Card, CardHeader, CardContent, CardFooter } from '../primitives/Card';
import { Button } from '../primitives/Button';
import { Badge } from '../primitives/Badge';

export interface ApprovalCardProps {
  title: string;
  description: string;
  metadata?: { label: string; value: string }[];
  status?: 'pending' | 'approved' | 'rejected';
  onApprove?: () => void;
  onReject?: () => void;
  approveLabel?: string;
  rejectLabel?: string;
}

const statusConfig = {
  pending: { variant: 'warning' as const, label: 'Pending Approval' },
  approved: { variant: 'success' as const, label: 'Approved' },
  rejected: { variant: 'danger' as const, label: 'Rejected' },
};

export function ApprovalCard({
  title, description, metadata, status = 'pending',
  onApprove, onReject, approveLabel = 'Approve', rejectLabel = 'Reject',
}: ApprovalCardProps) {
  const config = statusConfig[status];
  const isPending = status === 'pending';

  return (
    <Card className={`transition-all ${status === 'approved' ? 'border-[var(--dxp-success)]/30 bg-emerald-50/30' : status === 'rejected' ? 'border-[var(--dxp-danger)]/30 bg-red-50/30' : ''}`}>
      <CardHeader className="flex items-start justify-between">
        <div>
          <h3 className="text-base font-bold text-[var(--dxp-text)]">{title}</h3>
          <p className="text-sm text-[var(--dxp-text-secondary)] mt-1">{description}</p>
        </div>
        <Badge variant={config.variant}>{config.label}</Badge>
      </CardHeader>

      {metadata && metadata.length > 0 && (
        <CardContent className="border-t border-[var(--dxp-border-light)]">
          <dl className="grid grid-cols-2 gap-3">
            {metadata.map((item) => (
              <div key={item.label}>
                <dt className="text-[10px] font-bold uppercase tracking-wider text-[var(--dxp-text-muted)]">{item.label}</dt>
                <dd className="text-sm font-medium text-[var(--dxp-text)] mt-0.5">{item.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      )}

      {isPending && (onApprove || onReject) && (
        <CardFooter className="flex justify-end gap-3">
          {onReject && <Button variant="secondary" onClick={onReject}>{rejectLabel}</Button>}
          {onApprove && <Button variant="primary" onClick={onApprove}>{approveLabel}</Button>}
        </CardFooter>
      )}

      {!isPending && (
        <CardFooter>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${status === 'approved' ? 'bg-[var(--dxp-success)]' : 'bg-[var(--dxp-danger)]'}`} />
            <span className="text-sm text-[var(--dxp-text-secondary)]">
              {status === 'approved' ? 'This request has been approved' : 'This request has been rejected'}
            </span>
          </div>
        </CardFooter>
      )}
    </Card>
  );
}
