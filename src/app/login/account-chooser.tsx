/**
 * Two-card account chooser for Docker self-host.
 *
 * Sprint 6.1.9c — rendered by login/page.tsx when
 * DEMO_PERSONAL_SWITCH=true. Server component; no client interactivity
 * needed because each card is a plain HTML form posting to
 * /api/auth/switch-account?to=<target>. The route handler issues a 303
 * redirect to '/' on success, so the browser navigates naturally
 * without any JS in the page.
 *
 * Keep this component server-only so it stays renderable on JS-disabled
 * browsers — the click-to-sign-in flow degrades to a single HTTP POST.
 */

import { appName } from '@/lib/brand';

export function AccountChooser() {
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
          <form
            method="POST"
            action="/api/auth/switch-account?to=demo"
            className="bg-white rounded-2xl shadow-xl border border-amber-200 p-6 flex flex-col"
          >
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
              type="submit"
              className="w-full py-2.5 px-4 rounded-lg bg-amber-700 hover:bg-amber-800 text-white font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2"
            >
              Open Demo →
            </button>
          </form>

          {/* Personal card */}
          <form
            method="POST"
            action="/api/auth/switch-account?to=personal"
            className="bg-white rounded-2xl shadow-xl border border-gray-200 p-6 flex flex-col"
          >
            <div className="flex items-center gap-2 mb-3">
              <span aria-hidden="true" className="text-2xl">💼</span>
              <h2 className="text-lg font-semibold text-gray-900">
                Use my own data
              </h2>
            </div>
            <p className="text-sm text-gray-600 mb-6 flex-1">
              Empty dashboard — start with your own salary, investments,
              insurance, and taxes. Survives container restarts; your
              entries live in the Docker volume.
            </p>
            <button
              type="submit"
              className="w-full py-2.5 px-4 rounded-lg bg-gray-900 hover:bg-gray-800 text-white font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
            >
              Open Personal →
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          Switch between them anytime from the sidebar. · {appName()} · India
        </p>
      </div>
    </div>
  );
}
