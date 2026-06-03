/**
 * Auth.js v5 — Node-side configuration for pfd-saas.
 *
 * Pairs with auth.config.ts (Edge-safe). This file pulls in the
 * DrizzleAdapter, the Nodemailer provider, and the magic-link stub
 * logger — all of which use Node APIs and cannot live in an
 * Edge bundle.
 *
 * Strategy: passwordless email magic-link, database-backed sessions.
 *
 * Email delivery is STUBBED — see STUBS.md #1. sendVerificationRequest
 * logs the link to stdout and appends it to tmp/magic-links.log instead
 * of hitting an SMTP server. Replace with a real provider in Sprint 5.
 *
 * Exports the Auth.js v5 trio: `handlers` (for the catch-all route),
 * `signIn` / `signOut` (server actions / client helpers), and `auth`
 * (session reader for server components and route handlers).
 */

import NextAuth from 'next-auth';
import Nodemailer from 'next-auth/providers/nodemailer';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import fs from 'node:fs';
import path from 'node:path';

import { db } from '@/db';
import { users, accounts, sessions, verificationTokens } from '@/db';
import authConfig from './auth.config';

const STUB_LOG = path.join(process.cwd(), 'tmp', 'magic-links.log');

// ─── Sprint 6.1.5 — In-memory cache for pending magic links ──────────
// Lives only inside the Node process. Single-instance only, which is
// exactly the topology of the Docker self-host: one container, one
// Node process, one cache. 5-minute TTL matches the typical magic-link
// freshness window. Single-use: consumePendingLink() removes the entry.
//
// Production SaaS (multi-instance) should set MAGIC_LINK_DISPLAY=email
// so this cache path is bypassed entirely.
interface PendingLink {
  url: string;
  email: string;
  expiresAt: number;
}
const pendingLinks = new Map<string, PendingLink>();

function pruneExpiredLinks() {
  const now = Date.now();
  for (const [key, link] of pendingLinks) {
    if (link.expiresAt < now) pendingLinks.delete(key);
  }
}

/**
 * Pull (and consume) a recently-issued magic link out of the in-memory
 * cache. Returns null if none is pending for that email or it has
 * expired. Single-use — the caller is the only legitimate consumer.
 *
 * Called by the /api/auth/pending-link route handler.
 */
export function consumePendingLink(email: string): PendingLink | null {
  pruneExpiredLinks();
  const link = pendingLinks.get(email);
  if (!link) return null;
  pendingLinks.delete(email);
  return link;
}

const _nextAuth = NextAuth({
  ...authConfig,
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [
    buildEmailProvider(),
  ],
});

export const { handlers, signIn, signOut } = _nextAuth;
const _realAuth = _nextAuth.auth;

/**
 * Dev-only auth bypass for smoke testing.
 *
 * When ALL three conditions hold, returns a synthetic session for the
 * user id in the header — without hitting NextAuth, without consulting
 * the sessions table:
 *
 *   1. NODE_ENV !== 'production'   — never works in prod, full stop
 *   2. DEV_AUTH_BYPASS === 'true'  — opt-in via env (off by default)
 *   3. Request carries `x-dev-as-user: <user_id>`
 *
 * Anything missing → falls through to real NextAuth. The header is
 * stripped at the edge of `auth()` so downstream code can't observe
 * whether the bypass was used.
 *
 * Designed for `scripts/smoke-test-*.mjs` to exercise auth-gated
 * routes end-to-end. NOT a feature flag — pair with a fresh-rotated
 * `DEV_AUTH_BYPASS=true` only when you're actively testing, then
 * unset.
 */
// Auth.js v5's exported `auth` is callable both as a route handler
// wrapper AND as `await auth()`. We only need the no-arg session-read
// shape — the few wrapper call sites in this codebase still go to the
// real implementation via the proxy below.
export const auth = (async (...args: unknown[]) => {
  if (
    process.env.NODE_ENV !== 'production' &&
    process.env.DEV_AUTH_BYPASS === 'true' &&
    args.length === 0
  ) {
    // next/headers is server-only; safe to import inline here.
    const { headers } = await import('next/headers');
    const h = await headers();
    const userId = h.get('x-dev-as-user');
    if (userId) {
      // The cast goes through `unknown` because NextAuth's exported
      // `auth` is an overloaded callable (route-wrapper + session-reader)
      // and its `Awaited<ReturnType<>>` widens to include
      // NextMiddleware-shaped variants we never use.
      return {
        user: { id: userId, email: 'dev-bypass@local', name: 'Dev Bypass' },
        expires: new Date(Date.now() + 60_000).toISOString(),
      } as unknown as Awaited<ReturnType<typeof _realAuth>>;
    }
  }
  // @ts-expect-error — Auth.js's overloaded signature; pass-through.
  return _realAuth(...args);
}) as typeof _realAuth;

