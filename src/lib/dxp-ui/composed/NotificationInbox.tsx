import React, { useState } from 'react';
import { Button } from '../primitives/Button';

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  read: boolean;
  date: string;
}

export interface NotificationInboxProps {
  notifications: NotificationItem[];
  onMarkRead?: (id: string) => void;
  onMarkAllRead?: () => void;
}

export function NotificationInbox({ notifications, onMarkRead, onMarkAllRead }: NotificationInboxProps) {
  const [open, setOpen] = useState(false);
  const unread = notifications.filter((n) => !n.read).length;

  return (
    <div className="relative">
      <Button variant="ghost" size="icon" onClick={() => setOpen(!open)} className="relative">
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--dxp-danger)] text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-80 rounded-[var(--dxp-radius)] border border-[var(--dxp-border)] bg-[var(--dxp-surface)] shadow-lg">
            <div className="flex items-center justify-between border-b border-[var(--dxp-border)] px-4 py-3">
              <h3 className="text-sm font-semibold text-[var(--dxp-text)]">Notifications</h3>
              {unread > 0 && onMarkAllRead && (
                <button onClick={onMarkAllRead} className="text-xs font-medium text-[var(--dxp-brand)] hover:text-[var(--dxp-brand-dark)]">
                  Mark all read
                </button>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {notifications.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-[var(--dxp-text-muted)]">No notifications</p>
              ) : (
                notifications.map((n) => (
                  <div
                    key={n.id}
                    className={`border-b border-[var(--dxp-border-light)] px-4 py-3 last:border-0 ${!n.read ? 'bg-[var(--dxp-brand-light)]' : ''}`}
                    onClick={() => onMarkRead?.(n.id)}
                  >
                    <div className="flex items-start justify-between">
                      <p className="text-sm font-medium text-[var(--dxp-text)]">{n.title}</p>
                      {!n.read && <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-[var(--dxp-brand)]" />}
                    </div>
                    <p className="mt-0.5 text-xs text-[var(--dxp-text-secondary)]">{n.message}</p>
                    <p className="mt-1 text-xs text-[var(--dxp-text-muted)]">{n.date}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
