/**
 * Edge-safe Auth.js v5 config — middleware imports this, not auth.ts.
 *
 * Anything that pulls Node APIs (fs, path, postgres-js client, the
 * Nodemailer provider) lives in auth.ts. This file is intentionally
 * minimal: just session strategy, pages, providers list (empty for
 * middleware purposes — auth.ts overrides with real providers).
 *
 * The middleware only needs to know "is there a session?" — it does
 * not need the adapter to answer that, because Auth.js can verify the
 * session-token cookie's signature at the edge using AUTH_SECRET.
 */

import type { NextAuthConfig } from 'next-auth';

export default {
  providers: [],
  session: { strategy: 'database' },
  trustHost: true,
  pages: {
    signIn: '/login',
    verifyRequest: '/login/check-email',
  },
} satisfies NextAuthConfig;
