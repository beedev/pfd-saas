/**
 * GET /api/auth/pending-link?email=foo@bar.com
 *
 * Returns the magic-link URL for a recently-issued sign-in attempt iff
 * one exists in the in-memory pending-link cache (5-min TTL, see
 * src/auth.ts → pendingLinks). Single-use — calling this endpoint
 * consumes the link.
 *
 * Sprint 6.1.5 — surfaces the link in the UI when
 * MAGIC_LINK_DISPLAY=ui (Docker self-host default), so testers can
 * complete the sign-in flow without configuring SMTP.
 *
 * Security model:
 *   - Anyone who can reach this endpoint AND knows the email address
 *     gets the link. For self-host, that IS the user (single-tenant,
 *     localhost-only). Not safe for multi-tenant SaaS — production
 *     uses MAGIC_LINK_DISPLAY=email which never populates the cache.
 *   - Light per-IP throttle (one request per 800 ms) blocks trivial
 *     brute-force scans of common email addresses.
 *   - Email is normalized (lowercased + trimmed) to match the cache
 *     key written by sendVerificationRequest.
 *
 * Lives under /api/auth/* so the existing PUBLIC_PREFIXES allowlist in
 * proxy.ts lets it through without a session cookie (you can't have a
 * session yet — you're trying to start one).
 */
import { NextRequest, NextResponse } from 'next/server';
import { consumePendingLink } from '@/auth';

// Light per-IP throttle. In-memory, single-instance — perfectly aligned
// with the single-Node-process self-host topology.
const recentRequests = new Map<string, number>();

// Keep the throttle map from growing unbounded. Prune entries older
// than 60 s on every hit; cheap because Map iteration is O(n) but n is
// tiny in a single-user self-host deployment.
function pruneOldRequests(now: number) {
  const cutoff = now - 60_000;
  for (const [ip, ts] of recentRequests) {
    if (ts < cutoff) recentRequests.delete(ip);
  }
}

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  const now = Date.now();
  const last = recentRequests.get(ip) ?? 0;
  if (now - last < 800) {
    return NextResponse.json({ error: 'too_fast' }, { status: 429 });
  }
  recentRequests.set(ip, now);
  pruneOldRequests(now);

  const email = new URL(req.url).searchParams.get('email');
  if (!email) {
    return NextResponse.json({ error: 'email_required' }, { status: 400 });
  }

  // Don't disclose cache contents unless ?email matches a pending
  // entry. Normalize the same way the sender did.
  const link = consumePendingLink(email.toLowerCase().trim());
  if (!link) {
    return NextResponse.json({ error: 'no_pending_link' }, { status: 404 });
  }

  // ─── Host rewrite ───────────────────────────────────────────────────
  // Auth.js's sendVerificationRequest receives a URL built from the
  // Next.js standalone server's own bind address (HOSTNAME=0.0.0.0
  // PORT=3000), so cached URLs look like `http://0.0.0.0:3000/…` —
  // unreachable from the user's browser.
  //
  // The fix: rewrite the cached URL's host using the `Host` header
  // from the *current* request, which is the host the user's browser
  // is actually using (e.g. `localhost:3001` if the deployer mapped
  // -p 3001:3000). `req.url` itself has the wrong host for the same
  // bind-address reason, so we go to the header directly.
  //
  // Safe because auth.config.ts has `trustHost: true` — Auth.js
  // accepts callbacks at any host then verifies the cryptographic
  // token. Host rewrite doesn't widen the attack surface; it just
  // routes the same token through a host the browser can reach.
  const host = req.headers.get('host') ?? req.headers.get('x-forwarded-host');
  const proto = req.headers.get('x-forwarded-proto') ??
                (host?.includes('localhost') || host?.includes('127.0.0.1') ? 'http' : 'https');
  const rewritten = new URL(link.url);
  if (host) {
    rewritten.protocol = `${proto}:`;
    rewritten.host = host;
    const cbRaw = rewritten.searchParams.get('callbackUrl');
    if (cbRaw) {
      try {
        const cb = new URL(cbRaw);
        cb.protocol = `${proto}:`;
        cb.host = host;
        rewritten.searchParams.set('callbackUrl', cb.toString());
      } catch {
        // callbackUrl wasn't absolute — leave it alone.
      }
    }
  }

  return NextResponse.json({
    url: rewritten.toString(),
    email: link.email,
    expiresAt: new Date(link.expiresAt).toISOString(),
  });
}
