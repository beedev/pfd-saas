/**
 * verifyRequest landing page — Auth.js redirects here after the magic-link
 * is generated. While email is stubbed (see STUBS.md #1), the link is in
 * the dev console / tmp/magic-links.log instead of in an inbox; the copy
 * below tells the operator where to look without exposing the stub status
 * to a future production user.
 */
export default function CheckEmailPage() {
  const isStubbed = process.env.NODE_ENV !== 'production';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-amber-50 via-white to-amber-100">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl border border-amber-200 p-8">
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-amber-100 mb-4">
              <svg className="w-7 h-7 text-amber-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-xl font-semibold text-gray-900">Check your inbox</h1>
            <p className="text-sm text-gray-500 mt-2">
              We sent a sign-in link to the email you entered. Open it on this
              device to finish signing in. The link is valid for 24 hours.
            </p>
          </div>

          {isStubbed && (
            <div className="text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-3 text-amber-900">
              <p className="font-semibold mb-1">Dev mode — email is stubbed.</p>
              <p>
                Grab the link from the terminal running <code>npm run dev</code>{' '}
                or from <code>tmp/magic-links.log</code>. See{' '}
                <code>STUBS.md</code> entry #1.
              </p>
            </div>
          )}

          <p className="text-center text-xs text-gray-400 mt-6">
            Wrong email? <a href="/login" className="text-amber-700 hover:underline">Try again</a>
          </p>
        </div>
      </div>
    </div>
  );
}
