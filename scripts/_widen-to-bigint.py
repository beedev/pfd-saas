#!/usr/bin/env python3
"""
One-shot: widen money columns from `integer(...)` to `bigint(..., { mode: 'number' })`
in src/db/schema.ts. Throwaway — delete after Sprint 1.5 Phase 2 lands.

Why: SQLite's INTEGER is loose-typed (accepts arbitrary precision). Postgres
`integer` is strict int32 (max ~2.1 billion). Personal v1 stored property
values up to 5e9 paisa (₹5 cr); inserting into pfd-saas `integer` blew up.

Convention: every column holding rupees or paisa → bigint. Counters, IDs,
ages, durations, and small constants stay integer. Auth.js's `expires_at`
stays integer per Auth.js standard.

Run from /Users/bharath/Desktop/pfd-saas:
  python3 scripts/_widen-to-bigint.py
"""

import re
import sys
from pathlib import Path

SCHEMA = Path('src/db/schema.ts')

# Columns that intentionally STAY integer (non-money).
KEEP_INTEGER = {
    # Foreign-key references (small int IDs from serial PKs)
    'asset_id', 'category_id', 'chit_fund_id', 'customer_id', 'deduction_id',
    'goal_id', 'invoice_id', 'liability_id', 'linked_asset_id',
    'mutual_fund_id', 'original_invoice_id', 'rule_id', 'source_id',
    'vendor_id',
    # Ages (years)
    'current_age', 'target_age', 'ladder_start_age',
    'retirement_duration_years',
    # Periods / counters
    'cooldown_hours',
    'duration_months', 'tenure_months', 'remaining_tenor',
    'policy_term', 'premium_payment_term',
    'group_size', 'installments_paid',
    'month_number', 'win_month',
    # UI / metadata
    'sort_order', 'file_size',
    # Stock volume (shares, not money)
    'volume',
    # Auth.js OAuth token expiry epoch — keep int per Auth.js convention
    'expires_at',
    # Retirement calc is in rupees not paisa, ceiling far below int32
    'monthly_expense_rupees',
}


def main() -> None:
    src = SCHEMA.read_text()

    promoted: list[str] = []
    kept: list[str] = []

    def replacer(match: re.Match) -> str:
        col = match.group(1)
        if col in KEEP_INTEGER:
            kept.append(col)
            return match.group(0)
        promoted.append(col)
        return f"bigint('{col}', {{ mode: 'number' }})"

    new_src = re.sub(r"integer\('(\w+)'\)", replacer, src)

    # Add bigint to the import list if not already there.
    if "bigint" not in new_src[: new_src.find('export')]:
        new_src = new_src.replace(
            "import { pgTable, text, integer, real, index, uniqueIndex, "
            "timestamp, boolean, serial, primaryKey }",
            "import { pgTable, text, integer, bigint, real, index, uniqueIndex, "
            "timestamp, boolean, serial, primaryKey }",
        )
        if "bigint" not in new_src[: new_src.find('export')]:
            sys.exit(
                "ERROR: could not patch pg-core import line — the literal didn't match. "
                "Update the script to match the current import statement."
            )

    SCHEMA.write_text(new_src)

    unique_promoted = sorted(set(promoted))
    unique_kept = sorted(set(kept))

    print(f"Promoted to bigint:  {len(promoted)} call sites, "
          f"{len(unique_promoted)} distinct column names")
    print(f"Kept as integer:     {len(kept)} call sites, "
          f"{len(unique_kept)} distinct column names")
    print(f"\nKept (sanity check): {', '.join(unique_kept)}")


if __name__ == '__main__':
    main()
