/**
 * Module augmentation — narrows Auth.js v5 Session.user.id to a required
 * string. With `session: { strategy: 'database' }` and the Drizzle
 * adapter (see src/auth.ts), the session-token cookie always resolves to
 * a row in the `session` table joined to a row in `user`, so user.id is
 * guaranteed populated by the time any handler sees the session.
 *
 * Without this augmentation, every Drizzle `eq(table.userId, session.user.id)`
 * fails because `eq`'s second arg can't be `undefined`. With it, callers
 * just guard `if (!session?.user) return 401` and TS knows `user.id` is
 * a string.
 */
import 'next-auth';
// import unused but required for module augmentation to attach.

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}
