'use client';

/**
 * Client island for the check-email page (Sprint 6.1.5).
 *
 * Behaviour:
 *   1. Read `?email=` from the URL.
 *   2. Poll /api/auth/pending-link?email=... every 800 ms for up to
 *      10 seconds.
 *   3. When the endpoint returns 200, show a big "Sign in as {email}"
 *      button linking to the URL.
 *   4. On timeout, fall back to "check your inbox" copy + Docker-aware
 *      hint about `docker logs pfd-saas`.
 *
 * The polling endpoint is single-use: the FIRST successful response
 * consumes the cached link. If the page is reloaded or two tabs poll
 * concurrently, the second one will see 404 — that's correct (the
 * link is unique and unique-use).
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

const POLL_INTERVAL_MS = 800;
const POLL_TIMEOUT_MS = 10_000;

type PollResult =
  | { status: 'polling' }
  | { status: 'found'; url: string; email: string; expiresAt: string }
  | { status: 'timeout' };

export default function CheckEmailClient() {
  const search = useSearchParams();
  const email = (search.get('email') ?? '').trim();
  const [result, setResult] = useState<PollResult>({ status: 'polling' });

  useEffect(() => {
    if (!email) {
      setResult({ status: 'timeout' });
      return;
    }

    let cancelled = false;
    const startedAt = Date.now();

    async function poll() {
      while (!cancelled && Date.now() - startedAt < POLL_TIMEOUT_MS) {
        try {
          const r = await fetch(`/api/auth/pending-link?email=${encodeURIComponent(email)}`, {
            cache: 'no-store',
          });
          if (r.ok) {
            const body = await r.json();
            if (!cancelled) {
              setResult({
                status: 'found',
                url: body.url,
                email: body.email,
                expiresAt: body.expiresAt,
              });
            }
            return;
          }
          // 404 (no_pending_link), 429 (too_fast), 400 (email_required) —
          // all retryable up to the timeout. Wait and try again.
        } catch {
          // Network blip; keep trying.
        }
        await new Promise((res) => setTimeout(res, POLL_INTERVAL_MS));
      }
      if (!cancelled) setResult({ status: 'timeout' });
    }

    poll();
    return () => {
      cancelled = true;
    };
  }, [email]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-amber-50 via-white to-amber-100">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl border border-amber-200 p-8">
          {result.status === 'polling' && <PollingState email={email} />}
          {result.status === 'found' && (
            <FoundState url={result.url} email={result.email} expiresAt={result.expiresAt} />
          )}
          {result.status === 'timeout' && <TimeoutState email={email} />}

          <p className="text-center text-xs text-gray-400 mt-6">
            Wrong email?{' '}
            <a href="/login" className="text-amber-700 hover:underline">
              Try again
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

function PollingState({ email }: { email: string }) {
  return (
    <div className="text-center">
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-amber-100 mb-4">
        <svg
          className="w-7 h-7 text-amber-700 animate-spin"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 12a8 8 0 018-8" />
        </svg>
      </div>
      <h1 className="text-xl font-semibold text-gray-900">Preparing your sign-in…</h1>
      <p className="text-sm text-gray-500 mt-2">
        Generating a one-time link for <span className="font-medium">{email || 'you'}</span>.
      </p>
    </div>
  );
}

function FoundState({ url, email, expiresAt }: { url: string; email: string; expiresAt: string }) {
  const expiresInMin = Math.max(
    0,
    Math.round((new Date(expiresAt).getTime() - Date.now()) / 60_000),
  );
  return (
    <div className="text-center">
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-emerald-100 mb-4">
        <svg
          className="w-7 h-7 text-emerald-700"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h1 className="text-xl font-semibold text-gray-900">Ready to sign in</h1>
      <p className="text-sm text-gray-500 mt-2 mb-6">
        Click below to sign in as <span className="font-medium">{email}</span>.
      </p>
      <a
        href={url}
        className="block w-full py-3 px-4 rounded-lg bg-amber-700 hover:bg-amber-800 text-white font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2"
      >
        Sign in as {email} →
      </a>
      <p className="text-xs text-gray-400 mt-3">
        This link expires in {expiresInMin} {expiresInMin === 1 ? 'minute' : 'minutes'} and works only once.
      </p>
    </div>
  );
}

function TimeoutState({ email }: { email: string }) {
  return (
    <div className="text-center">
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-amber-100 mb-4">
        <svg
          className="w-7 h-7 text-amber-700"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      </div>
      <h1 className="text-xl font-semibold text-gray-900">Check your inbox</h1>
      <p className="text-sm text-gray-500 mt-2">
        We sent a sign-in link {email ? <>to <span className="font-medium">{email}</span></> : 'to the email you entered'}.
        Open it on this device to finish signing in. The link is valid for 5 minutes.
      </p>
      <div className="text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-3 text-amber-900 mt-5 text-left">
        <p className="font-semibold mb-1">Running pfd-saas locally?</p>
        <p>
          The link is also in the container logs:{' '}
          <code className="bg-amber-100 px-1 rounded">docker logs pfd-saas</code>.
        </p>
      </div>
    </div>
  );
}
