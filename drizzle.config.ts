import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';

// Next.js convention: secrets in .env.local for dev, real env vars in prod.
config({ path: '.env.local' });
config(); // also read .env if present, lower-priority

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL is not set — see .env.local');
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
});
