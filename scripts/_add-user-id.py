#!/usr/bin/env python3
"""
Sprint 1 Phase 2 helper. Adds user_id FK + index to every multi-tenant
pgTable in src/db/schema.ts. Throwaway — delete after Phase 2 lands.

Exclusions (5 tables, kept user_id-free):
  users               (auth)
  accounts            (auth — junction)
  sessions            (auth)
  verificationTokens  (auth)
  sacCodes            (global GST reference, shared across tenants)

For each remaining pgTable(...) declaration this script:
  1. Inserts a `userId` text FK column (NULLABLE in Phase 2 so the build
     stays green while INSERTs haven't been updated; Phase 4 stamps
     userId on every insert and a follow-up migration tightens to
     NOT NULL) right before the column block's closing `}`.
  2. Adds `index('<snake>_user_id_idx').on(table.userId)`:
     - append to the existing `(table) => [...]` callback if present
     - otherwise convert the closing `});` into a new callback containing
       only this index

Assumes:
  - Every non-excluded pgTable opens with `export const NAME = pgTable('snake',`
    on a single line (verified by grep before running).
  - `{` and `}` only appear in code, not inside strings or comments.
  - Existing callbacks use the array-return form `(table) => [...]` with
    `]);` (or `])`) on its own line.

Run from /Users/bharath/Desktop/pfd-saas:
  python3 scripts/_add-user-id.py
"""

import re
import sys
from pathlib import Path

SCHEMA = Path('src/db/schema.ts')
EXCLUDED = {'users', 'accounts', 'sessions', 'verificationTokens', 'sacCodes'}

USERID_LINE = "  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),"


def make_index_line(snake_name: str) -> str:
    return f"  index('{snake_name}_user_id_idx').on(table.userId),"


def main() -> None:
    src = SCHEMA.read_text().split('\n')
    out: list[str] = []
    i = 0
    seen = 0
    modified = 0
    excluded_hits: list[str] = []

    while i < len(src):
        line = src[i]
        m = re.match(r"^export const (\w+) = pgTable\(", line)
        if not m:
            out.append(line)
            i += 1
            continue

        seen += 1
        var_name = m.group(1)

        snake_match = re.search(r"pgTable\('(\w+)'", line)
        if snake_match:
            snake_name = snake_match.group(1)
        else:
            snake_match = re.search(r"'(\w+)'", src[i + 1])
            if not snake_match:
                sys.exit(f"ERROR: no snake name for {var_name} at line {i + 1}")
            snake_name = snake_match.group(1)

        if var_name in EXCLUDED:
            excluded_hits.append(var_name)
            out.append(line)
            i += 1
            continue

        # Collect the entire pgTable(...) block by paren-depth.
        # We start at depth 1 immediately after the `pgTable(` on this line.
        rest_of_first = line[line.index('pgTable(') + len('pgTable('):]
        paren_depth = 1
        for ch in rest_of_first:
            if ch == '(':
                paren_depth += 1
            elif ch == ')':
                paren_depth -= 1

        block = [line]
        j = i + 1
        while paren_depth > 0 and j < len(src):
            block.append(src[j])
            for ch in src[j]:
                if ch == '(':
                    paren_depth += 1
                elif ch == ')':
                    paren_depth -= 1
            j += 1

        if paren_depth != 0:
            sys.exit(f"ERROR: unterminated pgTable for {var_name} at line {i + 1}")

        # Locate the column-block close line: where brace depth returns to 0.
        brace_depth = 0
        started = False
        col_close_idx: int | None = None
        for k, bl in enumerate(block):
            for ch in bl:
                if ch == '{':
                    brace_depth += 1
                    started = True
                elif ch == '}':
                    brace_depth -= 1
                    if started and brace_depth == 0:
                        col_close_idx = k
                        break
            if col_close_idx is not None:
                break

        if col_close_idx is None:
            sys.exit(f"ERROR: no column-block close for {var_name}")

        # Does this table already have a `(table) => [` callback?
        rest = '\n'.join(block[col_close_idx:])
        has_callback = bool(re.search(r"\},\s*\(\w+\)\s*=>\s*\[", rest))

        new_block = list(block)

        # Insert userId column before the column-close line.
        new_block.insert(col_close_idx, USERID_LINE)
        col_close_idx += 1

        idx_line = make_index_line(snake_name)

        if has_callback:
            cb_close_idx: int | None = None
            for k in range(col_close_idx, len(new_block)):
                if re.match(r"^\s*\]\s*\)\s*;?\s*$", new_block[k]):
                    cb_close_idx = k
                    break
            if cb_close_idx is None:
                sys.exit(f"ERROR: no callback close `])` for {var_name}")
            new_block.insert(cb_close_idx, idx_line)
        else:
            cl = new_block[col_close_idx].strip()
            if re.match(r"^\}\)\s*;?\s*$", cl):
                has_semi = cl.endswith(';')
                trailing = ';' if has_semi else ''
                new_block[col_close_idx:col_close_idx + 1] = [
                    "}, (table) => [",
                    idx_line,
                    f"]){trailing}",
                ]
            else:
                sys.exit(f"ERROR: unexpected close for {var_name}: {cl!r}")

        out.extend(new_block)
        modified += 1
        i = j

    SCHEMA.write_text('\n'.join(out))
    print(f"Tables seen:   {seen}")
    print(f"Tables excluded ({len(excluded_hits)}): {sorted(excluded_hits)}")
    print(f"Tables modified: {modified}")
    print(f"Expected modified = seen - excluded = {seen - len(excluded_hits)}")
    if modified != seen - len(excluded_hits):
        sys.exit("ERROR: modified count does not match (seen - excluded).")


if __name__ == '__main__':
    main()
