import React from 'react';
import { Card, CardHeader, CardContent, CardFooter } from '../primitives/Card';
import { Button } from '../primitives/Button';

export interface OrderLineItem {
  label: string;
  detail?: string;
  amount: string;
  highlight?: boolean;
}

export interface OrderSummaryProps {
  title?: string;
  items: OrderLineItem[];
  total: { label: string; amount: string };
  taxes?: { label: string; amount: string };
  onConfirm?: () => void;
  onCancel?: () => void;
  confirmLabel?: string;
  note?: string;
}

export function OrderSummary({
  title = 'Order Summary', items, total, taxes, onConfirm, onCancel, confirmLabel = 'Confirm', note,
}: OrderSummaryProps) {
  return (
    <Card>
      <CardHeader>
        <h3 className="text-base font-bold text-[var(--dxp-text)]">{title}</h3>
      </CardHeader>
      <CardContent className="space-y-0">
        {items.map((item, i) => (
          <div key={i} className={`flex items-start justify-between py-3 ${i > 0 ? 'border-t border-[var(--dxp-border-light)]' : ''}`}>
            <div>
              <span className={`text-sm ${item.highlight ? 'font-bold text-[var(--dxp-text)]' : 'text-[var(--dxp-text)]'}`}>{item.label}</span>
              {item.detail && <p className="text-xs text-[var(--dxp-text-muted)] mt-0.5">{item.detail}</p>}
            </div>
            <span className={`text-sm font-medium ${item.highlight ? 'font-bold text-[var(--dxp-brand)]' : 'text-[var(--dxp-text)]'}`}>{item.amount}</span>
          </div>
        ))}
        {taxes && (
          <div className="flex justify-between py-3 border-t border-[var(--dxp-border-light)]">
            <span className="text-sm text-[var(--dxp-text-muted)]">{taxes.label}</span>
            <span className="text-sm text-[var(--dxp-text-muted)]">{taxes.amount}</span>
          </div>
        )}
        <div className="flex justify-between py-4 border-t-2 border-[var(--dxp-border)]">
          <span className="text-base font-bold text-[var(--dxp-text)]">{total.label}</span>
          <span className="text-base font-bold text-[var(--dxp-text)]">{total.amount}</span>
        </div>
      </CardContent>
      {(onConfirm || onCancel || note) && (
        <CardFooter className="flex flex-col gap-3">
          {note && <p className="text-xs text-[var(--dxp-text-muted)] text-center">{note}</p>}
          {(onConfirm || onCancel) && (
            <div className="flex gap-3 w-full">
              {onCancel && <Button variant="secondary" onClick={onCancel} className="flex-1">Cancel</Button>}
              {onConfirm && <Button onClick={onConfirm} className="flex-1">{confirmLabel}</Button>}
            </div>
          )}
        </CardFooter>
      )}
    </Card>
  );
}