/**
 * EmailProvider builder.
 *
 * MAGIC_LINK_DISPLAY env var selects the delivery mode (Sprint 6.1.5):
 *
 *   - 'ui'    → stash the URL in the in-memory pendingLinks cache so
 *               the /login/check-email page can surface it via
 *               /api/auth/pending-link. Also log to stdout and
 *               tmp/magic-links.log so testers can grab it from
 *               `docker logs`. Default for the Docker self-host image.
 *   - 'email' → real SMTP via Nodemailer (requires EMAIL_SERVER set).
 *               Production SaaS path. Identical behaviour to the
 *               pre-6.1.5 code.
 *   - 'both'  → UI surfacing AND SMTP. Useful for demos where the
 *               tester also wants the email-flow muscle memory.
 *
 * If EMAIL_SERVER is unset, mode falls back to 'ui' even when 'email'
 * is requested — there is nothing to send to.
 *
 * The mode flips at boot, not per-request — restart the server after
 * toggling.
 */
type MagicLinkDisplay = 'ui' | 'email' | 'both';

function buildEmailProvider() {
  const emailServer = process.env.EMAIL_SERVER?.trim();
  const from = process.env.EMAIL_FROM ?? 'noreply@pfd-saas.local';
  const requestedMode = (process.env.MAGIC_LINK_DISPLAY ?? 'ui').toLowerCase() as MagicLinkDisplay;
  const hasEmailServer = !!emailServer;

  // Resolve effective mode. 'email' without EMAIL_SERVER → fall back to
  // 'ui' so the user isn't silently dropped. 'both' without
  // EMAIL_SERVER → just 'ui'.
  const effectiveMode: MagicLinkDisplay =
    (requestedMode === 'email' || requestedMode === 'both') && !hasEmailServer
      ? 'ui'
      : requestedMode;

  // Pure 'email' mode: delegate entirely to Auth.js's default
  // sendVerificationRequest (real SMTP send, no UI surfacing, no stub
  // log). This preserves the pre-6.1.5 production behaviour exactly.
  if (effectiveMode === 'email') {
    return Nodemailer({ server: emailServer, from });
  }

  // 'ui' or 'both' — override sendVerificationRequest so we can stash
  // the URL in the pendingLinks cache and (optionally) chain to Auth.js's
  // default for the SMTP send.
  return Nodemailer({
    // jsonTransport keeps Nodemailer happy without ever actually
    // sending when we're not delegating to the default below.
    server: effectiveMode === 'both' && emailServer ? emailServer : { jsonTransport: true },
    from,
    async sendVerificationRequest(params) {
      const { identifier, url } = params;
      const normalizedEmail = identifier.toLowerCase().trim();

      // Stash for /api/auth/pending-link to surface in the UI.
      const expiresAt = Date.now() + 5 * 60 * 1000; // 5 min TTL
      pendingLinks.set(normalizedEmail, { url, email: normalizedEmail, expiresAt });

      // Console + tmp/magic-links.log (always, for debuggability).
      const ts = new Date().toISOString();
      const banner = '═'.repeat(72);
      console.log(`\n${banner}`);
      console.log(`🔑  MAGIC LINK (mode: ${effectiveMode})`);
      console.log(`    to:  ${identifier}`);
      console.log(`    url: ${url}`);
      console.log(`${banner}\n`);
      try {
        fs.mkdirSync(path.dirname(STUB_LOG), { recursive: true });
        fs.appendFileSync(STUB_LOG, JSON.stringify({ ts, identifier, url, mode: effectiveMode }) + '\n');
      } catch (err) {
        console.error('[auth] could not write magic-links.log:', err);
      }

      // 'both' — also fire the real SMTP send. We construct a one-off
      // Nodemailer provider just to borrow Auth.js's default
      // sendVerificationRequest implementation. Less code than
      // reimplementing the email body here, and stays in sync with
      // upstream changes to the email template.
      if (effectiveMode === 'both' && hasEmailServer) {
        const defaultProvider = Nodemailer({ server: emailServer, from });
        const defaultSend = defaultProvider.sendVerificationRequest;
        if (typeof defaultSend === 'function') {
          try {
            await defaultSend(params);
          } catch (err) {
            console.error('[auth] SMTP send failed (mode=both):', err);
          }
        }
      }
    },
  });
}
