'use client';

/**
 * Telegram connection card — settings page.
 *
 * Two-state UI:
 *
 *   - Disconnected (telegram_chat_id is null on the user):
 *       Button → POST /api/integrations/telegram/start → opens
 *       the deep link in a new tab → polls GET /api/user-preferences
 *       every 3s until telegram_chat_id appears (or 5min timeout).
 *
 *   - Connected (telegram_chat_id is set):
 *       Shows "Connected as @username" (or just "Connected") with a
 *       Disconnect button → DELETE /api/integrations/telegram → refresh.
 *
 * The user-preferences API never returns the pairing token, so this
 * component never sees it. The deep link is one-way only.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

interface UserPreferences {
  telegramChatId: string | null;
  telegramUsername: string | null;
}

const POLL_INTERVAL_MS = 3000;
const POLL_MAX_MS = 5 * 60 * 1000; // 5 minutes

export function TelegramConnectionForm() {
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [polling, setPolling] = useState(false);

  // Track the active polling timer so we can cancel it on unmount or
  // on a state transition.
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollDeadlineRef = useRef<number>(0);

  const refresh = useCallback(async (): Promise<UserPreferences | null> => {
    const r = await fetch('/api/user-preferences', { cache: 'no-store' });
    if (!r.ok) throw new Error(`GET /api/user-preferences → ${r.status}`);
    const j = (await r.json()) as { preferences: UserPreferences | null };
    setPrefs(j.preferences);
    return j.preferences;
  }, []);

  // Initial load.
  useEffect(() => {
    (async () => {
      try {
        await refresh();
      } catch (err) {
        console.error(err);
        toast.error('Could not load preferences');
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [refresh]);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setPolling(false);
  }, []);

  const startPolling = useCallback(() => {
    setPolling(true);
    pollDeadlineRef.current = Date.now() + POLL_MAX_MS;

    const tick = async () => {
      if (Date.now() > pollDeadlineRef.current) {
        stopPolling();
        toast.message('Pairing timeout — please try again.');
        return;
      }
      try {
        const next = await refresh();
        if (next?.telegramChatId) {
          stopPolling();
          toast.success(
            next.telegramUsername
              ? `Connected as @${next.telegramUsername}`
              : 'Telegram connected',
          );
          return;
        }
      } catch (err) {
        console.error('[telegram poll]', err);
      }
      pollTimerRef.current = setTimeout(tick, POLL_INTERVAL_MS);
    };
    pollTimerRef.current = setTimeout(tick, POLL_INTERVAL_MS);
  }, [refresh, stopPolling]);

  const handleConnect = async () => {
    setStarting(true);
    try {
      const r = await fetch('/api/integrations/telegram/start', { method: 'POST' });
      const j = (await r.json()) as { deepLink?: string; error?: string };
      if (!r.ok || !j.deepLink) {
        throw new Error(j.error ?? `Failed (HTTP ${r.status})`);
      }
      // Open the Telegram deep link in a new tab — Telegram will pick
      // it up in the desktop/mobile/web app the user has installed.
      window.open(j.deepLink, '_blank', 'noopener,noreferrer');
      toast.message('Open Telegram and press Start to confirm the connection.');
      startPolling();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start pairing');
    } finally {
      setStarting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const r = await fetch('/api/integrations/telegram', { method: 'DELETE' });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Failed (HTTP ${r.status})`);
      }
      await refresh();
      toast.success('Disconnected Telegram');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Disconnect failed');
    } finally {
      setDisconnecting(false);
    }
  };

  const connected = Boolean(prefs?.telegramChatId);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle>Telegram notifications</CardTitle>
            <CardDescription>
              Pair your Telegram account to receive your daily digest and alerts
              directly in chat.
            </CardDescription>
          </div>
          {!loading && (
            <Badge variant={connected ? 'default' : 'outline'}>
              {connected ? 'Connected' : 'Not connected'}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : connected ? (
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium">
                {prefs?.telegramUsername
                  ? `Connected as @${prefs.telegramUsername}`
                  : 'Connected to Telegram'}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Daily digest and alerts will be delivered here.
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={handleDisconnect}
              disabled={disconnecting}
            >
              {disconnecting ? 'Disconnecting…' : 'Disconnect'}
            </Button>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Connect Telegram</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {polling
                  ? 'Waiting for confirmation in Telegram… (this tab will update when done).'
                  : 'Click below, then press Start in Telegram to confirm the pairing.'}
              </p>
            </div>
            <Button
              type="button"
              variant="default"
              onClick={handleConnect}
              disabled={starting || polling}
            >
              {starting ? 'Starting…' : polling ? 'Waiting…' : 'Connect Telegram'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
