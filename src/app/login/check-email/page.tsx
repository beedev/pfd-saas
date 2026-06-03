/**
 * Post-sign-in landing page.
 *
 * Sprint 6.1.5 — when MAGIC_LINK_DISPLAY=ui (Docker self-host default),
 * polls /api/auth/pending-link?email=... for the just-issued magic link
 * and surfaces it as a big "Sign in as {email}" button. Falls back to
 * the "check your inbox" copy if no link materializes within the polling
 * window (real SMTP flow, or the cache already consumed the link).
 *
 * Reads `?email=` from the URL query string. The login page (Sprint 6.1.5)
 * threads the email through the redirectTo callback.
 */
import { Suspense } from 'react';
import CheckEmailClient from './check-email-client';

export default function CheckEmailPage() {
  return (
    <Suspense fallback={<CheckEmailFallback />}>
      <CheckEmailClient />
    </Suspense>
  );
}

function CheckEmailFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-amber-50 via-white to-amber-100">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl border border-amber-200 p-8 text-center text-sm text-gray-500">
          Loading…
        </div>
      </div>
    </div>
  );
}
