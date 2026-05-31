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
    Nodemailer({
      // jsonTransport keeps Nodemailer happy without an SMTP host — it
      // serializes to a string instead of dialling out. We override
      // sendVerificationRequest below anyway, so this only satisfies
      // the provider's startup validation.
      server: { jsonTransport: true },
      from: process.env.EMAIL_FROM ?? 'noreply@pfd-saas.local',
      async sendVerificationRequest({ identifier, url }) {
        const ts = new Date().toISOString();
        const banner = '═'.repeat(72);
        // Loud-fail surface: print to dev server log so the owner can
        // grab the link without leaving the terminal.
        console.log(`\n${banner}`);
        console.log(`🔑  MAGIC LINK (stub — no email sent)`);
        console.log(`    to:  ${identifier}`);
        console.log(`    url: ${url}`);
        console.log(`${banner}\n`);
        try {
          fs.mkdirSync(path.dirname(STUB_LOG), { recursive: true });
          fs.appendFileSync(STUB_LOG, JSON.stringify({ ts, identifier, url }) + '\n');
        } catch (err) {
          // Don't block sign-in on a logging failure; the console line
          // above is the source of truth.
          console.error('[auth-stub] could not write magic-links.log:', err);
        }
      },
    }),
  ],
});
