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

export const { handlers, signIn, signOut, auth } = NextAuth({
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

/**
 * EmailProvider builder. Two modes:
 *
 *   - EMAIL_SERVER set  →  real SMTP. Pass the env var straight through
 *                          to Nodemailer; Auth.js's default
 *                          sendVerificationRequest formats + sends a
 *                          real email. Tested with Gmail SMTP (see
 *                          README for app-password setup).
 *   - EMAIL_SERVER empty → stub. jsonTransport keeps Nodemailer happy;
 *                          our override logs the link to stdout and
 *                          tmp/magic-links.log.
 *
 * The mode flips at boot, not per-request — restart the dev/prod server
 * after toggling the env var.
 */
function buildEmailProvider() {
  const emailServer = process.env.EMAIL_SERVER?.trim();
  const from = process.env.EMAIL_FROM ?? 'noreply@pfd-saas.local';

  if (emailServer) {
    // Real SMTP path. Auth.js handles the send with its default
    // sendVerificationRequest (sensible-looking HTML body + plain-text
    // fallback). No stub.
    return Nodemailer({ server: emailServer, from });
  }

  // Stub path — log instead of send. Override sendVerificationRequest
  // entirely so Nodemailer's transport machinery never runs.
  return Nodemailer({
    server: { jsonTransport: true },
    from,
    async sendVerificationRequest({ identifier, url }) {
      const ts = new Date().toISOString();
      const banner = '═'.repeat(72);
      console.log(`\n${banner}`);
      console.log(`🔑  MAGIC LINK (stub — no email sent)`);
      console.log(`    to:  ${identifier}`);
      console.log(`    url: ${url}`);
      console.log(`${banner}\n`);
      try {
        fs.mkdirSync(path.dirname(STUB_LOG), { recursive: true });
        fs.appendFileSync(STUB_LOG, JSON.stringify({ ts, identifier, url }) + '\n');
      } catch (err) {
        console.error('[auth-stub] could not write magic-links.log:', err);
      }
    },
  });
}
