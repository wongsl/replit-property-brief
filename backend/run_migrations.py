#!/usr/bin/env python3
"""
Robust migration startup script.

History: Several failed deployments left the production DB in a state where
migrations 0006-0008 are recorded in django_migrations but the actual schema
changes were dropped by reverse-migration SQL. We fix this by:
  1. Running all known DDL idempotently (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
  2. Marking each of those migrations as applied directly in django_migrations
     via INSERT ... ON CONFLICT DO NOTHING — this never touches newer migrations.
  3. Running `migrate` normally to apply any genuinely new migrations.

WARNING: Do NOT use `migrate app version --fake` — it unapplies newer migrations
that may already be recorded, causing them to re-run and fail on duplicate objects.
"""
import subprocess
import sys
import os
import psycopg2
from datetime import datetime, timezone

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

# Migration 0009: document owner/created_at indexes
cur.execute("CREATE INDEX IF NOT EXISTS doc_owner_created_idx ON documents (owner_id, created_at DESC);")
cur.execute("CREATE INDEX IF NOT EXISTS doc_team_created_idx  ON documents (team_id, is_private, created_at DESC);")

# Migration 0010: composite indexes on folders, team_join_requests, credit_requests, credit_transactions
cur.execute("CREATE INDEX IF NOT EXISTS folder_owner_archived_idx  ON folders (owner_id, is_archived);")
cur.execute("CREATE INDEX IF NOT EXISTS joinreq_user_status_idx    ON team_join_requests (user_id, status);")
cur.execute("CREATE INDEX IF NOT EXISTS joinreq_team_status_idx    ON team_join_requests (team_id, status);")
cur.execute("CREATE INDEX IF NOT EXISTS creditreq_user_status_idx  ON credit_requests (user_id, status);")
cur.execute("CREATE INDEX IF NOT EXISTS credittx_user_created_idx  ON credit_transactions (user_id, created_at DESC);")

print("Schema patch complete.", flush=True)

# ── Step 2: mark migrations 0006-0010 as applied if not already recorded ──
# Insert each record only if it isn't already present. We do NOT use
# `migrate --fake` to a specific version because that unapplies any newer
# migrations that are already recorded, causing them to re-run and crash
# on duplicate indexes/tables.
migrations_to_ensure = [
    "0006_folder_favorited_by",
    "0007_folder_is_archived",
    "0008_combinedanalysis_favorited_by",
    "0009_document_owner_created_at_indexes",
    "0010_composite_indexes",
]
now = datetime.now(timezone.utc)
for name in migrations_to_ensure:
    cur.execute(
        "SELECT 1 FROM django_migrations WHERE app='documents' AND name=%s",
        (name,),
    )
    if cur.fetchone() is None:
        cur.execute(
            "INSERT INTO django_migrations (app, name, applied) VALUES ('documents', %s, %s);",
            (name, now),
        )
        print(f"Recorded missing migration: documents.{name}", flush=True)
    else:
        print(f"Already recorded: documents.{name}", flush=True)

cur.close()
conn.close()

# ── Step 3: run any remaining pending migrations ──
run("python3.11 manage.py migrate")

print("All migrations complete.", flush=True)
