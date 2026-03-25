#!/usr/bin/env python3
"""
Robust migration startup script.

History: Several failed deployments left the production DB in a state where
migrations 0006-0008 are recorded in django_migrations but the actual schema
changes were dropped by reverse-migration SQL. We fix this by running the
missing DDL directly (idempotently), then letting Django confirm everything
is in sync.
"""
import subprocess
import sys
import os
import psycopg2

os.chdir(os.path.dirname(os.path.abspath(__file__)))


def run(cmd, check=True):
    print(f">>> {cmd}", flush=True)
    r = subprocess.run(cmd, shell=True, text=True)
    if check and r.returncode != 0:
        print(f"FAILED (exit {r.returncode})", file=sys.stderr, flush=True)
        sys.exit(r.returncode)
    return r.returncode == 0


# ── Step 1: apply any schema that may be missing due to past failed rollbacks ──
print("Applying missing schema elements...", flush=True)
conn = psycopg2.connect(os.environ["DATABASE_URL"])
conn.autocommit = True
cur = conn.cursor()

# Migration 0007: folders.is_archived column
cur.execute("""
    ALTER TABLE folders
        ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;
""")

# Migration 0006: folders_favorited_by M2M junction table
cur.execute("""
    CREATE TABLE IF NOT EXISTS folders_favorited_by (
        id        serial  PRIMARY KEY,
        folder_id integer NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
        user_id   integer NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
        UNIQUE (folder_id, user_id)
    );
""")

# Migration 0008: combined_analyses_favorited_by M2M junction table
cur.execute("""
    CREATE TABLE IF NOT EXISTS combined_analyses_favorited_by (
        id                   serial  PRIMARY KEY,
        combinedanalysis_id  integer NOT NULL REFERENCES combined_analyses(id) ON DELETE CASCADE,
        user_id              integer NOT NULL REFERENCES users(id)              ON DELETE CASCADE,
        UNIQUE (combinedanalysis_id, user_id)
    );
""")

cur.close()
conn.close()
print("Schema patch complete.", flush=True)

# ── Step 2: ensure all migration records are present (fake if not) ──
run("python3.11 manage.py migrate documents 0008 --fake", check=False)

# ── Step 3: run any remaining pending migrations ──
run("python3.11 manage.py migrate")

print("All migrations complete.", flush=True)
