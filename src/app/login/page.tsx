'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';

/**
 * Email magic-link sign-in.
 *
 * The submit POSTs through next-auth/react -> /api/auth/signin/nodemailer.
 * Auth.js generates a verification token, stores it in verification_token,
 * and calls our sendVerificationRequest hook (see src/auth.ts) which —
 * when MAGIC_LINK_DISPLAY=ui — stashes the URL in an in-memory cache
 * for /api/auth/pending-link to surface on the next page.
 *
 * Why we override the redirect manually:
 * NextAuth's default behaviour is to redirect to `pages.verifyRequest`
 * but WITHOUT passing the email forward. Our check-email page needs
 * the email in the query to poll /api/auth/pending-link?email=…, so we
 * call signIn({ redirect: false }), then router.push to the
 * check-email URL ourselves with ?email= baked in.
 */
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await signIn('nodemailer', {
        email,
        redirect: false,
      });
      if (result?.error) {
        setError(result.error);
        setLoading(false);
        return;
      }
      // signIn succeeded — Auth.js has stashed the magic-link URL in
      // the pendingLinks cache. Navigate to check-email with the email
      // in the query so the page can poll for it.
      router.push(`/login/check-email?email=${encodeURIComponent(email)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send sign-in link');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-amber-50 via-white to-amber-100">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-xl border border-amber-200 p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-amber-100 mb-4">
              <svg className="w-7 h-7 text-amber-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <h1 className="text-xl font-semibold text-gray-900">Sign in</h1>
            <p className="text-sm text-gray-500 mt-1">We&rsquo;ll send a one-time link to your email.</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1.5">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoFocus
                required
                autoComplete="email"
                className="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 bg-gray-50 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-colors"
              />
            </div>

            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-lg bg-amber-700 hover:bg-amber-800 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2"
            >
              {loading ? 'Sending link…' : 'Email me a sign-in link'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          Personal Finance Dashboard · India
        </p>
      </div>
    </div>
  );
}
