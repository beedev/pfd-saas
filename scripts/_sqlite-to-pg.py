#!/usr/bin/env python3
"""
One-shot converter: src/db/schema.ts using sqliteTable → pgTable equivalents.
Throwaway script — delete after Sprint 1 lands.

Conversions applied:
  1. Import line: sqliteTable/sqlite-core → pgTable/pg-core (plus timestamp,
     boolean, serial helpers).
  2. sqliteTable( → pgTable(
  3. integer('x', { mode: 'boolean' }) → boolean('x')
  4. integer('x', { mode: 'timestamp' }) → timestamp('x', { mode: 'date' })
  5. .default(sql`(unixepoch())`) → .defaultNow()
  6. integer('id').primaryKey({ autoIncrement: true }) → serial('id').primaryKey()
  7. Plain integer epoch columns (no mode) with unixepoch default: also
     promoted to timestamp.
"""

import re
import sys
from pathlib import Path

src = Path('src/db/schema.ts').read_text()
original_len = len(src)

# 1. Imports
src = src.replace(
    "import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';",
    "import { pgTable, text, integer, real, index, uniqueIndex, timestamp, boolean, serial } from 'drizzle-orm/pg-core';",
)

# 2. sqliteTable → pgTable (function call name only)
src = src.replace('sqliteTable(', 'pgTable(')

# 3. integer('x', { mode: 'boolean' }) → boolean('x')
src = re.sub(
    r"integer\((['\"][^'\"]*['\"])\s*,\s*\{\s*mode:\s*'boolean'\s*\}\)",
    r"boolean(\1)",
    src,
)

# 4. integer('x', { mode: 'timestamp' }) → timestamp('x', { mode: 'date' })
src = re.sub(
    r"integer\((['\"][^'\"]*['\"])\s*,\s*\{\s*mode:\s*'timestamp'\s*\}\)",
    r"timestamp(\1, { mode: 'date' })",
    src,
)

# 5. .default(sql`(unixepoch())`) → .defaultNow()
src = re.sub(
    r"\.default\(sql`\(unixepoch\(\)\)`\)",
    r".defaultNow()",
    src,
)

# 6. Plain integer with unixepoch default (no mode) → timestamp
# After step 5, these read: integer('xxx').defaultNow()
# Convert: integer('xxx').defaultNow() → timestamp('xxx', { mode: 'date' }).defaultNow()
src = re.sub(
    r"integer\((['\"][^'\"]*['\"])\)\.defaultNow\(\)",
    r"timestamp(\1, { mode: 'date' }).defaultNow()",
    src,
)
# Same with .notNull() after
src = re.sub(
    r"integer\((['\"][^'\"]*['\"])\)\.notNull\(\)\.defaultNow\(\)",
    r"timestamp(\1, { mode: 'date' }).notNull().defaultNow()",
    src,
)

# 7. integer('id').primaryKey({ autoIncrement: true }) → serial('id').primaryKey()
src = re.sub(
    r"integer\((['\"][^'\"]*['\"])\)\.primaryKey\(\{\s*autoIncrement:\s*true\s*\}\)",
    r"serial(\1).primaryKey()",
    src,
)

# Sanity: there should be NO sqliteTable or unixepoch left
leftover_sqlite = src.count('sqliteTable')
leftover_unix = src.count('unixepoch')
print(f"  sqliteTable leftover: {leftover_sqlite}")
print(f"  unixepoch leftover:   {leftover_unix}")
print(f"  pgTable count:        {src.count('pgTable')}")
print(f"  timestamp count:      {src.count('timestamp(')}")
print(f"  boolean count:        {src.count('boolean(')}")
print(f"  serial count:         {src.count('serial(')}")
print(f"  size: {original_len} → {len(src)} bytes")

if leftover_sqlite or leftover_unix:
    print("\nUnconverted patterns found. Manual fix required.")
    sys.exit(1)

Path('src/db/schema.ts').write_text(src)
print("\n✓ Written.")
