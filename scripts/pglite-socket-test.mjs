// Linchpin test: does the app's postgres-js client work against PGlite over a
// local Postgres-wire socket? If yes, the desktop build needs ZERO db-code
// change — same client, same DATABASE_URL, PGlite is invisible to the app.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import postgres from 'postgres';

const DATA_DIR = '/private/tmp/claude-503/-Users-bharath-Desktop-pfd-saas/2db5f0dc-3524-4f66-9f4b-fbeeea0e9cb0/scratchpad/pglite-data';
const PORT = 5433;

const pg = new PGlite(DATA_DIR);
await pg.waitReady;
const server = new PGLiteSocketServer({ db: pg, port: PORT, host: '127.0.0.1' });
await server.start();
console.log(`PGLiteSocketServer up on 127.0.0.1:${PORT}`);

// The app's exact client config (src/db/index.ts): prepare:false, small pool.
const sql = postgres({
  host: '127.0.0.1', port: PORT, database: 'postgres', username: 'postgres',
  prepare: false, max: 1, idle_timeout: 20, connect_timeout: 10,
});

let ok = true;
try {
  const one = await sql`SELECT 1 AS x`;
  console.log('  SELECT 1        =>', JSON.stringify(one[0]));

  const users = await sql`SELECT count(*)::int AS n FROM "user"`;
  console.log('  count(users)    =>', JSON.stringify(users[0]));

  // Parameterized query — exercises the extended protocol Drizzle relies on.
  const uid = (await sql`SELECT id FROM "user" LIMIT 1`)[0].id;
  const gold = await sql`
    SELECT type, grams, round(current_value/100.0,0)::int AS cur_rs
    FROM gold_holdings WHERE user_id = ${uid}`;
  console.log('  param query      =>', JSON.stringify(gold[0]));

  // A write, to prove the full round-trip (insert + returning).
  const nid = crypto.randomUUID();
  const ins = await sql`
    INSERT INTO "user" (id, email, name) VALUES (${nid}, ${'socket@pfd.app'}, ${'Socket User'})
    RETURNING email`;
  console.log('  insert returning =>', JSON.stringify(ins[0]));
} catch (e) {
  ok = false;
  console.error('  ✗ query failed:', e.message);
} finally {
  await sql.end({ timeout: 5 });
  await server.stop();
  await pg.close();
}
console.log(ok ? '\n✅ postgres-js ↔ PGlite-over-socket WORKS — zero app-code change path is viable.'
              : '\n❌ socket path failed — fall back to the drizzle-orm/pglite driver swap.');
process.exit(ok ? 0 : 1);
