#!/usr/bin/env node
/**
 * One-shot import: personal-v1 transformation tracker → pfd-saas.
 *
 * Source: ~/Desktop/personal-finance-dashboard/personal-finance.db (SQLite).
 * Target: pfd-saas Postgres (DATABASE_URL from .env.local).
 * Owner:  vaspar@gmail.com (looked up by email at the start).
 *
 * Idempotent: skipped if vaspar already has transformation_plans rows
 * (same pattern as scripts/seed-demo.mjs's guardSection). Re-running
 * with existing data is a no-op.
 *
 * Side effect: flips vaspar's user_preferences.habits_enabled = true
 * so the Personal sidebar section appears.
 */

import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import postgres from 'postgres';
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';

const SOURCE_DB = '/Users/bharath/Desktop/personal-finance-dashboard/personal-finance.db';
const OWNER_EMAIL = 'vaspar@gmail.com';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not set (check .env.local)');
  process.exit(2);
}
if (!existsSync(SOURCE_DB)) {
  console.error(`ERROR: source DB not found at ${SOURCE_DB}`);
  process.exit(2);
}

// SQLite source (read-only — opening with readonly:true would be ideal but
// better-sqlite3 needs write to read WAL; the file is committed in personal-v1).
const src = new Database(SOURCE_DB, { fileMustExist: true });

// Postgres target.
const sql = postgres(DATABASE_URL, { max: 4, prepare: false });

// ─── helpers ───────────────────────────────────────────────────────
function epochToDate(unix) {
  if (unix == null) return null;
  const n = Number(unix);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000);
}

// ─── find owner ────────────────────────────────────────────────────
console.log(`Importing transformation data for: ${OWNER_EMAIL}`);
const users = await sql`SELECT id FROM "user" WHERE email = ${OWNER_EMAIL} LIMIT 1`;
if (users.length === 0) {
  console.error(`ERROR: no user found with email ${OWNER_EMAIL}.`);
  console.error('Sign in once with that email so the auth row exists, then re-run.');
  await sql.end();
  src.close();
  process.exit(1);
}
const userId = users[0].id;
console.log(`  Found vaspar.id=${userId}`);

// ─── idempotency check ─────────────────────────────────────────────
const existingPlans = await sql`
  SELECT id FROM transformation_plans WHERE user_id = ${userId} LIMIT 1
`;
if (existingPlans.length > 0) {
  console.log(
    `  Already imported (transformation_plans has ${existingPlans.length} row for vaspar). Skipping.`,
  );
  await sql.end();
  src.close();
  process.exit(0);
}

// ─── read all source rows ──────────────────────────────────────────
const srcPlans = src.prepare('SELECT * FROM transformation_plans').all();
const srcSections = src.prepare('SELECT * FROM transformation_sections').all();
const srcItems = src.prepare('SELECT * FROM transformation_items').all();
const srcDays = src.prepare('SELECT * FROM transformation_days').all();
const srcChecks = src.prepare('SELECT * FROM transformation_checks').all();

console.log(
  `  Read source: ${srcPlans.length} plans, ${srcSections.length} sections, ` +
    `${srcItems.length} items, ${srcDays.length} days, ${srcChecks.length} checks.`,
);

// ─── insert in dependency order, building id mappings ──────────────
const planIdMap = new Map(); // src.id → pg.id
const sectionIdMap = new Map();
const itemIdMap = new Map();
const dayIdMap = new Map();

let importedPlans = 0;
let importedSections = 0;
let importedItems = 0;
let importedDays = 0;
let importedChecks = 0;

for (const p of srcPlans) {
  const created = epochToDate(p.created_at) ?? new Date();
  const updated = epochToDate(p.updated_at) ?? created;
  const inserted = await sql`
    INSERT INTO transformation_plans
      (user_id, name, start_date, day_count, start_weight_kg, goal_weight_kg,
       daily_calorie_target, daily_protein_target_g, notes, created_at, updated_at)
    VALUES
      (${userId}, ${p.name}, ${p.start_date}, ${p.day_count},
       ${p.start_weight_kg}, ${p.goal_weight_kg},
       ${p.daily_calorie_target}, ${p.daily_protein_target_g},
       ${p.notes}, ${created}, ${updated})
    RETURNING id
  `;
  planIdMap.set(p.id, inserted[0].id);
  importedPlans += 1;
}

for (const s of srcSections) {
  const planId = planIdMap.get(s.plan_id);
  if (!planId) continue;
  const created = epochToDate(s.created_at) ?? new Date();
  const deletedAt = epochToDate(s.deleted_at);
  const inserted = await sql`
    INSERT INTO transformation_sections
      (user_id, plan_id, name, sort_order, deleted_at, created_at)
    VALUES
      (${userId}, ${planId}, ${s.name}, ${s.sort_order},
       ${deletedAt}, ${created})
    RETURNING id
  `;
  sectionIdMap.set(s.id, inserted[0].id);
  importedSections += 1;
}

for (const it of srcItems) {
  const sectionId = sectionIdMap.get(it.section_id);
  if (!sectionId) continue;
  const created = epochToDate(it.created_at) ?? new Date();
  const deletedAt = epochToDate(it.deleted_at);
  const inserted = await sql`
    INSERT INTO transformation_items
      (user_id, section_id, label, sort_order, kind, options,
       deleted_at, created_at)
    VALUES
      (${userId}, ${sectionId}, ${it.label}, ${it.sort_order},
       ${it.kind ?? 'check'}, ${it.options},
       ${deletedAt}, ${created})
    RETURNING id
  `;
  itemIdMap.set(it.id, inserted[0].id);
  importedItems += 1;
}

for (const d of srcDays) {
  const planId = planIdMap.get(d.plan_id);
  if (!planId) continue;
  const created = epochToDate(d.created_at) ?? new Date();
  const updated = epochToDate(d.updated_at) ?? created;
  const inserted = await sql`
    INSERT INTO transformation_days
      (user_id, plan_id, date, day_number, current_weight_kg, journal,
       created_at, updated_at)
    VALUES
      (${userId}, ${planId}, ${d.date}, ${d.day_number},
       ${d.current_weight_kg}, ${d.journal},
       ${created}, ${updated})
    RETURNING id
  `;
  dayIdMap.set(d.id, inserted[0].id);
  importedDays += 1;
}

for (const c of srcChecks) {
  const dayId = dayIdMap.get(c.day_id);
  const itemId = itemIdMap.get(c.item_id);
  if (!dayId || !itemId) continue;
  const estimatedAt = epochToDate(c.estimated_at);
  await sql`
    INSERT INTO transformation_checks
      (user_id, day_id, item_id, checked, text_value,
       estimated_calories, estimated_protein_g, estimation_input,
       estimated_at)
    VALUES
      (${userId}, ${dayId}, ${itemId},
       ${c.checked === 1 || c.checked === true},
       ${c.text_value},
       ${c.estimated_calories}, ${c.estimated_protein_g},
       ${c.estimation_input}, ${estimatedAt})
  `;
  importedChecks += 1;
}

// ─── flip habits_enabled = true ────────────────────────────────────
await sql`
  UPDATE user_preferences
  SET habits_enabled = true, updated_at = NOW()
  WHERE user_id = ${userId}
`;

// ─── summary ───────────────────────────────────────────────────────
console.log('');
console.log(
  `Imported ${importedPlans} plans, ${importedSections} sections, ` +
    `${importedItems} items, ${importedDays} days, ${importedChecks} checks.`,
);
console.log(`  habits_enabled = true for ${OWNER_EMAIL}`);

await sql.end();
src.close();
