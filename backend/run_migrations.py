#!/usr/bin/env python3
"""
Robust migration runner for production.

Production DB state (verified by direct query):
- django_migrations has: contenttypes 0001-0002, auth 0001-0012,
  admin 0001-0003, sessions 0001, documents 0001
- documents 0002-0005 columns EXIST in the schema but are NOT tracked
  -> fake them so Django doesn't try to re-apply them
- documents 0006-0008 are genuinely missing -> run for real
"""
import subprocess
import sys
import os

os.chdir(os.path.dirname(os.path.abspath(__file__)))


def run(cmd, check=True):
    print(f">>> {cmd}", flush=True)
    r = subprocess.run(cmd, shell=True, text=True)
    if check and r.returncode != 0:
        print(f"FAILED (exit {r.returncode})", file=sys.stderr, flush=True)
        sys.exit(r.returncode)
    return r.returncode == 0


# Mark documents 0002-0005 as applied without re-running them.
# Their schema changes (email_draft, share_token, password_reset_tokens
# table, clerk_id) already exist in the production database.
run("python3.11 manage.py migrate documents 0005 --fake", check=False)

# Run all remaining pending migrations normally:
#   documents 0006 - folders favorited_by M2M table
#   documents 0007 - folders.is_archived column
#   documents 0008 - combined_analyses favorited_by M2M table
run("python3.11 manage.py migrate")

print("All migrations complete.", flush=True)
