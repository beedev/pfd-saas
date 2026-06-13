#!/usr/bin/env python3
"""
Generate SQL to refresh the personal user's Transformation-tracker data in
vaspar-pfd (Postgres) from V1 (SQLite). Full replace: delete the user's
transformation rows (cascade) and re-insert everything from V1, adding user_id
and converting SQLite types (epoch int -> timestamp, 0/1 -> boolean).

Safe because the personal user is the ONLY holder of tracker data in :9999, so
V1's original integer ids can be reused without collision. Emits SQL to stdout.
"""
import sqlite3
import sys

V1_DB = '/Users/bharath/Desktop/personal-finance-dashboard/personal-finance.db'
USER = '00000000-0000-0000-0000-0000000eea5e'  # personal user

con = sqlite3.connect(V1_DB)
con.row_factory = sqlite3.Row


def lit(v):
    """SQL string literal (or NULL), single-quote-escaped."""
    if v is None:
        return 'NULL'
    return "'" + str(v).replace("'", "''") + "'"


def num(v):
    return 'NULL' if v is None else str(v)


def ts(v):
    """SQLite epoch int -> Postgres timestamp."""
    return 'NULL' if v is None else f'to_timestamp({int(v)})'


def boolean(v):
    return 'true' if v else 'false'


out = ['BEGIN;']
# Deleting the plan cascades sections/items/days/checks for this user.
out.append(f"DELETE FROM transformation_plans WHERE user_id = '{USER}';")

for r in con.execute('SELECT * FROM transformation_plans'):
    out.append(
        'INSERT INTO transformation_plans '
        '(id,name,start_date,day_count,start_weight_kg,goal_weight_kg,'
        'daily_calorie_target,daily_protein_target_g,notes,created_at,updated_at,user_id) VALUES ('
        f"{r['id']},{lit(r['name'])},{lit(r['start_date'])},{num(r['day_count'])},"
        f"{num(r['start_weight_kg'])},{num(r['goal_weight_kg'])},"
        f"{num(r['daily_calorie_target'])},{num(r['daily_protein_target_g'])},"
        f"{lit(r['notes'])},{ts(r['created_at'])},{ts(r['updated_at'])},'{USER}');"
    )

for r in con.execute('SELECT * FROM transformation_sections'):
    out.append(
        'INSERT INTO transformation_sections '
        '(id,plan_id,name,sort_order,deleted_at,created_at,user_id) VALUES ('
        f"{r['id']},{r['plan_id']},{lit(r['name'])},{num(r['sort_order'])},"
        f"{ts(r['deleted_at'])},{ts(r['created_at'])},'{USER}');"
    )

for r in con.execute('SELECT * FROM transformation_items'):
    out.append(
        'INSERT INTO transformation_items '
        '(id,section_id,label,kind,options,sort_order,deleted_at,created_at,user_id) VALUES ('
        f"{r['id']},{r['section_id']},{lit(r['label'])},{lit(r['kind'])},{lit(r['options'])},"
        f"{num(r['sort_order'])},{ts(r['deleted_at'])},{ts(r['created_at'])},'{USER}');"
    )

for r in con.execute('SELECT * FROM transformation_days'):
    out.append(
        'INSERT INTO transformation_days '
        '(id,plan_id,date,day_number,current_weight_kg,journal,created_at,updated_at,user_id) VALUES ('
        f"{r['id']},{r['plan_id']},{lit(r['date'])},{num(r['day_number'])},"
        f"{num(r['current_weight_kg'])},{lit(r['journal'])},{ts(r['created_at'])},{ts(r['updated_at'])},'{USER}');"
    )

for r in con.execute('SELECT * FROM transformation_checks'):
    out.append(
        'INSERT INTO transformation_checks '
        '(id,day_id,item_id,checked,text_value,estimated_calories,estimated_protein_g,'
        'estimation_input,estimated_at,user_id) VALUES ('
        f"{r['id']},{r['day_id']},{r['item_id']},{boolean(r['checked'])},{lit(r['text_value'])},"
        f"{num(r['estimated_calories'])},{num(r['estimated_protein_g'])},"
        f"{lit(r['estimation_input'])},{ts(r['estimated_at'])},'{USER}');"
    )

for t in ('transformation_plans', 'transformation_sections', 'transformation_items',
          'transformation_days', 'transformation_checks'):
    out.append(
        f"SELECT setval(pg_get_serial_sequence('{t}','id'), "
        f"(SELECT COALESCE(MAX(id),1) FROM {t}));"
    )

out.append('COMMIT;')
sys.stdout.write('\n'.join(out) + '\n')
