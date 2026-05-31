/**
 * Postgres connection for pfd-saas.
 *
 * Reads DATABASE_URL from env (must be a postgresql:// URL). Uses the
 * postgres-js client which works well with Vercel/Neon serverless, but
 * runs equally well against a local Postgres 17 for development.
 *
 * Schema is defined in ./schema.ts and shared by the Drizzle migrator
 * (drizzle.config.ts) and runtime queries here.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    'DATABASE_URL is not set. Expected a postgresql:// URL — see .env.local.',
  );
}

// Single shared connection pool for the Next.js server process. Across edge
// runtimes (Vercel functions) each invocation gets its own connection; the
// pool size of 1 is the right default for postgres-js in those cases.
const client = postgres(url, {
  max: process.env.NODE_ENV === 'production' ? 10 : 5,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false, // pgbouncer-friendly; safe to drop later if not behind one
});

export const db = drizzle(client, { schema });

export * from './schema';
