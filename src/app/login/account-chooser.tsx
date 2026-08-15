'use client';

/**
 * Two-card account chooser for the Docker self-host + desktop app.
 *
 * Sprint 6.1.9c — rendered by login/page.tsx when DEMO_PERSONAL_SWITCH=true.
 *
 * Client component: each card does `fetch(switch-account)` then navigates. The
 * earlier version used a raw `<form method="POST">` relying on the route's 303
 * redirect. That works over `localhost` (Docker) but in the desktop app
 * (127.0.0.1) the browser races the Set-Cookie commit against the redirect —
 * the follow-up GET / goes out without the session cookie and bounces back to
 * /login. Awaiting the fetch guarantees the cookie is stored before we
 * navigate, exactly like the sidebar switcher (which never had this problem).
 */

import { useState } from 'react';
import { appName } from '@/lib/brand';

export function AccountChooser() {
  const [busy, setBusy] = useState<'demo' | 'personal' | null>(null);

  async function choose(target: 'demo' | 'personal') {
    if (busy) return;
    setBusy(target);
    try {
      const res = await fetch(`/api/auth/switch-account?to=${target}`, { method: 'POST' });
      if (!res.ok) throw new Error(`switch failed: ${res.status}`);
      // Full navigation (not router.push) so every server component re-runs
      // with the freshly-set session cookie.
      window.location.href = '/';
    } catch (e) {
      console.error(e);
      setBusy(null);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-amber-50 via-white to-amber-100 px-4 py-12">
      <div className="w-full max-w-3xl">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-amber-100 mb-4">
            <svg
              className="w-7 h-7 text-amber-700"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-gray-900">
            Welcome to {appName()}
          </h1>
          <p className="text-sm text-gray-500 mt-2">
            Pick how you&rsquo;d like to start. You can switch between accounts
            anytime from the sidebar.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Demo card */}
          <div className="bg-white rounded-2xl shadow-xl border border-amber-200 p-6 flex flex-col">
            <div className="flex items-center gap-2 mb-3">
              <span aria-hidden="true" className="text-2xl">👁</span>
              <h2 className="text-lg font-semibold text-gray-900">
                Try the demo
              </h2>
            </div>
            <p className="text-sm text-gray-600 mb-6 flex-1">
              A pre-loaded BXDEva-style portfolio: ₹2.76 Cr across stocks,
              mutual funds, NPS, EPF, real estate, FDs, forex, and more.
              Every screen has realistic data so you can explore without
              entering anything yourself.
            </p>
            <button
              type="button"
              onClick={() => choose('demo')}
              disabled={busy !== null}
              className="w-full py-2.5 px-4 rounded-lg bg-amber-700 hover:bg-amber-800 disabled:opacity-60 text-white font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2"
            >
              {busy === 'demo' ? 'Opening…' : 'Open Demo →'}
            </button>
          </div>

          {/* Personal card */}
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-6 flex flex-col">
            <div className="flex items-center gap-2 mb-3">
              <span aria-hidden="true" className="text-2xl">💼</span>
              <h2 className="text-lg font-semibold text-gray-900">
                Use my own data
              </h2>
            </div>
            <p className="text-sm text-gray-600 mb-6 flex-1">
              Empty dashboard — start with your own salary, investments,
              insurance, and taxes. Survives restarts; your entries live in the
              local database.
            </p>
            <button
              type="button"
              onClick={() => choose('personal')}
              disabled={busy !== null}
              className="w-full py-2.5 px-4 rounded-lg bg-gray-900 hover:bg-gray-800 disabled:opacity-60 text-white font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
            >
              {busy === 'personal' ? 'Opening…' : 'Open Personal →'}
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          Switch between them anytime from the sidebar. · {appName()} · India
        </p>
      </div>
    </div>
  );
}
