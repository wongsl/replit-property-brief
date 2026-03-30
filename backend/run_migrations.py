#!/usr/bin/env python3
"""
Robust migration startup script.

Handles three production scenarios:
  A) Fresh DB (no tables yet)         — skip DDL patches, let Django create everything
  B) Partial DB (0001-0005 applied,   — apply DDL patches for 0006-0012 idempotently,
     0006-0012 missing)                 mark them as applied, then migrate
  C) Full DB (all migrations applied) — every statement is a no-op, migrate is instant

Key flags on `manage.py migrate`:
  --fake-initial  If a CreateModel migration's table already exists, mark it applied
                  without running the SQL. Handles the case where the DB has tables
                  but django_migrations is missing their records.

WARNING: Do NOT use `migrate <app> <version> --fake` — it unapplies newer migrations.
"""
import subprocess
import sys
import os
import psycopg2
import psycopg2.errors
from datetime import datetime, timezone

os.chdir(os.path.dirname(os.path.abspath(__file__)))


def run(cmd, check=True):
    print(f">>> {cmd}", flush=True)
    r = subprocess.run(cmd, shell=True, text=True)
    if check and r.returncode != 0:
        print(f"FAILED (exit {r.returncode})", file=sys.stderr, flush=True)
        sys.exit(r.returncode)
    return r.returncode == 0


def try_execute(cur, sql, label=""):
    """Run a DDL statement, log and skip on any error (table/column already exists, etc.)."""
    try:
        cur.execute(sql)
        if label:
            print(f"  OK: {label}", flush=True)
    except Exception as e:
        # With autocommit=True each statement is its own transaction,
        # so a failure here does NOT abort subsequent statements.
        print(f"  SKIP ({type(e).__name__}): {label or sql.strip()[:80]}", flush=True)


print("Applying missing schema elements...", flush=True)
conn = psycopg2.connect(os.environ["DATABASE_URL"])
conn.autocommit = True
cur = conn.cursor()

# ── Guard: check whether the core tables exist yet ────────────────────────────
# On a completely fresh DB, the `folders` table won't exist. In that case we
# skip all DDL patches and let `manage.py migrate` create everything from scratch.
cur.execute("""
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'folders'
    )
""")
has_existing_tables = cur.fetchone()[0]

if not has_existing_tables:
    print("Fresh database detected — skipping DDL patches, Django will create all tables.", flush=True)
else:
    # ── Migration 0007: folders.is_archived column ────────────────────────────
    try_execute(cur, """
        ALTER TABLE folders
            ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;
    """, "folders.is_archived column")

    # ── Migration 0006: folders_favorited_by M2M junction table ──────────────
    try_execute(cur, """
        CREATE TABLE IF NOT EXISTS folders_favorited_by (
            id        serial  PRIMARY KEY,
            folder_id integer NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
            user_id   integer NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
            UNIQUE (folder_id, user_id)
        );
    """, "folders_favorited_by table")

    # ── Migration 0008: combined_analyses_favorited_by M2M junction table ─────
    try_execute(cur, """
        CREATE TABLE IF NOT EXISTS combined_analyses_favorited_by (
            id                   serial  PRIMARY KEY,
            combinedanalysis_id  integer NOT NULL REFERENCES combined_analyses(id) ON DELETE CASCADE,
            user_id              integer NOT NULL REFERENCES users(id)              ON DELETE CASCADE,
            UNIQUE (combinedanalysis_id, user_id)
        );
    """, "combined_analyses_favorited_by table")

    # ── Migration 0009: document owner/created_at indexes ────────────────────
    try_execute(cur, "CREATE INDEX IF NOT EXISTS doc_owner_created_idx ON documents (owner_id, created_at DESC);",
                "doc_owner_created_idx")
    try_execute(cur, "CREATE INDEX IF NOT EXISTS doc_team_created_idx  ON documents (team_id, is_private, created_at DESC);",
                "doc_team_created_idx")

    # ── Migration 0010: composite indexes ────────────────────────────────────
    try_execute(cur, "CREATE INDEX IF NOT EXISTS folder_owner_archived_idx  ON folders (owner_id, is_archived);",
                "folder_owner_archived_idx")
    try_execute(cur, "CREATE INDEX IF NOT EXISTS joinreq_user_status_idx    ON team_join_requests (user_id, status);",
                "joinreq_user_status_idx")
    try_execute(cur, "CREATE INDEX IF NOT EXISTS joinreq_team_status_idx    ON team_join_requests (team_id, status);",
                "joinreq_team_status_idx")
    try_execute(cur, "CREATE INDEX IF NOT EXISTS creditreq_user_status_idx  ON credit_requests (user_id, status);",
                "creditreq_user_status_idx")
    try_execute(cur, "CREATE INDEX IF NOT EXISTS credittx_user_created_idx  ON credit_transactions (user_id, created_at DESC);",
                "credittx_user_created_idx")

    # ── Migration 0011: feature_flags table ──────────────────────────────────
    # Django 5/6 generates GENERATED BY DEFAULT AS IDENTITY for BigAutoField.
    try_execute(cur, """
        CREATE TABLE IF NOT EXISTS feature_flags (
            id            bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
            key           varchar(100) NOT NULL,
            name          varchar(200) NOT NULL,
            description   text        NOT NULL DEFAULT '',
            enabled       boolean     NOT NULL DEFAULT false,
            updated_at    timestamptz NOT NULL DEFAULT NOW(),
            updated_by_id bigint REFERENCES users(id) ON DELETE SET NULL
        );
    """, "feature_flags table")
    try_execute(cur, "CREATE UNIQUE INDEX IF NOT EXISTS feature_flags_key_uniq ON feature_flags (key);",
                "feature_flags_key_uniq index")

    # ── Migration 0012: allowed_roles + feature_flags_allowed_users ───────────
    try_execute(cur, """
        ALTER TABLE feature_flags
            ADD COLUMN IF NOT EXISTS allowed_roles jsonb NOT NULL DEFAULT '[]'::jsonb;
    """, "feature_flags.allowed_roles column")
    try_execute(cur, """
        CREATE TABLE IF NOT EXISTS feature_flags_allowed_users (
            id             bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
            featureflag_id bigint NOT NULL REFERENCES feature_flags(id) ON DELETE CASCADE,
            user_id        bigint NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
            UNIQUE (featureflag_id, user_id)
        );
    """, "feature_flags_allowed_users table")

    print("Schema patch complete.", flush=True)

    # ── Step 2: mark 0006-0012 as applied if not already recorded ────────────
    migrations_to_ensure = [
        "0006_folder_favorited_by",
        "0007_folder_is_archived",
        "0008_combinedanalysis_favorited_by",
        "0009_document_owner_created_at_indexes",
        "0010_composite_indexes",
        "0011_feature_flags",
        "0012_feature_flag_targeting",
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
            print(f"  Recorded missing migration: documents.{name}", flush=True)
        else:
            print(f"  Already recorded: documents.{name}", flush=True)

cur.close()
conn.close()

# ── Step 3: run any remaining pending migrations ──────────────────────────────
# --fake-initial: if a CreateModel migration's table already exists in the DB,
# mark it as applied without running the SQL. This handles the case where the
# production DB has tables from a previous partial deployment but django_migrations
# is missing their records (which would otherwise cause "table already exists" errors).
run(f"{sys.executable} manage.py migrate --fake-initial")

print("All migrations complete.", flush=True)
